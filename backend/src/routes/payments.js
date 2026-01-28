import { Router } from 'express'
import crypto from 'crypto'
import db from '../services/database.js'
import { requireAuth } from './auth.js'
import { createInvoice, checkPayment, payToAddress } from '../services/lightning.js'
import * as cache from '../services/cacheStore.js'
import { WEBHOOK_IDEMPOTENCY_TTL_SECONDS, INVOICE_TTL_SECONDS } from '../config/constants.js'

const router = Router()

/**
 * Payment Routes
 *
 * SECURITY FEATURES:
 * - Webhook signature verification (CRITICAL)
 * - Idempotency protection (no double-entry)
 * - Redis-backed invoice tracking with TTL
 * - Rate limiting on invoice creation
 * - Memory-bounded cache with automatic eviction
 */

// Cache key prefixes
const INVOICE_PREFIX = 'invoice:'
const WEBHOOK_PREFIX = 'webhook:'
const INVOICE_TTL = INVOICE_TTL_SECONDS // From constants.js
const WEBHOOK_TTL = WEBHOOK_IDEMPOTENCY_TTL_SECONDS // 24 hours from constants.js

/**
 * Verify webhook signature from LNbits
 *
 * CRITICAL: Without this, attackers can fake payment confirmations
 * and get free tournament entries
 *
 * SECURITY: Webhook signature verification is ALWAYS required.
 * The ALLOW_UNSIGNED_WEBHOOKS bypass has been removed for security.
 *
 * @param {Request} req - Express request
 * @returns {boolean} - True if signature is valid
 */
function verifyWebhookSignature(req) {
  const webhookSecret = process.env.LNBITS_WEBHOOK_SECRET

  // SECURITY: Webhook secret is REQUIRED in all environments
  if (!webhookSecret) {
    console.error('[SECURITY] LNBITS_WEBHOOK_SECRET not configured - rejecting webhook')
    console.error('[SECURITY] Configure LNBITS_WEBHOOK_SECRET in your environment')
    return false
  }

  // Get signature from header
  // LNbits uses different headers depending on version
  const signature = req.headers['x-lnbits-signature'] ||
                    req.headers['x-webhook-signature'] ||
                    req.headers['x-signature']

  if (!signature) {
    console.error('[SECURITY] Webhook missing signature header')
    return false
  }

  // CRITICAL: Use rawBody for signature verification
  // JSON.stringify(req.body) doesn't guarantee key ordering and can fail verification
  // rawBody is stored in index.js body parser verify callback
  const payload = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body)

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex')

  // Timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    // Buffers must be same length for timingSafeEqual
    if (sigBuffer.length !== expectedBuffer.length) {
      console.error('[SECURITY] Webhook signature length mismatch')
      return false
    }

    const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer)

    if (!isValid) {
      console.error('[SECURITY] Webhook signature mismatch - possible attack')
    }

    return isValid
  } catch (error) {
    console.error('[SECURITY] Webhook signature verification error:', error.message)
    return false
  }
}

/**
 * POST /api/payments/buy-in
 * Generate a Lightning invoice for tournament buy-in
 */
router.post('/buy-in', requireAuth, async (req, res, next) => {
  try {
    // Get current tournament
    const tournament = await db.tournaments.findCurrent()

    if (!tournament) {
      return res.status(400).json({ error: 'No active tournament', code: 'NO_TOURNAMENT' })
    }

    if (tournament.status !== 'open') {
      return res.status(400).json({ error: 'Tournament is closed', code: 'TOURNAMENT_CLOSED' })
    }

    // Check if user already has entry
    const existingEntry = await db.entries.findByUserAndTournament(req.userId, tournament.id)

    if (existingEntry) {
      return res.status(400).json({ error: 'You already have an entry in this tournament', code: 'DUPLICATE_ENTRY' })
    }

    // Check for existing pending invoice for this user/tournament
    const userInvoiceKey = `${INVOICE_PREFIX}user:${req.userId}:${tournament.id}`
    const existingHash = await cache.get(userInvoiceKey)

    if (existingHash) {
      const existingInfo = await cache.get(`${INVOICE_PREFIX}${existingHash}`)
      if (existingInfo) {
        const expiresIn = Math.floor((existingInfo.createdAt + (INVOICE_TTL * 1000) - Date.now()) / 1000)
        if (expiresIn > 0) {
          return res.json({
            invoice: existingInfo.paymentRequest,
            paymentHash: existingHash,
            amount: parseInt(tournament.buy_in_sats),
            expiresIn
          })
        }
      }
      // Remove expired references
      await cache.del(userInvoiceKey)
    }

    // Create Lightning invoice
    const memo = `Brick Breaker Tournament - ${tournament.date}`
    const invoice = await createInvoice(parseInt(tournament.buy_in_sats), memo)

    // Store pending invoice with TTL
    const invoiceData = {
      tournamentId: tournament.id,
      userId: req.userId,
      amount: parseInt(tournament.buy_in_sats),
      paymentRequest: invoice.paymentRequest,
      createdAt: Date.now()
    }

    await cache.set(`${INVOICE_PREFIX}${invoice.paymentHash}`, invoiceData, INVOICE_TTL)
    await cache.set(userInvoiceKey, invoice.paymentHash, INVOICE_TTL)

    console.log(`[PAYMENT] Invoice created for user ${req.userId.substring(0, 8)}...: ${invoice.paymentHash.substring(0, 16)}...`)

    res.json({
      invoice: invoice.paymentRequest,
      paymentHash: invoice.paymentHash,
      amount: parseInt(tournament.buy_in_sats),
      expiresIn: 600 // 10 minutes
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/payments/status/:hash
 * Check if payment has been received
 */
router.get('/status/:hash', requireAuth, async (req, res, next) => {
  try {
    const { hash } = req.params

    // Validate hash format (64 hex characters)
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      return res.status(400).json({ error: 'Invalid payment hash format', code: 'INVALID_HASH' })
    }

    const pendingInfo = await cache.get(`${INVOICE_PREFIX}${hash}`)

    if (!pendingInfo) {
      // Check if user already has entry (payment might have been processed via webhook)
      const tournament = await db.tournaments.findCurrent()
      if (tournament) {
        const entry = await db.entries.findByUserAndTournament(req.userId, tournament.id)
        if (entry) {
          return res.json({ paid: true, entryId: entry.id })
        }
      }
      return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' })
    }

    // Verify this invoice belongs to requesting user
    if (pendingInfo.userId !== req.userId) {
      console.warn(`[SECURITY] User ${req.userId.substring(0, 8)}... tried to check someone else's invoice`)
      return res.status(403).json({ error: 'Access denied', code: 'UNAUTHORIZED' })
    }

    // Check if expired (cache TTL handles this, but double-check)
    const age = Date.now() - pendingInfo.createdAt
    if (age > INVOICE_TTL * 1000) {
      await cache.del(`${INVOICE_PREFIX}${hash}`)
      return res.json({ paid: false, expired: true, code: 'INVOICE_EXPIRED' })
    }

    // Check if payment received via LNbits API
    const paid = await checkPayment(hash)

    if (paid) {
      // Process the payment (create entry)
      const result = await processPayment(hash, pendingInfo)

      if (result.success) {
        res.json({ paid: true, entryId: result.entryId })
      } else {
        // Entry might already exist (race condition with webhook)
        const entry = await db.entries.findByUserAndTournament(pendingInfo.userId, pendingInfo.tournamentId)
        res.json({ paid: true, entryId: entry?.id })
      }
    } else {
      res.json({ paid: false, expired: false })
    }
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/payments/webhook
 * Webhook for LNbits payment notifications
 *
 * SECURITY: Signature verification required
 */
router.post('/webhook', async (req, res, next) => {
  try {
    // CRITICAL: Verify webhook signature
    if (!verifyWebhookSignature(req)) {
      console.error('[SECURITY] Invalid webhook signature - rejecting')
      return res.status(401).json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' })
    }

    const { payment_hash, paid } = req.body

    // Must have payment_hash and paid=true
    if (!payment_hash || !paid) {
      return res.json({ received: true })
    }

    // Idempotency check - prevent processing same webhook twice
    const idempotencyKey = `${WEBHOOK_PREFIX}${payment_hash}`
    const isNew = await cache.setIfNotExists(idempotencyKey, WEBHOOK_TTL)

    if (!isNew) {
      console.log(`[PAYMENT] Duplicate webhook ignored: ${payment_hash.substring(0, 16)}...`)
      return res.json({ received: true, duplicate: true })
    }

    const pendingInfo = await cache.get(`${INVOICE_PREFIX}${payment_hash}`)

    if (!pendingInfo) {
      console.log(`[PAYMENT] Webhook for unknown invoice: ${payment_hash.substring(0, 16)}...`)
      return res.json({ received: true, unknown: true })
    }

    // Idempotency key already set above (atomic operation prevents race conditions)

    // Process the payment
    const result = await processPayment(payment_hash, pendingInfo)

    console.log(`[PAYMENT] Webhook processed: ${payment_hash.substring(0, 16)}... - success: ${result.success}`)

    res.json({ received: true, processed: result.success })
  } catch (error) {
    next(error)
  }
})

/**
 * Process a confirmed payment
 * Creates tournament entry and updates prize pool
 *
 * @param {string} paymentHash - Payment hash
 * @param {Object} pendingInfo - Pending invoice info
 * @returns {Promise<{success: boolean, entryId?: string}>}
 */
async function processPayment(paymentHash, pendingInfo) {
  try {
    // Check if entry already exists (idempotency)
    const existingEntry = await db.entries.findByUserAndTournament(
      pendingInfo.userId,
      pendingInfo.tournamentId
    )

    if (existingEntry) {
      console.log(`[PAYMENT] Entry already exists for user ${pendingInfo.userId.substring(0, 8)}...`)
      await cache.del(`${INVOICE_PREFIX}${paymentHash}`)
      return { success: true, entryId: existingEntry.id }
    }

    // Create tournament entry
    const entry = await db.entries.create(
      pendingInfo.tournamentId,
      pendingInfo.userId,
      paymentHash
    )

    if (!entry) {
      console.error(`[PAYMENT] Failed to create entry for payment ${paymentHash.substring(0, 16)}...`)
      return { success: false }
    }

    // Update prize pool
    await db.tournaments.updatePrizePool(
      pendingInfo.tournamentId,
      pendingInfo.amount
    )

    // Remove from pending (cache TTL will also handle this, but clean up early)
    await cache.del(`${INVOICE_PREFIX}${paymentHash}`)

    console.log(`[PAYMENT] Entry created: ${entry.id} for user ${pendingInfo.userId.substring(0, 8)}...`)

    return { success: true, entryId: entry.id }
  } catch (error) {
    console.error('[PAYMENT] Process payment error:', error)
    return { success: false }
  }
}

/**
 * Process pending payouts (called by tournament engine)
 */
export async function processPayout(payout) {
  try {
    console.log(`[PAYOUT] Processing payout ${payout.id}: ${payout.amount_sats} sats to ${payout.lightning_address}`)

    const result = await payToAddress(
      payout.lightning_address,
      parseInt(payout.amount_sats),
      `Brick Breaker Prize - Place ${payout.place}`
    )

    if (result.success) {
      await db.payouts.markPaid(payout.id, result.paymentHash)
      console.log(`[PAYOUT] Success: ${result.paymentHash}`)
      return true
    }

    console.error(`[PAYOUT] Failed: ${result.error}`)
    return false
  } catch (error) {
    console.error('[PAYOUT] Error:', error)
    return false
  }
}

// Cache store handles TTL automatically - no manual cleanup needed
// This also enables graceful shutdown without orphaned intervals

export default router
