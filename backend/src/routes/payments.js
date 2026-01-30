import { Router } from 'express'
import crypto from 'crypto'
import db from '../services/database.js'
import { requireAuth } from './auth.js'
import { createInvoice, checkPayment, payToAddress } from '../services/lightning.js'
import * as cache from '../services/cacheStore.js'
import { WEBHOOK_IDEMPOTENCY_TTL_SECONDS, INVOICE_TTL_SECONDS } from '../config/constants.js'
import { normalizePaymentHash } from '../utils/paymentHash.js'

const router = Router()

// Deposit invoices use this prefix in cache (must match wallet.js)
const DEPOSIT_PREFIX = 'deposit:'

/**
 * Payment Routes
 *
 * SECURITY FEATURES:
 * - Webhook signature verification (CRITICAL)
 * - Idempotency protection (no double-entry)
 * - Redis-backed invoice tracking with TTL
 * - Rate limiting on invoice creation
 * - Memory-bounded cache with automatic eviction
 */

// Cache key prefixes
const INVOICE_PREFIX = 'invoice:'
const WEBHOOK_PREFIX = 'webhook:'
const INVOICE_TTL = INVOICE_TTL_SECONDS // From constants.js
const WEBHOOK_TTL = WEBHOOK_IDEMPOTENCY_TTL_SECONDS // 24 hours from constants.js

/**
 * Verify webhook signature from LNbits
 *
 * CRITICAL: Without this, attackers can fake payment confirmations
 * and get free tournament entries
 *
 * SECURITY: Webhook signature verification is ALWAYS required.
 * The ALLOW_UNSIGNED_WEBHOOKS bypass has been removed for security.
 *
 * @param {Request} req - Express request
 * @returns {boolean} - True if signature is valid
 */
function verifyWebhookSignature(req) {
  const webhookSecret = process.env.LNBITS_WEBHOOK_SECRET

  // SECURITY: Webhook secret is REQUIRED in all environments
  if (!webhookSecret) {
    console.error('[SECURITY] LNBITS_WEBHOOK_SECRET not configured - rejecting webhook')
    console.error('[SECURITY] Configure LNBITS_WEBHOOK_SECRET in your environment')
    return false
  }

  // Get signature from header
  // LNbits uses different headers depending on version
  const signature = req.headers['x-lnbits-signature'] ||
                    req.headers['x-webhook-signature'] ||
                    req.headers['x-signature']

  if (!signature) {
    console.error('[SECURITY] Webhook missing signature header')
    return false
  }

  // CRITICAL: Use rawBody for signature verification
  // JSON.stringify(req.body) doesn't guarantee key ordering and can fail verification
  // rawBody is stored in index.js body parser verify callback
  const payload = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body)

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex')

  // Timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    // Buffers must be same length for timingSafeEqual
    if (sigBuffer.length !== expectedBuffer.length) {
      console.error('[SECURITY] Webhook signature length mismatch')
      return false
    }

    const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer)

    if (!isValid) {
      console.error('[SECURITY] Webhook signature mismatch - possible attack')
    }

    return isValid
  } catch (error) {
    console.error('[SECURITY] Webhook signature verification error:', error.message)
    return false
  }
}

/**
 * POST /api/payments/buy-in
 * Generate a Lightning invoice for tournament buy-in
 */
router.post('/buy-in', requireAuth, async (req, res, next) => {
  try {
    // Get current tournament
    const tournament = await db.tournaments.findCurrent()

    if (!tournament) {
      return res.status(400).json({ error: 'No active tournament', code: 'NO_TOURNAMENT' })
    }

    if (tournament.status !== 'open') {
      return res.status(400).json({ error: 'Tournament is closed', code: 'TOURNAMENT_CLOSED' })
    }

    // Check if user already has entry
    const existingEntry = await db.entries.findByUserAndTournament(req.userId, tournament.id)

    if (existingEntry) {
      return res.status(400).json({ error: 'You already have an entry in this tournament', code: 'DUPLICATE_ENTRY' })
    }

    // Check for existing pending invoice for this user/tournament
    const userInvoiceKey = `${INVOICE_PREFIX}user:${req.userId}:${tournament.id}`
    const existingHash = await cache.get(userInvoiceKey)

    if (existingHash) {
      const existingInfo = await cache.get(`${INVOICE_PREFIX}${existingHash}`)
      if (existingInfo) {
        const expiresIn = Math.floor((existingInfo.createdAt + (INVOICE_TTL * 1000) - Date.now()) / 1000)
        if (expiresIn > 0) {
          return res.json({
            invoice: existingInfo.paymentRequest,
            paymentHash: existingHash,
            amount: parseInt(tournament.buy_in_sats),
            expiresIn
          })
        }
      }
      // Remove expired references
      await cache.del(userInvoiceKey)
    }

    // Create Lightning invoice
    const memo = `Brick Breaker Tournament - ${tournament.date}`
    const invoice = await createInvoice(parseInt(tournament.buy_in_sats), memo)
    const paymentHash = normalizePaymentHash(invoice.paymentHash) || invoice.paymentHash

    // Store pending invoice with TTL (normalized hash for webhook lookup)
    const invoiceData = {
      tournamentId: tournament.id,
      userId: req.userId,
      amount: parseInt(tournament.buy_in_sats),
      paymentRequest: invoice.paymentRequest,
      createdAt: Date.now()
    }

    await cache.set(`${INVOICE_PREFIX}${paymentHash}`, invoiceData, INVOICE_TTL)
    await cache.set(userInvoiceKey, paymentHash, INVOICE_TTL)

    console.log(`[PAYMENT] Invoice created for user ${req.userId.substring(0, 8)}...: ${paymentHash.substring(0, 16)}...`)

    res.json({
      invoice: invoice.paymentRequest,
      paymentHash,
      amount: parseInt(tournament.buy_in_sats),
      expiresIn: 600 // 10 minutes
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/payments/status/:hash
 * Check if payment has been received
 */
router.get('/status/:hash', requireAuth, async (req, res, next) => {
  try {
    const hash = normalizePaymentHash(req.params.hash)
    if (!hash) {
      return res.status(400).json({ error: 'Invalid payment hash format', code: 'INVALID_HASH' })
    }

    const pendingInfo = await cache.get(`${INVOICE_PREFIX}${hash}`)

    if (!pendingInfo) {
      // Check if user already has entry (payment might have been processed via webhook)
      const tournament = await db.tournaments.findCurrent()
      if (tournament) {
        const entry = await db.entries.findByUserAndTournament(req.userId, tournament.id)
        if (entry) {
          return res.json({ paid: true, entryId: entry.id })
        }
      }
      return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' })
    }

    // Verify this invoice belongs to requesting user
    if (pendingInfo.userId !== req.userId) {
      console.warn(`[SECURITY] User ${req.userId.substring(0, 8)}... tried to check someone else's invoice`)
      return res.status(403).json({ error: 'Access denied', code: 'UNAUTHORIZED' })
    }

    // Check if expired (cache TTL handles this, but double-check)
    const age = Date.now() - pendingInfo.createdAt
    if (age > INVOICE_TTL * 1000) {
      await cache.del(`${INVOICE_PREFIX}${hash}`)
      return res.json({ paid: false, expired: true, code: 'INVOICE_EXPIRED' })
    }

    // Check if payment received via LNbits API (pass through raw for API call)
    const paid = await checkPayment(hash)

    if (paid) {
      // Process the payment (create entry)
      const result = await processPayment(hash, pendingInfo)

      if (result.success) {
        res.json({ paid: true, entryId: result.entryId })
      } else {
        // Entry might already exist (race condition with webhook)
        const entry = await db.entries.findByUserAndTournament(pendingInfo.userId, pendingInfo.tournamentId)
        res.json({ paid: true, entryId: entry?.id })
      }
    } else {
      res.json({ paid: false, expired: false })
    }
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/payments/webhook
 * Webhook for LNbits payment notifications
 *
 * SECURITY: Signature verification required
 */
router.post('/webhook', async (req, res, next) => {
  try {
    // CRITICAL: Verify webhook signature
    if (!verifyWebhookSignature(req)) {
      console.error('[SECURITY] Invalid webhook signature - rejecting')
      return res.status(401).json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' })
    }

    const { payment_hash: rawHash, paid } = req.body

    // Must have payment_hash and paid=true
    if (!rawHash || !paid) {
      return res.json({ received: true })
    }

    const payment_hash = normalizePaymentHash(rawHash)
    if (!payment_hash) {
      console.warn('[PAYMENT] Webhook with invalid payment_hash format')
      return res.json({ received: true })
    }

    // Idempotency check - prevent processing same webhook twice
    const idempotencyKey = `${WEBHOOK_PREFIX}${payment_hash}`
    const isNew = await cache.setIfNotExists(idempotencyKey, WEBHOOK_TTL)

    if (!isNew) {
      // Webhook seen before - check if it was fully processed or crashed midway
      const invoiceStillExists = await cache.get(`${INVOICE_PREFIX}${payment_hash}`)
      const depositStillExists = await cache.get(`${DEPOSIT_PREFIX}${payment_hash}`)
      
      if (!invoiceStillExists && !depositStillExists) {
        // Payment fully processed (cache entries deleted) - safe to ignore
        console.log(`[PAYMENT] Duplicate webhook ignored (already processed): ${payment_hash.substring(0, 16)}...`)
        return res.json({ received: true, duplicate: true })
      }
      
      // Cache entries still exist - previous webhook crashed before processing
      // Allow retry to complete the payment
      console.log(`[PAYMENT] Retrying crashed webhook: ${payment_hash.substring(0, 16)}...`)
    }

    let pendingInfo = await cache.get(`${INVOICE_PREFIX}${payment_hash}`)

    // If not a buy-in invoice, check for deposit invoice
    if (!pendingInfo) {
      const depositInfo = await cache.get(`${DEPOSIT_PREFIX}${payment_hash}`)
      if (depositInfo) {
        // Atomic claim: if we delete it, we're responsible for processing
        const deleted = await cache.del(`${DEPOSIT_PREFIX}${payment_hash}`)
        if (!deleted) {
          // Another handler (webhook or poll) already processed this
          console.log(`[PAYMENT] Deposit already processed by another handler: ${payment_hash.substring(0, 16)}...`)
          return res.json({ received: true, alreadyProcessed: true })
        }
        await cache.del(`${DEPOSIT_PREFIX}user:${depositInfo.userId}`)
        await db.wallets.credit(depositInfo.userId, depositInfo.amount, 'deposit', 'Lightning deposit', payment_hash)
        console.log(`[PAYMENT] Deposit credited via webhook: ${depositInfo.amount} sats to user ${depositInfo.userId.substring(0, 8)}...`)
        return res.json({ received: true, processed: true, type: 'deposit' })
      }
      console.log(`[PAYMENT] Webhook for unknown invoice: ${payment_hash.substring(0, 16)}...`)
      return res.json({ received: true, unknown: true })
    }

    // Process the buy-in payment
    const result = await processPayment(payment_hash, pendingInfo)

    console.log(`[PAYMENT] Webhook processed: ${payment_hash.substring(0, 16)}... - success: ${result.success}`)

    res.json({ received: true, processed: result.success })
  } catch (error) {
    next(error)
  }
})

/**
 * Process a confirmed payment
 * Creates tournament entry and updates prize pool (in a single transaction when DB supports it)
 *
 * @param {string} paymentHash - Normalized payment hash
 * @param {Object} pendingInfo - Pending invoice info
 * @returns {Promise<{success: boolean, entryId?: string}>}
 */
async function processPayment(paymentHash, pendingInfo) {
  try {
    const runInTransaction = async (client) => {
      const existingEntry = await db.entries.findByUserAndTournament(
        pendingInfo.userId,
        pendingInfo.tournamentId,
        client
      )
      if (existingEntry) {
        return { existing: true, entryId: existingEntry.id }
      }
      const entry = await db.entries.create(
        pendingInfo.tournamentId,
        pendingInfo.userId,
        paymentHash,
        client
      )
      if (!entry) {
        return { success: false }
      }
      await db.tournaments.updatePrizePool(
        pendingInfo.tournamentId,
        pendingInfo.amount,
        client
      )
      return { success: true, entryId: entry.id }
    }

    const result = await db.withTransaction(runInTransaction)

    if (result.existing) {
      console.log(`[PAYMENT] Entry already exists for user ${pendingInfo.userId.substring(0, 8)}...`)
      await cache.del(`${INVOICE_PREFIX}${paymentHash}`)
      return { success: true, entryId: result.entryId }
    }
    if (!result.success) {
      console.error(`[PAYMENT] Failed to create entry for payment ${paymentHash.substring(0, 16)}...`)
      return { success: false }
    }

    await cache.del(`${INVOICE_PREFIX}${paymentHash}`)
    console.log(`[PAYMENT] Entry created: ${result.entryId} for user ${pendingInfo.userId.substring(0, 8)}...`)
    return { success: true, entryId: result.entryId }
  } catch (error) {
    console.error('[PAYMENT] Process payment error:', error)
    return { success: false }
  }
}

/**
 * Process pending payouts (called by tournament engine)
 */
export async function processPayout(payout) {
  try {
    console.log(`[PAYOUT] Processing payout ${payout.id}: ${payout.amount_sats} sats to ${payout.lightning_address}`)

    const result = await payToAddress(
      payout.lightning_address,
      parseInt(payout.amount_sats),
      `Brick Breaker Prize - Place ${payout.place}`
    )

    if (result.success) {
      await db.payouts.markPaid(payout.id, result.paymentHash)
      console.log(`[PAYOUT] Success: ${result.paymentHash}`)
      return true
    }

    console.error(`[PAYOUT] Failed: ${result.error}`)
    return false
  } catch (error) {
    console.error('[PAYOUT] Error:', error)
    return false
  }
}

// Cache store handles TTL automatically - no manual cleanup needed
// This also enables graceful shutdown without orphaned intervals

export default router
