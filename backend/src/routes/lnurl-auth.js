import { Router } from 'express'
import crypto from 'crypto'
import { bech32 } from 'bech32'
import * as secp256k1 from 'secp256k1'
import db from '../services/database.js'
import sessionStore from '../services/sessionStore.js'

const router = Router()

/**
 * LNURL-auth Routes for BITBRICK
 *
 * Implements LUD-04: https://github.com/lnurl/luds/blob/luds/04.md
 *
 * Flow:
 * 1. Frontend calls GET /api/lnurl-auth to get LNURL
 * 2. User scans QR with Lightning wallet
 * 3. Wallet calls GET /api/lnurl-auth/callback with signature
 * 4. Frontend polls GET /api/lnurl-auth/status/:k1
 * 5. Once verified, frontend calls POST /api/lnurl-auth/complete to get session
 */

// Get base URL for callbacks
function getBaseUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${protocol}://${host}`
}

// Encode URL to bech32 LNURL format
function encodeLnurl(url) {
  const words = bech32.toWords(Buffer.from(url, 'utf8'))
  return bech32.encode('lnurl', words, 2000).toUpperCase()
}

// Verify secp256k1 signature
function verifySignature(k1, sig, key) {
  try {
    const k1Buffer = Buffer.from(k1, 'hex')
    const sigBuffer = Buffer.from(sig, 'hex')
    const keyBuffer = Buffer.from(key, 'hex')

    // DER decode the signature if needed
    let sigDecoded = sigBuffer
    if (sigBuffer.length > 64) {
      // DER encoded signature - decode it
      sigDecoded = derToCompact(sigBuffer)
    }

    return secp256k1.ecdsaVerify(sigDecoded, k1Buffer, keyBuffer)
  } catch (error) {
    console.error('[LNURL] Signature verification error:', error.message)
    return false
  }
}

// Convert DER signature to compact format
function derToCompact(der) {
  let offset = 0

  // Skip sequence tag and length
  if (der[offset++] !== 0x30) throw new Error('Invalid DER signature')
  offset++ // length byte

  // Parse R
  if (der[offset++] !== 0x02) throw new Error('Invalid DER R marker')
  const rLen = der[offset++]
  let r = der.slice(offset, offset + rLen)
  offset += rLen

  // Parse S
  if (der[offset++] !== 0x02) throw new Error('Invalid DER S marker')
  const sLen = der[offset++]
  let s = der.slice(offset, offset + sLen)

  // Remove leading zeros and pad to 32 bytes
  while (r.length > 32 && r[0] === 0) r = r.slice(1)
  while (s.length > 32 && s[0] === 0) s = s.slice(1)
  while (r.length < 32) r = Buffer.concat([Buffer.from([0]), r])
  while (s.length < 32) s = Buffer.concat([Buffer.from([0]), s])

  return Buffer.concat([r, s])
}

/**
 * GET /api/lnurl-auth
 * Generate new LNURL-auth challenge
 */
router.get('/', async (req, res, next) => {
  try {
    // Generate random k1 challenge (32 bytes hex)
    const k1 = crypto.randomBytes(32).toString('hex')

    // Store challenge in database
    await db.lnurlChallenges.create(k1, 300) // 5 minute expiry

    // Build callback URL
    const baseUrl = getBaseUrl(req)
    const callbackUrl = `${baseUrl}/api/lnurl-auth/callback?k1=${k1}`

    // Encode as LNURL
    const lnurl = encodeLnurl(callbackUrl)

    console.log(`[LNURL] Challenge created: ${k1.substring(0, 16)}...`)

    res.json({
      k1,
      lnurl,
      callbackUrl,
      expiresIn: 300
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/lnurl-auth/callback
 * Callback endpoint for Lightning wallets
 * Query params: k1, sig, key
 */
router.get('/callback', async (req, res, next) => {
  try {
    const { k1, sig, key } = req.query

    // Validate required params
    if (!k1 || !sig || !key) {
      return res.json({
        status: 'ERROR',
        reason: 'Missing required parameters: k1, sig, key'
      })
    }

    // Validate format
    if (!/^[a-f0-9]{64}$/i.test(k1)) {
      return res.json({ status: 'ERROR', reason: 'Invalid k1 format' })
    }
    if (!/^[a-f0-9]+$/i.test(sig)) {
      return res.json({ status: 'ERROR', reason: 'Invalid sig format' })
    }
    if (!/^[a-f0-9]{66}$/i.test(key)) {
      return res.json({ status: 'ERROR', reason: 'Invalid key format (expected 33-byte compressed pubkey)' })
    }

    // Check if challenge exists and is pending
    const challenge = await db.lnurlChallenges.get(k1)

    if (!challenge) {
      return res.json({ status: 'ERROR', reason: 'Challenge not found or expired' })
    }

    if (challenge.status !== 'pending') {
      return res.json({ status: 'ERROR', reason: 'Challenge already used' })
    }

    if (new Date() > new Date(challenge.expires_at)) {
      return res.json({ status: 'ERROR', reason: 'Challenge expired' })
    }

    // Verify signature
    const validSig = verifySignature(k1, sig, key)

    if (!validSig) {
      console.log(`[LNURL] Invalid signature for k1: ${k1.substring(0, 16)}...`)
      return res.json({ status: 'ERROR', reason: 'Invalid signature' })
    }

    // Check whitelist
    const whitelistEntry = await db.whitelist.check(key)

    if (!whitelistEntry) {
      console.log(`[LNURL] Wallet not whitelisted: ${key.substring(0, 16)}...`)
      return res.json({
        status: 'ERROR',
        reason: 'Wallet not on whitelist. Contact admin for access.'
      })
    }

    // Signature valid and wallet whitelisted - verify the challenge
    await db.lnurlChallenges.verify(k1, key)

    console.log(`[LNURL] Auth successful for: ${key.substring(0, 16)}...`)

    // Return success (required LNURL-auth response)
    res.json({ status: 'OK' })
  } catch (error) {
    console.error('[LNURL] Callback error:', error)
    res.json({ status: 'ERROR', reason: 'Internal server error' })
  }
})

/**
 * GET /api/lnurl-auth/status/:k1
 * Check authentication status (frontend polls this)
 */
router.get('/status/:k1', async (req, res, next) => {
  try {
    const { k1 } = req.params

    if (!/^[a-f0-9]{64}$/i.test(k1)) {
      return res.status(400).json({ error: 'Invalid k1 format' })
    }

    const challenge = await db.lnurlChallenges.get(k1)

    if (!challenge) {
      return res.json({ status: 'not_found' })
    }

    if (new Date() > new Date(challenge.expires_at)) {
      return res.json({ status: 'expired' })
    }

    res.json({
      status: challenge.status,
      verified: challenge.status === 'verified',
      linkingKey: challenge.status === 'verified' ? challenge.linking_key : null
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/lnurl-auth/complete
 * Complete authentication and get session token
 */
router.post('/complete', async (req, res, next) => {
  try {
    const { k1 } = req.body

    if (!k1 || !/^[a-f0-9]{64}$/i.test(k1)) {
      return res.status(400).json({ error: 'Invalid k1' })
    }

    // Get and consume the challenge with explicit error handling
    let challenge
    try {
      challenge = await db.lnurlChallenges.consume(k1)
    } catch (dbError) {
      console.error('[LNURL] Database error consuming challenge:', dbError.message)
      return res.status(500).json({ error: 'Authentication failed - please try again' })
    }

    if (!challenge) {
      return res.status(400).json({ error: 'Challenge not verified or already used' })
    }

    const linkingKey = challenge.linking_key

    // Get or create user with error handling
    let user
    try {
      user = await db.users.findByLinkingKey(linkingKey)

      if (!user) {
        // Get whitelist entry for display name
        const whitelistEntry = await db.whitelist.check(linkingKey)
        const displayName = whitelistEntry?.display_name || `Player_${linkingKey.substring(0, 8)}`

        user = await db.users.createFromLnurl(linkingKey, displayName)

        // Create wallet for new user
        await db.wallets.getOrCreate(user.id)

        console.log(`[LNURL] New user created: ${user.id.substring(0, 8)}...`)
      }
    } catch (userError) {
      console.error('[LNURL] Error creating/finding user:', userError.message)
      return res.status(500).json({ error: 'Account creation failed - please try again' })
    }

    // Create session with explicit error handling
    let token
    try {
      token = await sessionStore.createSession(user.id)
    } catch (sessionError) {
      console.error('[LNURL] Session creation failed:', sessionError.message)
      return res.status(500).json({ error: 'Session creation failed - please try again' })
    }

    console.log(`[LNURL] Session created for user: ${user.id.substring(0, 8)}...`)

    res.json({
      success: true,
      userId: user.id,
      displayName: user.display_name,
      linkingKey: user.linking_key,
      token
    })
  } catch (error) {
    next(error)
  }
})

// Cleanup expired challenges periodically
setInterval(async () => {
  try {
    await db.lnurlChallenges.cleanup()
  } catch (error) {
    console.error('[LNURL] Cleanup error:', error)
  }
}, 60 * 1000) // Every minute

export default router
