import { Router } from 'express'
import crypto from 'crypto'
import db from '../services/database.js'
import { requireAuth } from './auth.js'

const router = Router()

/**
 * Game Routes
 *
 * Handle game session submission and score validation.
 * Includes basic anti-cheat measures.
 */

// Score validation constants
const MAX_SCORE_PER_SECOND = 50 // Maximum reasonable score per second
const MIN_GAME_DURATION_MS = 5000 // Minimum 5 seconds
const MAX_SCORE_PER_LEVEL = 1000 // Reasonable max per level

/**
 * POST /api/game/submit
 * Submit a completed game session
 */
router.post('/submit', requireAuth, async (req, res, next) => {
  try {
    const { score, level, duration, inputLog, frameCount } = req.body

    // Validate required fields
    if (typeof score !== 'number' || score < 0) {
      return res.status(400).json({ error: 'Invalid score' })
    }

    if (typeof level !== 'number' || level < 1) {
      return res.status(400).json({ error: 'Invalid level' })
    }

    if (typeof duration !== 'number' || duration < MIN_GAME_DURATION_MS) {
      return res.status(400).json({ error: 'Game too short' })
    }

    // Get current tournament
    const tournament = await db.tournaments.findCurrent()

    if (!tournament || tournament.status !== 'open') {
      return res.status(400).json({ error: 'No active tournament' })
    }

    // Check user has entry
    const entry = await db.entries.findByUserAndTournament(req.userId, tournament.id)

    if (!entry) {
      return res.status(403).json({ error: 'No tournament entry found' })
    }

    // Basic anti-cheat validation
    const validation = validateScore(score, level, duration, frameCount)

    if (!validation.valid) {
      console.warn(`Suspicious score from user ${req.userId}:`, validation.reason)
      return res.status(400).json({ error: 'Score validation failed' })
    }

    // Create input hash for replay verification
    const inputHash = inputLog
      ? crypto.createHash('sha256').update(JSON.stringify(inputLog)).digest('hex').substring(0, 64)
      : null

    // Record game session
    await db.sessions.create(entry.id, score, level, duration, inputHash)

    // Update best score
    const updatedEntry = await db.entries.updateBestScore(entry.id, score)

    res.json({
      success: true,
      score,
      bestScore: updatedEntry.best_score,
      attempts: updatedEntry.attempts,
      isNewBest: score >= updatedEntry.best_score
    })
  } catch (error) {
    next(error)
  }
})

/**
 * Validate score against expected game mechanics
 */
function validateScore(score, level, duration, frameCount) {
  // Check score rate (points per second)
  const durationSec = duration / 1000
  const scorePerSecond = score / durationSec

  if (scorePerSecond > MAX_SCORE_PER_SECOND) {
    return { valid: false, reason: `Score rate too high: ${scorePerSecond.toFixed(1)}/sec` }
  }

  // Check level vs score correlation
  // Each level should contribute roughly 100-500 points
  const avgScorePerLevel = score / level

  if (avgScorePerLevel > MAX_SCORE_PER_LEVEL) {
    return { valid: false, reason: `Score per level too high: ${avgScorePerLevel.toFixed(0)}` }
  }

  // Check frame count (should be roughly duration * 60fps / 1000)
  if (frameCount) {
    const expectedFrames = (duration / 1000) * 60
    const frameDiff = Math.abs(frameCount - expectedFrames) / expectedFrames

    if (frameDiff > 0.5) { // More than 50% deviation
      return { valid: false, reason: `Frame count suspicious: ${frameCount} vs expected ${expectedFrames.toFixed(0)}` }
    }
  }

  // Score is plausible
  return { valid: true }
}

/**
 * GET /api/game/stats
 * Get user's game statistics
 */
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const tournament = await db.tournaments.findCurrent()

    if (!tournament) {
      return res.json({
        currentTournament: null,
        entry: null
      })
    }

    const entry = await db.entries.findByUserAndTournament(req.userId, tournament.id)

    res.json({
      currentTournament: {
        id: tournament.id,
        date: tournament.date,
        status: tournament.status
      },
      entry: entry ? {
        bestScore: entry.best_score,
        attempts: entry.attempts
      } : null
    })
  } catch (error) {
    next(error)
  }
})

export default router
