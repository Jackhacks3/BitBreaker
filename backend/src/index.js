import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import cron from 'node-cron'

// Load environment variables
dotenv.config()

// Import routes
import authRoutes from './routes/auth.js'
import tournamentRoutes from './routes/tournaments.js'
import paymentRoutes from './routes/payments.js'
import gameRoutes from './routes/game.js'

// Import services
import { initDatabase } from './services/database.js'
import { TournamentEngine } from './services/tournamentEngine.js'

const app = express()
const PORT = process.env.PORT || 4000

// Security middleware
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}))

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' }
})
app.use(limiter)

// Body parsing
app.use(express.json({ limit: '1mb' }))

// Request logging (simple)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`)
  next()
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/tournaments', tournamentRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/game', gameRoutes)

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err)
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Initialize and start
async function start() {
  try {
    // Initialize database
    await initDatabase()
    console.log('Database initialized')

    // Initialize tournament engine
    const tournamentEngine = new TournamentEngine()

    // Create today's tournament if doesn't exist
    await tournamentEngine.ensureTodaysTournament()
    console.log('Tournament engine ready')

    // Schedule daily tournament creation (midnight UTC)
    cron.schedule('0 0 * * *', async () => {
      console.log('Creating new daily tournament...')
      await tournamentEngine.createDailyTournament()
    }, { timezone: 'UTC' })

    // Schedule tournament closing (23:59 UTC)
    cron.schedule('59 23 * * *', async () => {
      console.log('Closing today\'s tournament...')
      await tournamentEngine.closeTournament()
    }, { timezone: 'UTC' })

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()
