import { Router } from 'express'
import db from '../services/database.js'
import { requireAuth } from './auth.js'

const router = Router()

/**
 * Tournament Routes
 *
 * Endpoints for tournament info, leaderboards, and entries.
 */

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

    // Get entry count
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
        attempts: entry.attempts
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
