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

    // Get tournament stats (defensive: default to 0 if query fails)
    let stats = { playerCount: 0, totalAttempts: 0 }
    try {
      stats = await db.entries.getTournamentStats(tournament.id) || stats
      stats.playerCount = Number(stats.playerCount) || 0
      stats.totalAttempts = Number(stats.totalAttempts) || 0
    } catch (statsErr) {
      console.error('[TOURNAMENTS] getTournamentStats error:', statsErr?.message || statsErr)
    }

    const prizePoolSats = parseInt(tournament.prize_pool_sats, 10) || 0
    const distributableSats = Math.floor(prizePoolSats * (1 - HOUSE_FEE_PERCENT))

    // Price conversions (defensive: use fallback if price service fails)
    let prizePoolUsd = 0
    let distributableUsd = 0
    let rate = { btcUsd: 100000, satsPerUsd: 1000 }
    let buyIn = { sats: 10000, usd: 5 }
    try {
      const priceResult = await satsToUsd(prizePoolSats)
      prizePoolUsd = Number(priceResult?.usd) || 0
      rate = priceResult?.rate || rate
      const distResult = await satsToUsd(distributableSats)
      distributableUsd = Number(distResult?.usd) || 0
      buyIn = await getBuyInSats()
      buyIn = { sats: Number(buyIn?.sats) || 10000, usd: Number(buyIn?.usd) || 5 }
    } catch (priceErr) {
      console.error('[TOURNAMENTS] Price conversion error:', priceErr?.message || priceErr)
      // Use rough defaults so response still returns
      const fallbackBtc = Number(process.env.BTC_FALLBACK_PRICE) || 100000
      rate = { btcUsd: fallbackBtc, satsPerUsd: Math.round(100_000_000 / fallbackBtc) }
      prizePoolUsd = prizePoolSats / rate.satsPerUsd
      distributableUsd = distributableSats / rate.satsPerUsd
    }

    const firstUsd = Math.round(distributableUsd * 0.5 * 100) / 100
    const secondUsd = Math.round(distributableUsd * 0.3 * 100) / 100
    const thirdUsd = Math.round(distributableUsd * 0.2 * 100) / 100

    res.json({
      id: tournament.id,
      date: tournament.date,
      buyInSats: buyIn.sats,
      buyInUsd: buyIn.usd,
      prizePoolSats,
      prizePoolUsd,
      jackpotUsd: distributableUsd,
      houseFeePercent: HOUSE_FEE_PERCENT * 100,
      status: tournament.status || 'open',
      startTime: tournament.start_time,
      endTime: tournament.end_time,
      playerCount: stats.playerCount,
      totalAttempts: stats.totalAttempts,
      entryCount: stats.playerCount,
      payoutStructure: {
        first: { percent: 50, sats: Math.floor(distributableSats * 0.5), usd: firstUsd },
        second: { percent: 30, sats: Math.floor(distributableSats * 0.3), usd: secondUsd },
        third: { percent: 20, sats: Math.floor(distributableSats * 0.2), usd: thirdUsd }
      },
      exchangeRate: rate
    })
  } catch (error) {
    console.error('[TOURNAMENTS] /current error:', error?.message || error)
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
    const list = Array.isArray(entries) ? entries : []

    res.json(list.map(e => ({
      userId: e?.user_id ?? null,
      displayName: e?.display_name ?? 'Player',
      bestScore: Number(e?.best_score) || 0
    })))
  } catch (error) {
    console.error('[TOURNAMENTS] Leaderboard error:', error?.message || error)
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
    const list = Array.isArray(entries) ? entries : []

    res.json(list.map(e => ({
      userId: e?.user_id ?? null,
      displayName: e?.display_name ?? 'Player',
      bestScore: Number(e?.best_score) || 0
    })))
  } catch (error) {
    console.error('[TOURNAMENTS] Leaderboard by id error:', error?.message || error)
    next(error)
  }
})

export default router
