import { Router } from 'express'
import crypto from 'crypto'
import db from '../services/database.js'

const router = Router()

/**
 * Auth Routes
 *
 * Simple token-based auth for the tournament.
 * In production, this would use LNURL-auth for cryptographic verification.
 */

// In-memory token store (use Redis in production)
const tokens = new Map()

/**
 * Generate a simple auth token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * POST /api/auth/register
 * Register a new user or login existing user
 */
router.post('/register', async (req, res, next) => {
  try {
    const { displayName, lightningAddress } = req.body

    // Validate display name
    if (!displayName || displayName.length < 2 || displayName.length > 20) {
      return res.status(400).json({ error: 'Display name must be 2-20 characters' })
    }

    // Validate Lightning address format
    const lnAddressRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    if (!lnAddressRegex.test(lightningAddress)) {
      return res.status(400).json({ error: 'Invalid Lightning address format' })
    }

    // Sanitize display name (basic)
    const cleanName = displayName.trim().substring(0, 20)
    const cleanAddress = lightningAddress.trim().toLowerCase()

    // Create or update user
    const user = await db.users.create(cleanName, cleanAddress)

    // Generate token
    const token = generateToken()
    tokens.set(token, {
      userId: user.id,
      createdAt: Date.now()
    })

    res.json({
      userId: user.id,
      displayName: user.display_name,
      lightningAddress: user.lightning_address,
      token
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token || !tokens.has(token)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { userId } = tokens.get(token)
    const user = await db.users.findById(userId)

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({
      userId: user.id,
      displayName: user.display_name,
      lightningAddress: user.lightning_address
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/logout
 * Invalidate token
 */
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (token) {
    tokens.delete(token)
  }

  res.json({ success: true })
})

/**
 * Middleware to verify auth token
 */
export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token || !tokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const tokenData = tokens.get(token)

  // Token expires after 24 hours
  if (Date.now() - tokenData.createdAt > 24 * 60 * 60 * 1000) {
    tokens.delete(token)
    return res.status(401).json({ error: 'Token expired' })
  }

  req.userId = tokenData.userId
  next()
}

// Cleanup expired tokens periodically
setInterval(() => {
  const now = Date.now()
  const maxAge = 24 * 60 * 60 * 1000 // 24 hours

  for (const [token, data] of tokens.entries()) {
    if (now - data.createdAt > maxAge) {
      tokens.delete(token)
    }
  }
}, 60 * 60 * 1000) // Run every hour

export default router
