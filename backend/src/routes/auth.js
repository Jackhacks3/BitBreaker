import crypto from 'crypto'
import { Router } from 'express'
import bcrypt from 'bcrypt'
import db from '../services/database.js'
import sessionStore from '../services/sessionStore.js'
import * as cacheStore from '../services/cacheStore.js'
import * as emailService from '../services/emailService.js'
import { sanitizeDisplayName, sanitizeEmail, sanitizeLightningAddress } from '../utils/sanitize.js'

const router = Router()

const VERIFY_PREFIX = 'verify:'
const RESET_PREFIX = 'reset:'
const VERIFY_TTL = 24 * 60 * 60 // 24 hours
const RESET_TTL = 60 * 60 // 1 hour

/**
 * Auth Routes
 *
 * SECURITY FEATURES:
 * - Username/password authentication with bcrypt
 * - Redis-backed session storage (survives restarts)
 * - Cryptographically secure tokens
 * - Input sanitization (XSS prevention)
 * - Session invalidation support
 */

const BCRYPT_ROUNDS = 12

// Username validation: 3-30 chars, alphanumeric + underscore
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' }
  }
  const trimmed = username.trim().toLowerCase()
  if (trimmed.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' }
  }
  if (trimmed.length > 30) {
    return { valid: false, error: 'Username must be 30 characters or less' }
  }
  if (!/^[a-z0-9_]+$/.test(trimmed)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' }
  }
  return { valid: true, sanitized: trimmed }
}

// Password validation: minimum 8 characters
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' }
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' }
  }
  if (password.length > 100) {
    return { valid: false, error: 'Password is too long' }
  }
  return { valid: true }
}

/**
 * POST /api/auth/register
 * Register a new user with username/password and email (for confirmation)
 */
router.post('/register', async (req, res, next) => {
  try {
    const { username, password, displayName, email } = req.body

    // Validate username
    const usernameResult = validateUsername(username)
    if (!usernameResult.valid) {
      return res.status(400).json({ error: usernameResult.error })
    }

    // Validate password
    const passwordResult = validatePassword(password)
    if (!passwordResult.valid) {
      return res.status(400).json({ error: passwordResult.error })
    }

    // Sanitize display name (use username if not provided)
    const nameResult = sanitizeDisplayName(displayName || username)
    if (!nameResult.valid) {
      return res.status(400).json({ error: nameResult.error })
    }

    const cleanUsername = usernameResult.sanitized
    const cleanName = nameResult.sanitized

    // Validate and sanitize email (optional but recommended for confirmation)
    let cleanEmail = null
    if (email) {
      const emailResult = sanitizeEmail(email)
      if (!emailResult.valid) {
        return res.status(400).json({ error: emailResult.error })
      }
      cleanEmail = emailResult.sanitized
    }

    // Check if username already exists
    const existingUser = await db.users.findByUsername(cleanUsername)
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' })
    }
    if (cleanEmail) {
      const existingEmail = await db.users.findByEmail(cleanEmail)
      if (existingEmail) {
        return res.status(400).json({ error: 'Email already in use' })
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    // Create user (with optional email)
    const user = await db.users.createWithPassword(cleanName, cleanUsername, passwordHash, cleanEmail)

    if (!user) {
      console.error('[AUTH] User creation returned null')
      return res.status(500).json({ error: 'Registration failed - please try again' })
    }

    // Create wallet for new user
    try {
      await db.wallets.getOrCreate(user.id)
    } catch (walletError) {
      console.error('[AUTH] Wallet creation failed:', walletError.message)
      // Continue - wallet can be created on first deposit
    }

    // Create secure session with explicit error handling
    let token
    try {
      token = await sessionStore.createSession(user.id)
    } catch (sessionError) {
      console.error('[AUTH] Session creation failed after user registration:', sessionError.message)
      // User exists but session failed - they can login to get a session
      return res.status(201).json({
        userId: user.id,
        username: user.username,
        displayName: user.display_name,
        token: null,
        message: 'Account created. Please login to continue.'
      })
    }

    // Send verification email if email provided
    if (cleanEmail) {
      const verifyToken = crypto.randomBytes(32).toString('hex')
      await cacheStore.set(`${VERIFY_PREFIX}${verifyToken}`, user.id, VERIFY_TTL)
      await emailService.sendVerificationEmail(cleanEmail, verifyToken).catch((e) =>
        console.warn('[AUTH] Verification email send failed:', e.message)
      )
    }

    console.log(`[AUTH] User registered: ${user.id.substring(0, 8)}... (${cleanUsername})`)

    res.json({
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      token,
      emailSent: !!cleanEmail,
      message: cleanEmail ? 'Account created. Please check your email to verify.' : undefined
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/login
 * Login with username/password
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body

    // Validate username format
    const usernameResult = validateUsername(username)
    if (!usernameResult.valid) {
      return res.status(400).json({ error: 'Invalid username or password' })
    }

    // Validate password provided
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid username or password' })
    }

    const cleanUsername = usernameResult.sanitized

    // Find user by username
    const user = await db.users.findByUsername(cleanUsername)
    if (!user || !user.password_hash) {
      // Use same error to prevent username enumeration
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash)
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    // Update last login (non-critical, don't fail login if this fails)
    try {
      await db.users.updateLastLogin(user.id)
    } catch (updateError) {
      console.warn('[AUTH] Failed to update last login:', updateError.message)
    }

    // Create secure session with explicit error handling
    let token
    try {
      token = await sessionStore.createSession(user.id)
    } catch (sessionError) {
      console.error('[AUTH] Session creation failed during login:', sessionError.message)
      return res.status(500).json({ error: 'Login failed - please try again' })
    }

    console.log(`[AUTH] User logged in: ${user.id.substring(0, 8)}... (${cleanUsername})`)

    res.json({
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      token
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/auth/verify-email?token=
 * Verify email from link in confirmation email
 */
router.get('/verify-email', async (req, res, next) => {
  try {
    const token = req.query.token
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing verification token' })
    }
    const userId = await cacheStore.get(`${VERIFY_PREFIX}${token}`)
    if (!userId) {
      return res.status(400).json({ error: 'Verification link expired or invalid' })
    }
    await db.users.updateEmailVerified(userId)
    await cacheStore.del(`${VERIFY_PREFIX}${token}`)
    res.json({ verified: true, message: 'Email verified successfully' })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/forgot-password
 * Request password reset; sends email with reset link
 */
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body
    const emailResult = sanitizeEmail(email)
    if (!emailResult.valid) {
      return res.status(400).json({ error: emailResult.error })
    }
    const cleanEmail = emailResult.sanitized
    const user = await db.users.findByEmail(cleanEmail)
    // Always return same message to prevent email enumeration
    const message = 'If an account exists for this email, you will receive a password reset link.'
    if (!user) {
      return res.json({ message })
    }
    const resetToken = crypto.randomBytes(32).toString('hex')
    await cacheStore.set(`${RESET_PREFIX}${resetToken}`, user.id, RESET_TTL)
    await emailService.sendPasswordResetEmail(cleanEmail, resetToken).catch((e) =>
      console.warn('[AUTH] Reset email send failed:', e.message)
    )
    res.json({ message })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/reset-password
 * Set new password using token from email link
 */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing reset token' })
    }
    const passwordResult = validatePassword(newPassword)
    if (!passwordResult.valid) {
      return res.status(400).json({ error: passwordResult.error })
    }
    const userId = await cacheStore.get(`${RESET_PREFIX}${token}`)
    if (!userId) {
      return res.status(400).json({ error: 'Reset link expired or invalid' })
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await db.users.updatePassword(userId, passwordHash)
    await cacheStore.del(`${RESET_PREFIX}${token}`)
    res.json({ message: 'Password reset successfully. You can now log in.' })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/register-legacy
 * Legacy: Register with Lightning address (kept for compatibility)
 */
router.post('/register-legacy', async (req, res, next) => {
  try {
    const { displayName, lightningAddress } = req.body

    // Sanitize and validate display name
    const nameResult = sanitizeDisplayName(displayName)
    if (!nameResult.valid) {
      return res.status(400).json({ error: nameResult.error })
    }

    // Sanitize and validate Lightning address
    const addressResult = sanitizeLightningAddress(lightningAddress)
    if (!addressResult.valid) {
      return res.status(400).json({ error: addressResult.error })
    }

    // Use sanitized values
    const cleanName = nameResult.sanitized
    const cleanAddress = addressResult.sanitized

    // Create or update user
    const user = await db.users.create(cleanName, cleanAddress)

    // Create secure session
    const token = await sessionStore.createSession(user.id)

    // Log registration (for security audit)
    console.log(`[AUTH] User registered/logged in (legacy): ${user.id.substring(0, 8)}...`)

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

    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    // Validate session
    const session = await sessionStore.getSession(token)

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    // Get user data
    const user = await db.users.findById(session.userId)

    if (!user) {
      // User deleted but session exists - invalidate session
      await sessionStore.destroySession(token)
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      lightningAddress: user.lightning_address
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/logout
 * Invalidate current session
 */
router.post('/logout', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (token) {
      await sessionStore.destroySession(token)
      console.log('[AUTH] Session destroyed')
    }

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/logout-all
 * Invalidate all sessions for current user (logout everywhere)
 */
router.post('/logout-all', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const session = await sessionStore.getSession(token)

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    // Destroy all sessions for this user
    await sessionStore.destroyAllUserSessions(session.userId)

    console.log(`[AUTH] All sessions destroyed for user: ${session.userId.substring(0, 8)}...`)

    res.json({ success: true, message: 'Logged out from all devices' })
  } catch (error) {
    next(error)
  }
})

/**
 * Middleware to verify auth token
 * Attaches userId to request if valid
 */
export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const session = await sessionStore.getSession(token)

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    // Attach user info to request
    req.userId = session.userId
    req.sessionToken = token

    next()
  } catch (error) {
    console.error('[AUTH] Auth middleware error:', error)
    return res.status(401).json({ error: 'Authentication failed' })
  }
}

export default router
