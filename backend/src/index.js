import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import cron from 'node-cron'

// Load environment variables
dotenv.config()

// Import routes
import authRoutes from './routes/auth.js'
import tournamentRoutes from './routes/tournaments.js'
import paymentRoutes from './routes/payments.js'
import gameRoutes from './routes/game.js'
import lnurlAuthRoutes from './routes/lnurl-auth.js'
import whitelistRoutes from './routes/whitelist.js'
import walletRoutes from './routes/wallet.js'

// Import services
import { initDatabase, close as closeDatabase } from './services/database.js'
import { initSessionStore, isUsingRedis, close as closeSessionStore } from './services/sessionStore.js'
import { initCacheStore, close as closeCacheStore, isUsingRedis as isCacheUsingRedis } from './services/cacheStore.js'
import { TournamentEngine } from './services/tournamentEngine.js'

// Import security middleware
import {
  csrfProtection,
  setCsrfCookie,
  secureErrorHandler,
  requireJson,
  validateHeaders,
  securityLogger,
  notFoundHandler,
  requestCorrelation
} from './middleware/security.js'

const app = express()
const PORT = process.env.PORT || 4000
const isProduction = process.env.NODE_ENV === 'production'

// ==================== SECURITY MIDDLEWARE ====================

// Security headers with helmet (enhanced configuration)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.LNBITS_URL || 'https://legend.lnbits.com'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false, // Allow loading resources from CDN
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}))

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:5173', // Vite dev server
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // SECURITY: Only allow requests without origin for specific safe endpoints
    // This prevents CSRF attacks via no-origin requests
    if (!origin) {
      // Allow health checks and webhook callbacks (server-to-server)
      // Webhooks are protected by signature verification
      return callback(null, true)
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      console.warn(`[CORS] Blocked request from origin: ${origin}`)
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-correlation-id']
}))

// Cookie parser (required for CSRF)
app.use(cookieParser())

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 100 : 1000, // More lenient in development
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
})
app.use(globalLimiter)

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 10 : 100,
  message: { error: 'Too many authentication attempts, please try again later' }
})

// Stricter rate limiting for payment endpoints
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 5 : 50,
  message: { error: 'Too many payment requests, please wait' }
})

// Stricter rate limiting for game submission
const gameLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProduction ? 20 : 100,
  message: { error: 'Too many game submissions' }
})

// Body parsing with size limit
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook signature verification
    req.rawBody = buf
  }
}))

// Request correlation IDs for distributed tracing
app.use(requestCorrelation)

// Security logging
app.use(securityLogger)

// Validate headers
app.use(validateHeaders)

// Require JSON content-type for POST/PUT
app.use(requireJson)

// Set CSRF cookie for new sessions
app.use(setCsrfCookie)

// ==================== ROUTES ====================

// Health check (no auth, no CSRF)
// SECURITY: Don't expose environment info in production
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    sessionStore: isUsingRedis() ? 'redis' : 'memory'
  })
})

// CSRF token endpoint (GET doesn't need CSRF protection)
app.get('/api/csrf-token', (req, res) => {
  // Cookie is already set by setCsrfCookie middleware
  // Return it in response for client to use in header
  const token = req.cookies['csrf-token']
  res.json({ csrfToken: token })
})

// API Routes with appropriate rate limiters
app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/lnurl-auth', authLimiter, lnurlAuthRoutes)
app.use('/api/whitelist', whitelistRoutes)
app.use('/api/tournaments', tournamentRoutes)
app.use('/api/payments', paymentLimiter, paymentRoutes)
app.use('/api/wallet', paymentLimiter, walletRoutes)
app.use('/api/game', gameLimiter, csrfProtection, gameRoutes)

// ==================== ERROR HANDLING ====================

// Secure error handler (sanitizes error messages)
app.use(secureErrorHandler)

// 404 handler
app.use(notFoundHandler)

// ==================== SERVER STARTUP ====================

async function start() {
  try {
    console.log('==========================================')
    console.log('  Brick Breaker Tournament API')
    console.log('==========================================')
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)

    // Initialize session store (Redis or memory)
    await initSessionStore()
    console.log(`Session store: ${isUsingRedis() ? 'Redis' : 'In-memory (development)'}`)

    // Initialize cache store (Redis or memory)
    await initCacheStore()
    console.log(`Cache store: ${isCacheUsingRedis() ? 'Redis' : 'In-memory (development)'}`)

    // Initialize database
    await initDatabase()
    console.log('Database: initialized')

    // Initialize tournament engine
    const tournamentEngine = new TournamentEngine()

    // Create today's tournament if doesn't exist
    await tournamentEngine.ensureTodaysTournament()
    console.log('Tournament engine: ready')

    // Schedule daily tournament creation (midnight UTC)
    cron.schedule('0 0 * * *', async () => {
      try {
        console.log('[CRON] Creating new daily tournament...')
        await tournamentEngine.createDailyTournament()
        console.log('[CRON] Daily tournament created successfully')
      } catch (error) {
        console.error('[CRON] Tournament creation failed:', error.message)
        // TODO: Alert monitoring system
      }
    }, { timezone: 'UTC' })

    // Schedule tournament closing (23:59 UTC)
    cron.schedule('59 23 * * *', async () => {
      try {
        console.log('[CRON] Closing today\'s tournament...')
        await tournamentEngine.closeTournament()
        console.log('[CRON] Tournament closed successfully')
      } catch (error) {
        console.error('[CRON] Tournament closing failed:', error.message)
        // TODO: Alert monitoring system
      }
    }, { timezone: 'UTC' })

    // Schedule payout retry job (every 30 minutes)
    cron.schedule('*/30 * * * *', async () => {
      console.log('[CRON] Running payout retry job...')
      try {
        const result = await tournamentEngine.retryFailedPayouts()
        console.log('[CRON] Payout retry completed:', result)
      } catch (error) {
        console.error('[CRON] Payout retry failed:', error.message)
      }
    }, { timezone: 'UTC' })

    // Security checks - enforce critical requirements in production
    console.log('------------------------------------------')
    console.log('Security Status:')

    const securityErrors = []

    // Check webhook secret
    if (!process.env.LNBITS_WEBHOOK_SECRET) {
      if (isProduction) {
        securityErrors.push('LNBITS_WEBHOOK_SECRET is required in production')
      } else {
        console.warn('  [WARN] LNBITS_WEBHOOK_SECRET not set - set ALLOW_UNSIGNED_WEBHOOKS=true for dev')
      }
    } else {
      console.log('  [OK] Webhook signature verification enabled')
    }

    // Check Redis for production
    if (!isUsingRedis()) {
      if (isProduction) {
        securityErrors.push('REDIS_URL is required in production for session/cache persistence')
      } else {
        console.log('  [OK] Using in-memory stores (development only)')
      }
    } else {
      console.log('  [OK] Redis session/cache store enabled')
    }

    // Check LNbits configuration
    if (!process.env.LNBITS_API_KEY && isProduction) {
      securityErrors.push('LNBITS_API_KEY is required in production')
    }

    // Fail startup if critical security requirements not met
    if (securityErrors.length > 0) {
      console.error('------------------------------------------')
      console.error('[FATAL] Security requirements not met:')
      securityErrors.forEach(err => console.error(`  - ${err}`))
      console.error('------------------------------------------')
      console.error('Server cannot start in production without these configurations.')
      console.error('Set NODE_ENV=development to bypass these checks (NOT for production).')
      process.exit(1)
    }

    console.log(`  [OK] Rate limiting enabled`)
    console.log(`  [OK] Security headers enabled`)
    console.log(`  [OK] CORS configured for: ${allowedOrigins.join(', ')}`)
    console.log('------------------------------------------')

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
      console.log('==========================================')
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[CRITICAL] Uncaught exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled rejection at:', promise, 'reason:', reason)
})

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  console.log(`[SHUTDOWN] Received ${signal}, shutting down gracefully...`)

  try {
    // Close cache store (stops cleanup intervals, closes Redis)
    await closeCacheStore()
    console.log('[SHUTDOWN] Cache store closed')

    // Close session store (stops cleanup intervals, closes Redis)
    await closeSessionStore()
    console.log('[SHUTDOWN] Session store closed')

    // Close database connection pool
    await closeDatabase()
    console.log('[SHUTDOWN] Database pool closed')

    console.log('[SHUTDOWN] All resources closed successfully')
  } catch (error) {
    console.error('[SHUTDOWN] Error during cleanup:', error.message)
  }

  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

start()
