import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import cron from 'node-cron'

// Load environment variables: project root .env first (so Neon DATABASE_URL is used), then backend/.env overrides
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config() // backend/.env overrides when present

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
  requestCorrelation,
  generateCsrfToken
} from './middleware/security.js'
import { requireAuth } from './routes/auth.js'
import * as cacheStore from './services/cacheStore.js'

const app = express()

// Must be first: trust proxy so X-Forwarded-For is used (Docker/Nginx) and rate-limit keys by real client IP
app.set('trust proxy', true)

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

// CORS configuration – production frontend must be allowed so error responses include CORS headers
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:5173', // Vite dev server
  'https://bit-breaker-psi.vercel.app', // Production frontend (Vercel)
  'https://bitbreaker.optaimum.com',
  'https://www.bitbreaker.optaimum.com'
].filter(Boolean)

// Normalize origin (strip trailing slash, lowercase) so CORS matches Vercel and other hosts
function normalizeOrigin(o) {
  if (!o || typeof o !== 'string') return o
  return (o.replace(/\/+$/, '') || o).toLowerCase()
}

const allowedOriginsNormalized = new Set(allowedOrigins.map((x) => normalizeOrigin(x)))

function isOriginAllowed(origin) {
  if (!origin || typeof origin !== 'string') return false
  const o = normalizeOrigin(origin)
  if (allowedOriginsNormalized.has(o)) return true
  if (allowedOrigins.includes(origin) || allowedOrigins.includes(o)) return true
  if (o.endsWith('.vercel.app') || origin.endsWith('.vercel.app')) return true
  return false
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (isOriginAllowed(origin)) return callback(null, true)
    console.warn(`[CORS] Blocked request from origin: ${origin}`)
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-correlation-id']
}))

// Ensure CORS on every response (including 500) so browser gets headers
app.use((req, res, next) => {
  const raw = req.get('Origin')
  if (!raw) return next()
  if (isOriginAllowed(raw)) {
    res.setHeader('Access-Control-Allow-Origin', raw)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token, x-correlation-id')
  }
  next()
})

// Cookie parser (required for CSRF)
app.use(cookieParser())

// Disable trust-proxy validation: we intentionally use trust proxy behind Docker/nginx
const rateLimitValidate = { validate: { trustProxy: false } }

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 100 : 1000, // More lenient in development
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  ...rateLimitValidate
})
app.use(globalLimiter)

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 10 : 100,
  message: { error: 'Too many authentication attempts, please try again later' },
  ...rateLimitValidate
})

// Stricter rate limiting for payment endpoints
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 5 : 50,
  message: { error: 'Too many payment requests, please wait' },
  ...rateLimitValidate
})

// Stricter rate limiting for game submission
const gameLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProduction ? 20 : 100,
  message: { error: 'Too many game submissions' },
  ...rateLimitValidate
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

// CSRF token endpoint (requires auth so we can bind token to user for cross-origin)
app.get('/api/csrf-token', requireAuth, async (req, res) => {
  const token = req.cookies['csrf-token'] || req.csrfToken || generateCsrfToken()
  const CSRF_CACHE_TTL = 3600 // 1 hour
  await cacheStore.set(`csrf:${req.userId}`, token, CSRF_CACHE_TTL)
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
        // Allow in-memory stores in production with warning (sessions lost on restart)
        console.warn('  [WARN] REDIS_URL not set - using in-memory stores (sessions will be lost on restart)')
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
    const lnbitsUrl = (process.env.LNBITS_URL || '').toLowerCase()
    if (isProduction && (lnbitsUrl.includes('demo.lnbits.com') || lnbitsUrl === '')) {
      securityErrors.push(
        'LNBITS_URL must be set to your production LNbits instance (do not use demo.lnbits.com or leave unset)'
      )
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
