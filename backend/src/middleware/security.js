/**
 * Security Middleware
 *
 * Provides:
 * - CSRF protection
 * - Secure error handling
 * - Request validation
 * - Security logging
 *
 * SECURITY FEATURES:
 * - Double-submit cookie CSRF protection
 * - Timing-safe token comparison
 * - Error message sanitization (no info leaks)
 * - Suspicious activity logging
 */

import crypto from 'crypto'

// ==================== CSRF PROTECTION ====================

const CSRF_TOKEN_LENGTH = 32
const CSRF_HEADER = 'x-csrf-token'
const CSRF_COOKIE = 'csrf-token'

/**
 * Generate a cryptographically secure CSRF token
 * @returns {string} 64-character hex token
 */
export function generateCsrfToken() {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex')
}

/**
 * CSRF protection middleware (Double Submit Cookie pattern)
 *
 * For state-changing requests (POST, PUT, DELETE, PATCH):
 * - Requires token in header AND cookie
 * - Tokens must match (timing-safe comparison)
 *
 * Safe methods (GET, HEAD, OPTIONS) are skipped.
 * Webhook endpoints are skipped (they use signature verification).
 */
export function csrfProtection(req, res, next) {
  // Safe methods don't need CSRF protection
  const safeMethods = ['GET', 'HEAD', 'OPTIONS']
  if (safeMethods.includes(req.method)) {
    return next()
  }

  // Webhook endpoints use signature verification instead
  if (req.path.includes('/webhook')) {
    return next()
  }

  // Get tokens from header and cookie
  const tokenFromHeader = req.headers[CSRF_HEADER]
  const tokenFromCookie = req.cookies?.[CSRF_COOKIE]

  // Both must be present
  if (!tokenFromHeader || !tokenFromCookie) {
    console.warn(`CSRF token missing - IP: ${req.ip}, Path: ${req.path}`)
    return res.status(403).json({
      error: 'CSRF token missing',
      code: 'CSRF_MISSING'
    })
  }

  // Validate token format
  if (tokenFromHeader.length !== CSRF_TOKEN_LENGTH * 2 ||
      tokenFromCookie.length !== CSRF_TOKEN_LENGTH * 2) {
    console.warn(`CSRF token invalid format - IP: ${req.ip}`)
    return res.status(403).json({
      error: 'CSRF token invalid',
      code: 'CSRF_INVALID'
    })
  }

  // Timing-safe comparison to prevent timing attacks
  try {
    const headerBuffer = Buffer.from(tokenFromHeader, 'hex')
    const cookieBuffer = Buffer.from(tokenFromCookie, 'hex')

    if (!crypto.timingSafeEqual(headerBuffer, cookieBuffer)) {
      console.warn(`CSRF token mismatch - IP: ${req.ip}, Path: ${req.path}`)
      return res.status(403).json({
        error: 'CSRF token mismatch',
        code: 'CSRF_MISMATCH'
      })
    }
  } catch (e) {
    console.warn(`CSRF token comparison failed - IP: ${req.ip}`)
    return res.status(403).json({
      error: 'CSRF token invalid',
      code: 'CSRF_INVALID'
    })
  }

  next()
}

/**
 * Middleware to set CSRF cookie for new sessions
 */
export function setCsrfCookie(req, res, next) {
  // Only set if not already present
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = generateCsrfToken()
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,  // Must be readable by JavaScript
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    })
  }
  next()
}


// ==================== SECURE ERROR HANDLING ====================

/**
 * Known operational errors that are safe to expose to users
 */
const OPERATIONAL_ERRORS = [
  'Invalid score',
  'Invalid level',
  'No active tournament',
  'Tournament is closed',
  'You already have an entry',
  'No tournament entry found',
  'Invalid Lightning address',
  'Display name must be',
  'Game too short',
  'Score validation failed',
  'Unauthorized',
  'Token expired',
  'Invalid or expired token',
  'CSRF token',
  'Too many requests',
  'Invoice not found',
  'No token provided'
]

/**
 * Check if an error message is safe to expose
 * @param {string} message - Error message
 * @returns {boolean}
 */
function isOperationalError(message) {
  if (!message) return false
  return OPERATIONAL_ERRORS.some(safe => message.includes(safe))
}

/**
 * Secure error handler
 *
 * - Logs full error details internally
 * - Returns sanitized message to user
 * - Never exposes stack traces in production
 * - Never exposes internal paths/database info
 */
export function secureErrorHandler(err, req, res, next) {
  // Already sent response
  if (res.headersSent) {
    return next(err)
  }

  // Generate error ID for correlation
  const errorId = crypto.randomBytes(8).toString('hex')

  // Log full error internally
  console.error(`[ERROR ${errorId}]`, {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.userId,
    timestamp: new Date().toISOString()
  })

  // Determine status code
  const statusCode = err.status || err.statusCode || 500

  // Determine what to show user
  const isDev = process.env.NODE_ENV === 'development'
  const isOperational = isOperationalError(err.message)

  if (isOperational) {
    // Safe to show this error message
    return res.status(statusCode).json({
      error: err.message
    })
  }

  // Unknown/internal error - hide details
  if (isDev) {
    // In development, show more details
    return res.status(statusCode).json({
      error: err.message,
      errorId,
      stack: err.stack?.split('\n').slice(0, 5)
    })
  }

  // Production: generic message only
  return res.status(500).json({
    error: 'An unexpected error occurred. Please try again.',
    errorId  // Include ID so user can report it
  })
}


// ==================== REQUEST VALIDATION ====================

/**
 * Validate Content-Type header for JSON endpoints
 */
export function requireJson(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS', 'DELETE']

  if (safeMethods.includes(req.method)) {
    return next()
  }

  const contentType = req.headers['content-type']

  if (!contentType || !contentType.includes('application/json')) {
    return res.status(415).json({
      error: 'Content-Type must be application/json'
    })
  }

  next()
}

/**
 * Reject requests with suspicious headers
 */
export function validateHeaders(req, res, next) {
  // Block requests pretending to be from different origins
  const origin = req.headers.origin
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5173'
  ].filter(Boolean)

  if (origin && !allowedOrigins.includes(origin)) {
    console.warn(`Blocked request from origin: ${origin}`)
    // Don't block, let CORS handle it, but log
  }

  // Check for proxy bypass attempts
  const suspiciousHeaders = [
    'x-forwarded-host',
    'x-original-url',
    'x-rewrite-url'
  ]

  for (const header of suspiciousHeaders) {
    if (req.headers[header]) {
      console.warn(`Suspicious header detected: ${header} from IP: ${req.ip}`)
    }
  }

  next()
}


// ==================== SECURITY LOGGING ====================

/**
 * Log security-relevant events
 */
export function securityLogger(req, res, next) {
  const startTime = Date.now()

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100)
    }

    // Log failed auth attempts
    if (res.statusCode === 401 || res.statusCode === 403) {
      console.warn('[SECURITY] Auth failure:', logData)
    }

    // Log rate limit hits
    if (res.statusCode === 429) {
      console.warn('[SECURITY] Rate limit hit:', logData)
    }

    // Log server errors
    if (res.statusCode >= 500) {
      console.error('[SECURITY] Server error:', logData)
    }
  })

  next()
}


// ==================== 404 HANDLER ====================

/**
 * Secure 404 handler
 * Doesn't reveal information about valid paths
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not found'
  })
}


export default {
  generateCsrfToken,
  csrfProtection,
  setCsrfCookie,
  secureErrorHandler,
  requireJson,
  validateHeaders,
  securityLogger,
  notFoundHandler
}
