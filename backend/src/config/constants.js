/**
 * Shared Constants
 *
 * Single source of truth for configuration values used across the application.
 * Changes here should be reflected in database schema if applicable.
 */

// Game configuration
export const MAX_ATTEMPTS_PER_TOURNAMENT = 3
export const ATTEMPT_COST_USD = parseFloat(process.env.ATTEMPT_COST_USD) || 0.01  // Default to $0.01 for testing

// Prize distribution (must sum to 1.0 or less)
export const PRIZE_DISTRIBUTION = [
  { place: 1, percentage: 0.50 },  // 50% to 1st place
  { place: 2, percentage: 0.30 },  // 30% to 2nd place
  { place: 3, percentage: 0.20 }   // 20% to 3rd place
]

// House fee
export const HOUSE_FEE_PERCENTAGE = 0.02  // 2%

// Invoice/deposit timeouts
export const INVOICE_TTL_SECONDS = 600  // 10 minutes
export const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 3600  // 1 hour

// Session configuration
export const SESSION_TTL_HOURS = 24

// Rate limiting
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000  // 15 minutes
export const RATE_LIMIT_MAX_REQUESTS = 100

// Score validation
export const VALIDATION = {
  maxScorePerSecond: 50,
  minGameDurationMs: 5000,
  maxScorePerLevel: 1000,
  expectedFrameRate: 60,
  frameTolerance: 0.5,
  maxInputsPerSecond: 30
}

export default {
  MAX_ATTEMPTS_PER_TOURNAMENT,
  ATTEMPT_COST_USD,
  PRIZE_DISTRIBUTION,
  HOUSE_FEE_PERCENTAGE,
  INVOICE_TTL_SECONDS,
  WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
  SESSION_TTL_HOURS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  VALIDATION
}
