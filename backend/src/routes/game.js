import { Router } from 'express'
import crypto from 'crypto'
import db from '../services/database.js'
import { requireAuth } from './auth.js'
import {
  sanitizeScore,
  sanitizeDuration,
  sanitizeLevel
} from '../utils/sanitize.js'
import { getBuyInSats, satsToUsd } from '../services/priceService.js'
import * as cache from '../services/cacheStore.js'
import {
  MAX_ATTEMPTS_PER_TOURNAMENT,
  ATTEMPT_COST_USD,
  VALIDATION
} from '../config/constants.js'

const router = Router()

/**
 * Game Routes
 *
 * SECURITY FEATURES:
 * - Input sanitization and validation
 * - Anti-cheat score validation
 * - Rate limiting (applied in index.js)
 * - Session-bound submissions
 * - Per-attempt payment tracking
 * - TTL-based attempt tracking (no memory leaks)
 */

// Game configuration (from shared constants)
const GAME_CONFIG = {
  maxAttemptsPerDay: MAX_ATTEMPTS_PER_TOURNAMENT,
  attemptCostUsd: ATTEMPT_COST_USD
}

// Score validation constants (from shared constants)
const VALIDATION_CONFIG = VALIDATION

// Cache key prefix for active attempts
const ATTEMPT_PREFIX = 'attempt:'
const ATTEMPT_TTL = 60 * 60 // 1 hour max game session

/**
 * GET /api/game/attempts
 * Get user's attempt status for today
 */
router.get('/attempts', requireAuth, async (req, res, next) => {
  try {
    const tournament = await db.tournaments.findCurrent()

    if (!tournament || tournament.status !== 'open') {
      return res.json({
        attemptsUsed: 0,
        attemptsRemaining: GAME_CONFIG.maxAttemptsPerDay,
        maxAttempts: GAME_CONFIG.maxAttemptsPerDay,
        canPlay: false,
        reason: 'No active tournament',
        nextResetAt: null
      })
    }

    // Get or check entry
    const entry = await db.entries.findByUserAndTournament(req.userId, tournament.id)

    const attemptsUsed = entry?.attempts_used || 0
    const attemptsRemaining = GAME_CONFIG.maxAttemptsPerDay - attemptsUsed

    // Get wallet balance
    const wallet = await db.wallets.getByUserId(req.userId)
    const balanceSats = wallet?.balance_sats || 0
    const { sats: costSats } = await getBuyInSats()
    const hasBalance = balanceSats >= costSats

    // Calculate next reset time (midnight UTC)
    const nextResetAt = new Date()
    nextResetAt.setUTCHours(24, 0, 0, 0)

    res.json({
      attemptsUsed,
      attemptsRemaining,
      maxAttempts: GAME_CONFIG.maxAttemptsPerDay,
      canPlay: attemptsRemaining > 0 && hasBalance,
      hasBalance,
      balanceSats,
      costSats,
      costUsd: GAME_CONFIG.attemptCostUsd,
      nextResetAt: nextResetAt.toISOString(),
      scores: {
        attempt1: entry?.attempt_1_score || null,
        attempt2: entry?.attempt_2_score || null,
        attempt3: entry?.attempt_3_score || null,
        best: entry?.best_score || 0
      }
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/game/start-attempt
 * Start a new game attempt - deducts $5 from wallet
 */
router.post('/start-attempt', requireAuth, async (req, res, next) => {
  try {
    const tournament = await db.tournaments.findCurrent()

    if (!tournament || tournament.status !== 'open') {
      return res.status(400).json({ error: 'No active tournament' })
    }

    // Get or create entry for this tournament (atomic operation - handles race conditions)
    // ON CONFLICT in the database layer ensures only one entry is created
    const entry = await db.entries.getOrCreateEntry(tournament.id, req.userId)

    if (!entry) {
      console.error(`[GAME] Failed to get/create entry for user ${req.userId.substring(0, 8)}...`)
      return res.status(500).json({ error: 'Failed to create tournament entry' })
    }

    // Check attempts limit
    const attemptsUsed = entry.attempts_used || 0
    if (attemptsUsed >= GAME_CONFIG.maxAttemptsPerDay) {
      return res.status(400).json({
        error: 'Maximum attempts reached for today',
        code: 'MAX_ATTEMPTS',
        attemptsUsed,
        maxAttempts: GAME_CONFIG.maxAttemptsPerDay
      })
    }

    // Get cost in sats
    const { sats: costSats, usd: costUsd, rate } = await getBuyInSats()

    // Check wallet balance
    const wallet = await db.wallets.getByUserId(req.userId)
    const balanceSats = wallet?.balance_sats || 0

    if (balanceSats < costSats) {
      const { usd: balanceUsd } = await satsToUsd(balanceSats)
      return res.status(400).json({
        error: 'Insufficient balance',
        code: 'INSUFFICIENT_BALANCE',
        required: costSats,
        requiredUsd: costUsd,
        balance: balanceSats,
        balanceUsd
      })
    }

    // Deduct from wallet (using 'buy_in' type which is allowed by DB constraint)
    await db.wallets.debit(req.userId, costSats, 'buy_in', `Game attempt ${attemptsUsed + 1}`)

    // Increment attempt counter
    const updatedEntry = await db.entries.incrementAttempt(entry.id)

    if (!updatedEntry) {
      // Refund if increment failed
      await db.wallets.credit(req.userId, costSats, 'refund', 'Attempt start refund')
      return res.status(500).json({ error: 'Failed to start attempt' })
    }

    // Update prize pool
    await db.tournaments.updatePrizePool(tournament.id, costSats)

    // Generate attempt ID
    const attemptId = crypto.randomBytes(16).toString('hex')
    const attemptNumber = updatedEntry.attempts_used

    // Track active attempt with TTL (auto-expires after 1 hour)
    await cache.set(`${ATTEMPT_PREFIX}${attemptId}`, {
      userId: req.userId,
      entryId: entry.id,
      attemptNumber,
      startedAt: Date.now()
    }, ATTEMPT_TTL)

    // Get updated wallet and jackpot
    const newWallet = await db.wallets.getByUserId(req.userId)
    const { usd: jackpotUsd } = await satsToUsd(parseInt(tournament.prize_pool_sats) + costSats)

    console.log(`[GAME] Attempt ${attemptNumber} started for user ${req.userId.substring(0, 8)}... ($${costUsd})`)

    res.json({
      success: true,
      attemptId,
      attemptNumber,
      attemptsRemaining: GAME_CONFIG.maxAttemptsPerDay - attemptNumber,
      costSats,
      costUsd,
      newBalanceSats: newWallet.balance_sats,
      currentJackpotUsd: jackpotUsd,
      exchangeRate: rate
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/game/submit
 * Submit a completed game session
 */
router.post('/submit', requireAuth, async (req, res, next) => {
  try {
    const { score, level, duration, inputLog, frameCount, attemptId } = req.body

    // Sanitize and validate score
    const scoreResult = sanitizeScore(score)
    if (!scoreResult.valid) {
      return res.status(400).json({ error: scoreResult.error })
    }

    // Sanitize and validate level
    const levelResult = sanitizeLevel(level)
    if (!levelResult.valid) {
      return res.status(400).json({ error: levelResult.error })
    }

    // Sanitize and validate duration
    const durationResult = sanitizeDuration(duration)
    if (!durationResult.valid) {
      return res.status(400).json({ error: durationResult.error })
    }

    // Use sanitized values
    const cleanScore = scoreResult.value
    const cleanLevel = levelResult.value
    const cleanDuration = durationResult.value

    // Validate frame count if provided
    let cleanFrameCount = null
    if (frameCount !== undefined) {
      if (typeof frameCount !== 'number' || !Number.isInteger(frameCount) || frameCount < 0) {
        return res.status(400).json({ error: 'Invalid frame count' })
      }
      cleanFrameCount = frameCount
    }

    // SECURITY: Limit inputLog size to prevent memory exhaustion
    if (inputLog !== undefined) {
      if (!Array.isArray(inputLog)) {
        return res.status(400).json({ error: 'Input log must be an array' })
      }
      if (inputLog.length > 50000) {
        return res.status(400).json({ error: 'Input log exceeds maximum size' })
      }
    }

    // Get current tournament
    const tournament = await db.tournaments.findCurrent()

    if (!tournament || tournament.status !== 'open') {
      return res.status(400).json({ error: 'No active tournament', code: 'NO_TOURNAMENT' })
    }

    // Check user has entry
    const entry = await db.entries.findByUserAndTournament(req.userId, tournament.id)

    if (!entry) {
      return res.status(403).json({ error: 'No tournament entry found', code: 'NO_ENTRY' })
    }

    // Validate attemptId if provided (new flow)
    let attemptNumber = null
    if (attemptId) {
      const activeAttempt = await cache.get(`${ATTEMPT_PREFIX}${attemptId}`)
      if (!activeAttempt) {
        return res.status(400).json({ error: 'Invalid or expired attempt ID', code: 'INVALID_ATTEMPT' })
      }
      if (activeAttempt.userId !== req.userId) {
        console.warn(`[SECURITY] User ${req.userId.substring(0, 8)}... tried to submit someone else's attempt`)
        return res.status(403).json({ error: 'Attempt does not belong to this user', code: 'UNAUTHORIZED_ATTEMPT' })
      }
      attemptNumber = activeAttempt.attemptNumber
      // Remove from active attempts (TTL handles cleanup, but remove early for security)
      await cache.del(`${ATTEMPT_PREFIX}${attemptId}`)
    }

    // Anti-cheat validation
    const validation = validateGameSession({
      score: cleanScore,
      level: cleanLevel,
      duration: cleanDuration,
      frameCount: cleanFrameCount,
      inputLog
    })

    if (!validation.valid) {
      // Log without exposing user ID - use hashed session identifier for correlation
      const sessionHash = crypto.createHash('sha256').update(req.userId + Date.now().toString()).digest('hex').substring(0, 12)
      console.warn(`[ANTICHEAT] Suspicious submission [session:${sessionHash}]:`, {
        reasons: validation.reasons,
        score: cleanScore,
        duration: cleanDuration,
        confidence: validation.confidence
      })
      return res.status(400).json({
        error: 'Score validation failed',
        code: 'VALIDATION_FAILED'
      })
    }

    // Log warnings without user identification
    if (validation.warnings.length > 0) {
      console.log(`[ANTICHEAT] Validation warnings:`, {
        warnings: validation.warnings,
        score: cleanScore,
        confidence: validation.confidence
      })
    }

    // Create input hash for replay verification
    const inputHash = inputLog
      ? crypto.createHash('sha256').update(JSON.stringify(inputLog)).digest('hex').substring(0, 64)
      : null

    // Record game session
    await db.sessions.create(entry.id, cleanScore, cleanLevel, cleanDuration, inputHash)

    // Update score - use attempt-specific recording if attemptId was provided
    let updatedEntry
    if (attemptNumber) {
      updatedEntry = await db.entries.recordAttemptScore(entry.id, attemptNumber, cleanScore)
    } else {
      // Legacy flow - just update best score
      updatedEntry = await db.entries.updateBestScore(entry.id, cleanScore)
    }

    console.log(`[GAME] Score submitted: ${cleanScore} by user ${req.userId.substring(0, 8)}... (attempt: ${attemptNumber || 'legacy'}, best: ${updatedEntry.best_score})`)

    res.json({
      success: true,
      score: cleanScore,
      bestScore: updatedEntry.best_score,
      attempts: updatedEntry.attempts,
      attemptNumber,
      isNewBest: cleanScore >= updatedEntry.best_score,
      scores: {
        attempt1: updatedEntry.attempt_1_score,
        attempt2: updatedEntry.attempt_2_score,
        attempt3: updatedEntry.attempt_3_score
      }
    })
  } catch (error) {
    next(error)
  }
})

/**
 * Validate game session against expected mechanics
 *
 * @param {Object} data - Game session data
 * @returns {{valid: boolean, reasons: string[], warnings: string[], confidence: number}}
 */
function validateGameSession(data) {
  const { score, level, duration, frameCount, inputLog } = data
  const errors = []
  const warnings = []

  // 1. Score rate validation (points per second)
  const durationSec = duration / 1000
  const scorePerSecond = score / durationSec

  if (scorePerSecond > VALIDATION_CONFIG.maxScorePerSecond) {
    errors.push(`Score rate too high: ${scorePerSecond.toFixed(1)}/sec (max: ${VALIDATION_CONFIG.maxScorePerSecond})`)
  } else if (scorePerSecond > VALIDATION_CONFIG.maxScorePerSecond * 0.8) {
    warnings.push(`Score rate near limit: ${scorePerSecond.toFixed(1)}/sec`)
  }

  // 2. Level vs score correlation
  const avgScorePerLevel = score / level

  if (avgScorePerLevel > VALIDATION_CONFIG.maxScorePerLevel) {
    errors.push(`Score per level too high: ${avgScorePerLevel.toFixed(0)} (max: ${VALIDATION_CONFIG.maxScorePerLevel})`)
  } else if (avgScorePerLevel > VALIDATION_CONFIG.maxScorePerLevel * 0.8) {
    warnings.push(`Score per level near limit: ${avgScorePerLevel.toFixed(0)}`)
  }

  // 3. Frame count validation (detect speedhacks)
  if (frameCount !== null) {
    const expectedFrames = durationSec * VALIDATION_CONFIG.expectedFrameRate
    const frameDiff = Math.abs(frameCount - expectedFrames) / expectedFrames

    if (frameDiff > VALIDATION_CONFIG.frameTolerance) {
      errors.push(`Frame count suspicious: ${frameCount} vs expected ${expectedFrames.toFixed(0)} (${(frameDiff * 100).toFixed(1)}% off)`)
    } else if (frameDiff > VALIDATION_CONFIG.frameTolerance * 0.5) {
      warnings.push(`Frame count variance: ${(frameDiff * 100).toFixed(1)}%`)
    }
  }

  // 4. Input log analysis (if provided)
  if (inputLog && Array.isArray(inputLog) && inputLog.length > 0) {
    const inputAnalysis = analyzeInputPattern(inputLog, duration)

    if (inputAnalysis.superhuman) {
      errors.push('Input speed exceeds human capability')
    }

    if (inputAnalysis.tooRegular) {
      warnings.push('Suspiciously regular input timing (possible automation)')
    }

    if (inputAnalysis.suspiciousPatterns) {
      warnings.push('Unusual input patterns detected')
    }
  }

  // Calculate confidence score (0-100)
  let confidence = 100
  confidence -= errors.length * 30
  confidence -= warnings.length * 10
  confidence = Math.max(0, Math.min(100, confidence))

  return {
    valid: errors.length === 0,
    reasons: errors,
    warnings,
    confidence
  }
}

/**
 * Analyze input patterns for bot detection
 *
 * @param {Array} inputs - Array of input events
 * @param {number} duration - Game duration in ms
 * @returns {{superhuman: boolean, tooRegular: boolean, suspiciousPatterns: boolean}}
 */
function analyzeInputPattern(inputs, duration) {
  if (inputs.length < 10) {
    return { superhuman: false, tooRegular: false, suspiciousPatterns: false }
  }

  // Calculate time intervals between inputs
  const intervals = []
  for (let i = 1; i < inputs.length; i++) {
    const prevTime = inputs[i - 1].t || inputs[i - 1].timestamp || 0
    const currTime = inputs[i].t || inputs[i].timestamp || 0
    if (currTime > prevTime) {
      intervals.push(currTime - prevTime)
    }
  }

  if (intervals.length < 5) {
    return { superhuman: false, tooRegular: false, suspiciousPatterns: false }
  }

  // Check for superhuman speed (minimum human reaction time ~50ms)
  const minInterval = Math.min(...intervals)
  const superhuman = minInterval < 16 // Less than 1 frame at 60fps is suspicious

  // Check for too-regular patterns (bots often have constant intervals)
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
  const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length
  const stdDev = Math.sqrt(variance)
  const coefficientOfVariation = stdDev / avgInterval

  // Humans typically have CV > 0.2, bots are more regular
  const tooRegular = coefficientOfVariation < 0.05 && intervals.length > 20

  // Check input rate
  const inputsPerSecond = inputs.length / (duration / 1000)
  const suspiciousPatterns = inputsPerSecond > VALIDATION_CONFIG.maxInputsPerSecond

  return {
    superhuman,
    tooRegular,
    suspiciousPatterns
  }
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

// Cache store handles TTL-based cleanup automatically - no manual cleanup needed

export default router
