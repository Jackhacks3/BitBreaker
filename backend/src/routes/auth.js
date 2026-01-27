import { Router } from 'express'
import bcrypt from 'bcrypt'
import db from '../services/database.js'
import sessionStore from '../services/sessionStore.js'
import { sanitizeDisplayName, sanitizeLightningAddress } from '../utils/sanitize.js'

const router = Router()

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
 * Register a new user with username/password
 */
router.post('/register', async (req, res, next) => {
  try {
    const { username, password, displayName } = req.body

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

    // Check if username already exists
    const existingUser = await db.users.findByUsername(cleanUsername)
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' })
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    // Create user
    const user = await db.users.createWithPassword(cleanName, cleanUsername, passwordHash)

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

    console.log(`[AUTH] User registered: ${user.id.substring(0, 8)}... (${cleanUsername})`)

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
