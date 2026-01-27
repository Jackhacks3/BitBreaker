import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import db from '../services/database.js'
import { requireAuth } from './auth.js'
import { csrfProtection } from '../middleware/security.js'

const router = Router()

// Strict rate limiting for bootstrap endpoint (brute force protection)
const bootstrapLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many bootstrap attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
})

/**
 * Whitelist Management Routes for BITBRICK
 *
 * Admin-only routes to manage wallet whitelist.
 * Only users with is_admin=true in whitelist can access these.
 *
 * SECURITY FEATURES:
 * - CSRF protection on all mutating operations
 * - Admin role verification
 */

// Admin middleware - checks if user is an admin
async function requireAdmin(req, res, next) {
  try {
    // First verify userId exists (set by requireAuth)
    if (!req.userId) {
      console.warn('[WHITELIST] Admin check failed: no userId in request')
      return res.status(401).json({ error: 'Authentication required' })
    }

    const user = await db.users.findById(req.userId)

    if (!user || !user.linking_key) {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const whitelistEntry = await db.whitelist.check(user.linking_key)

    if (!whitelistEntry || !whitelistEntry.is_admin) {
      return res.status(403).json({ error: 'Admin access required' })
    }

    req.isAdmin = true
    next()
  } catch (error) {
    console.error('[WHITELIST] Admin check error:', error)
    return res.status(500).json({ error: 'Authorization check failed' })
  }
}

/**
 * GET /api/whitelist
 * Get all whitelisted wallets (admin only)
 */
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const entries = await db.whitelist.getAll()

    res.json({
      count: entries.length,
      entries: entries.map(e => ({
        id: e.id,
        linkingKey: e.linking_key,
        displayName: e.display_name,
        isAdmin: e.is_admin,
        approvedAt: e.approved_at,
        createdAt: e.created_at
      }))
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/whitelist
 * Add a wallet to the whitelist (admin only)
 * CSRF protected
 */
router.post('/', requireAuth, csrfProtection, requireAdmin, async (req, res, next) => {
  try {
    const { linkingKey, displayName, isAdmin = false } = req.body

    // Validate linking key format (33-byte compressed pubkey = 66 hex chars)
    if (!linkingKey || !/^[a-f0-9]{66}$/i.test(linkingKey)) {
      return res.status(400).json({
        error: 'Invalid linking key format. Expected 66 hex characters (compressed public key).'
      })
    }

    // Add to whitelist
    const entry = await db.whitelist.add(linkingKey, displayName, isAdmin, req.userId)

    console.log(`[WHITELIST] Added: ${linkingKey.substring(0, 16)}... by admin ${req.userId.substring(0, 8)}...`)

    res.json({
      success: true,
      entry: {
        id: entry.id,
        linkingKey: entry.linking_key,
        displayName: entry.display_name,
        isAdmin: entry.is_admin,
        approvedAt: entry.approved_at
      }
    })
  } catch (error) {
    next(error)
  }
})

/**
 * DELETE /api/whitelist/:linkingKey
 * Remove a wallet from the whitelist (admin only)
 * CSRF protected
 */
router.delete('/:linkingKey', requireAuth, csrfProtection, requireAdmin, async (req, res, next) => {
  try {
    const { linkingKey } = req.params

    if (!/^[a-f0-9]{66}$/i.test(linkingKey)) {
      return res.status(400).json({ error: 'Invalid linking key format' })
    }

    // Check if trying to remove self
    const adminUser = await db.users.findById(req.userId)
    if (adminUser?.linking_key === linkingKey) {
      return res.status(400).json({ error: 'Cannot remove yourself from whitelist' })
    }

    // Find the user being removed to invalidate their sessions
    const targetUser = await db.users.findByLinkingKey(linkingKey)

    await db.whitelist.remove(linkingKey)

    // Invalidate all sessions for the removed user (if they exist)
    if (targetUser) {
      try {
        const { destroyAllUserSessions } = await import('../services/sessionStore.js')
        await destroyAllUserSessions(targetUser.id)
        console.log(`[WHITELIST] Invalidated all sessions for removed user: ${targetUser.id.substring(0, 8)}...`)
      } catch (sessionError) {
        console.warn('[WHITELIST] Failed to invalidate sessions:', sessionError.message)
        // Continue - whitelist removal is the critical operation
      }
    }

    console.log(`[WHITELIST] Removed: ${linkingKey.substring(0, 16)}... by admin ${req.userId.substring(0, 8)}...`)

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/whitelist/bootstrap
 * Bootstrap first admin (only works when whitelist is empty)
 * This allows setting up the first admin without existing auth
 * Rate limited to prevent brute force attacks on admin secret
 */
router.post('/bootstrap', bootstrapLimiter, async (req, res, next) => {
  try {
    const { linkingKey, displayName, adminSecret } = req.body

    // Check admin secret from environment
    const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET

    if (!expectedSecret) {
      return res.status(403).json({
        error: 'Bootstrap disabled. Set ADMIN_BOOTSTRAP_SECRET in environment.'
      })
    }

    // Timing-safe comparison to prevent timing attacks
    if (!adminSecret || adminSecret.length !== expectedSecret.length) {
      console.warn('[SECURITY] Bootstrap attempt with invalid secret length')
      return res.status(403).json({ error: 'Invalid admin secret' })
    }

    // Use constant-time comparison
    const secretBuffer = Buffer.from(adminSecret)
    const expectedBuffer = Buffer.from(expectedSecret)
    const isValid = secretBuffer.length === expectedBuffer.length &&
                    require('crypto').timingSafeEqual(secretBuffer, expectedBuffer)

    if (!isValid) {
      console.warn('[SECURITY] Bootstrap attempt with incorrect secret')
      return res.status(403).json({ error: 'Invalid admin secret' })
    }

    // Validate linking key
    if (!linkingKey || !/^[a-f0-9]{66}$/i.test(linkingKey)) {
      return res.status(400).json({ error: 'Invalid linking key format' })
    }

    // Check if whitelist already has admins
    const existing = await db.whitelist.getAll()
    const hasAdmin = existing.some(e => e.is_admin)

    if (hasAdmin) {
      return res.status(400).json({
        error: 'Bootstrap not allowed. Admin already exists. Use admin routes to add more.'
      })
    }

    // Add first admin
    const entry = await db.whitelist.add(linkingKey, displayName || 'Admin', true, null)

    console.log(`[WHITELIST] Bootstrap admin created: ${linkingKey.substring(0, 16)}...`)

    res.json({
      success: true,
      message: 'First admin added to whitelist. You can now authenticate with LNURL-auth.',
      entry: {
        linkingKey: entry.linking_key,
        displayName: entry.display_name,
        isAdmin: true
      }
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/whitelist/check/:linkingKey
 * Check if a wallet is whitelisted (public endpoint)
 */
router.get('/check/:linkingKey', async (req, res, next) => {
  try {
    const { linkingKey } = req.params

    if (!/^[a-f0-9]{66}$/i.test(linkingKey)) {
      return res.status(400).json({ error: 'Invalid linking key format' })
    }

    const entry = await db.whitelist.check(linkingKey)

    res.json({
      whitelisted: !!entry,
      displayName: entry?.display_name || null
    })
  } catch (error) {
    next(error)
  }
})

export default router
