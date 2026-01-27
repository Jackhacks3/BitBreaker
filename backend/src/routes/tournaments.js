import { Router } from 'express'
import db from '../services/database.js'
import { requireAuth } from './auth.js'
import { satsToUsd, getBuyInSats } from '../services/priceService.js'

const router = Router()

/**
 * Tournament Routes
 *
 * Endpoints for tournament info, leaderboards, and entries.
 */

// House fee percentage (2%)
const HOUSE_FEE_PERCENT = 0.02

/**
 * GET /api/tournaments/current
 * Get today's tournament info
 */
router.get('/current', async (req, res, next) => {
  try {
    const tournament = await db.tournaments.findCurrent()

    if (!tournament) {
      return res.status(404).json({ error: 'No active tournament' })
    }

    // Get tournament stats
    const stats = await db.entries.getTournamentStats(tournament.id)

    // Convert prize pool to USD
    const prizePoolSats = parseInt(tournament.prize_pool_sats) || 0
    const { usd: prizePoolUsd, rate } = await satsToUsd(prizePoolSats)

    // Calculate distributable prize (after house fee)
    const distributableSats = Math.floor(prizePoolSats * (1 - HOUSE_FEE_PERCENT))
    const { usd: distributableUsd } = await satsToUsd(distributableSats)

    // Get buy-in info
    const buyIn = await getBuyInSats()

    res.json({
      id: tournament.id,
      date: tournament.date,
      buyInSats: buyIn.sats,
      buyInUsd: buyIn.usd,
      prizePoolSats,
      prizePoolUsd,
      jackpotUsd: distributableUsd, // Amount winners split
      houseFeePercent: HOUSE_FEE_PERCENT * 100,
      status: tournament.status,
      startTime: tournament.start_time,
      endTime: tournament.end_time,
      playerCount: stats.playerCount,
      totalAttempts: stats.totalAttempts,
      entryCount: stats.playerCount, // Kept for backwards compatibility
      payoutStructure: {
        first: { percent: 50, sats: Math.floor(distributableSats * 0.5), usd: Math.round(distributableUsd * 0.5 * 100) / 100 },
        second: { percent: 30, sats: Math.floor(distributableSats * 0.3), usd: Math.round(distributableUsd * 0.3 * 100) / 100 },
        third: { percent: 20, sats: Math.floor(distributableSats * 0.2), usd: Math.round(distributableUsd * 0.2 * 100) / 100 }
      },
      exchangeRate: rate
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/tournaments/current/leaderboard
 * Get leaderboard for today's tournament
 */
router.get('/current/leaderboard', async (req, res, next) => {
  try {
    const tournament = await db.tournaments.findCurrent()

    if (!tournament) {
      return res.json([])
    }

    const entries = await db.entries.getLeaderboard(tournament.id, 100)

    res.json(entries.map(e => ({
      userId: e.user_id,
      displayName: e.display_name,
      bestScore: e.best_score
    })))
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/tournaments/current/entry
 * Check if current user has an entry
 */
router.get('/current/entry', requireAuth, async (req, res, next) => {
  try {
    const tournament = await db.tournaments.findCurrent()

    if (!tournament) {
      return res.json({ hasEntry: false })
    }

    const entry = await db.entries.findByUserAndTournament(req.userId, tournament.id)

    res.json({
      hasEntry: !!entry,
      entry: entry ? {
        bestScore: entry.best_score,
        attempts: entry.attempts,
        attemptsUsed: entry.attempts_used || 0,
        maxAttempts: entry.max_attempts || 3,
        scores: {
          attempt1: entry.attempt_1_score,
          attempt2: entry.attempt_2_score,
          attempt3: entry.attempt_3_score
        }
      } : null
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/tournaments/:id
 * Get specific tournament info
 */
router.get('/:id', async (req, res, next) => {
  try {
    const tournament = await db.queryOne(
      'SELECT * FROM tournaments WHERE id = $1',
      [req.params.id]
    )

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' })
    }

    const entries = await db.entries.getLeaderboard(tournament.id, 1000)

    res.json({
      id: tournament.id,
      date: tournament.date,
      buyInSats: parseInt(tournament.buy_in_sats),
      prizePoolSats: parseInt(tournament.prize_pool_sats),
      status: tournament.status,
      startTime: tournament.start_time,
      endTime: tournament.end_time,
      entryCount: entries.length
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/tournaments/:id/leaderboard
 * Get leaderboard for specific tournament
 */
router.get('/:id/leaderboard', async (req, res, next) => {
  try {
    const entries = await db.entries.getLeaderboard(req.params.id, 100)

    res.json(entries.map(e => ({
      userId: e.user_id,
      displayName: e.display_name,
      bestScore: e.best_score
    })))
  } catch (error) {
    next(error)
  }
})

export default router
