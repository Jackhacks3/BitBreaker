import { Router } from 'express'
import db from '../services/database.js'
import { requireAuth } from './auth.js'
import { createInvoice, checkPayment, payToAddress } from '../services/lightning.js'

const router = Router()

/**
 * Payment Routes
 *
 * Lightning Network payment handling:
 * - Generate invoices for buy-ins
 * - Check payment status
 * - Process payouts
 */

// Track pending invoices (use Redis in production)
const pendingInvoices = new Map()

/**
 * POST /api/payments/buy-in
 * Generate a Lightning invoice for tournament buy-in
 */
router.post('/buy-in', requireAuth, async (req, res, next) => {
  try {
    // Get current tournament
    const tournament = await db.tournaments.findCurrent()

    if (!tournament) {
      return res.status(400).json({ error: 'No active tournament' })
    }

    if (tournament.status !== 'open') {
      return res.status(400).json({ error: 'Tournament is closed' })
    }

    // Check if user already has entry
    const existingEntry = await db.entries.findByUserAndTournament(req.userId, tournament.id)

    if (existingEntry) {
      return res.status(400).json({ error: 'You already have an entry in this tournament' })
    }

    // Get user info
    const user = await db.users.findById(req.userId)

    // Create Lightning invoice
    const memo = `Brick Breaker Tournament - ${tournament.date}`
    const invoice = await createInvoice(parseInt(tournament.buy_in_sats), memo)

    // Store pending invoice
    pendingInvoices.set(invoice.paymentHash, {
      tournamentId: tournament.id,
      userId: req.userId,
      amount: parseInt(tournament.buy_in_sats),
      createdAt: Date.now()
    })

    res.json({
      invoice: invoice.paymentRequest,
      paymentHash: invoice.paymentHash,
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
    const { hash } = req.params
    const pendingInfo = pendingInvoices.get(hash)

    if (!pendingInfo) {
      return res.status(404).json({ error: 'Invoice not found' })
    }

    // Check if payment received
    const paid = await checkPayment(hash)

    if (paid) {
      // Create tournament entry
      const entry = await db.entries.create(
        pendingInfo.tournamentId,
        pendingInfo.userId,
        hash
      )

      // Update prize pool
      await db.tournaments.updatePrizePool(
        pendingInfo.tournamentId,
        pendingInfo.amount
      )

      // Remove from pending
      pendingInvoices.delete(hash)

      res.json({ paid: true, entryId: entry?.id })
    } else {
      // Check if expired (10 minutes)
      if (Date.now() - pendingInfo.createdAt > 10 * 60 * 1000) {
        pendingInvoices.delete(hash)
        return res.json({ paid: false, expired: true })
      }

      res.json({ paid: false, expired: false })
    }
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/payments/webhook
 * Webhook for LNbits payment notifications
 */
router.post('/webhook', async (req, res, next) => {
  try {
    const { payment_hash, paid } = req.body

    if (!paid || !payment_hash) {
      return res.json({ received: true })
    }

    const pendingInfo = pendingInvoices.get(payment_hash)

    if (pendingInfo) {
      // Create tournament entry
      await db.entries.create(
        pendingInfo.tournamentId,
        pendingInfo.userId,
        payment_hash
      )

      // Update prize pool
      await db.tournaments.updatePrizePool(
        pendingInfo.tournamentId,
        pendingInfo.amount
      )

      pendingInvoices.delete(payment_hash)
    }

    res.json({ received: true })
  } catch (error) {
    next(error)
  }
})

/**
 * Process pending payouts (called by tournament engine)
 */
export async function processPayout(payout) {
  try {
    const result = await payToAddress(
      payout.lightning_address,
      parseInt(payout.amount_sats),
      `Brick Breaker Prize - Place ${payout.place}`
    )

    if (result.success) {
      await db.payouts.markPaid(payout.id, result.paymentHash)
      return true
    }

    return false
  } catch (error) {
    console.error('Payout error:', error)
    return false
  }
}

// Cleanup expired invoices periodically
setInterval(() => {
  const now = Date.now()
  const maxAge = 10 * 60 * 1000 // 10 minutes

  for (const [hash, info] of pendingInvoices.entries()) {
    if (now - info.createdAt > maxAge) {
      pendingInvoices.delete(hash)
    }
  }
}, 60 * 1000) // Run every minute

export default router
