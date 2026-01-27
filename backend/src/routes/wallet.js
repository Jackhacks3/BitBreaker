import { Router } from 'express'
import db from '../services/database.js'
import { requireAuth } from './auth.js'
import { getBtcRate, getBuyInSats, satsToUsd, formatSats } from '../services/priceService.js'
import { createInvoice, checkPayment } from '../services/lightning.js'
import * as cache from '../services/cacheStore.js'

const router = Router()

/**
 * Wallet Routes for BITBRICK
 *
 * Manages user wallet balances, deposits, and withdrawals.
 * All payments in Bitcoin (Lightning Network).
 *
 * SECURITY FEATURES:
 * - TTL-based deposit tracking (no memory leaks)
 * - Comprehensive amount validation
 */

// Cache key prefixes for deposits
const DEPOSIT_PREFIX = 'deposit:'
const DEPOSIT_TTL = 10 * 60 // 10 minutes

/**
 * GET /api/wallet/balance
 * Get user's wallet balance
 */
router.get('/balance', requireAuth, async (req, res, next) => {
  try {
    const wallet = await db.wallets.getByUserId(req.userId)
    const balanceSats = wallet?.balance_sats || 0

    // Convert to USD for display
    const { usd, rate } = await satsToUsd(balanceSats)

    res.json({
      balanceSats,
      balanceUsd: usd,
      formattedSats: formatSats(balanceSats),
      exchangeRate: {
        btcUsd: rate.btcUsd,
        satsPerUsd: rate.satsPerUsd
      }
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/wallet/rate
 * Get current BTC/USD exchange rate
 */
router.get('/rate', async (req, res, next) => {
  try {
    const rate = await getBtcRate()
    const buyIn = await getBuyInSats()

    res.json({
      btcUsd: rate.btcUsd,
      satsPerUsd: rate.satsPerUsd,
      buyInUsd: buyIn.usd,
      buyInSats: buyIn.sats,
      cached: rate.cached,
      fetchedAt: rate.fetchedAt
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/wallet/deposit
 * Generate a Lightning invoice for depositing funds
 */
router.post('/deposit', requireAuth, async (req, res, next) => {
  try {
    const { amountSats } = req.body

    // Comprehensive amount validation
    if (
      amountSats === undefined ||
      amountSats === null ||
      typeof amountSats !== 'number' ||
      !Number.isFinite(amountSats) ||
      !Number.isInteger(amountSats) ||
      amountSats < 10
    ) {
      return res.status(400).json({
        error: 'Invalid amount. Minimum deposit is 10 sats (integer required)'
      })
    }

    if (amountSats > 10000000) { // 0.1 BTC max
      return res.status(400).json({ error: 'Maximum deposit is 10,000,000 sats' })
    }

    // Check for existing pending invoice for this user
    const userDepositKey = `${DEPOSIT_PREFIX}user:${req.userId}`
    const existingHash = await cache.get(userDepositKey)

    if (existingHash) {
      const existingInfo = await cache.get(`${DEPOSIT_PREFIX}${existingHash}`)
      if (existingInfo) {
        const expiresIn = Math.floor((existingInfo.createdAt + (DEPOSIT_TTL * 1000) - Date.now()) / 1000)
        if (expiresIn > 0) {
          return res.json({
            invoice: existingInfo.paymentRequest,
            paymentHash: existingHash,
            amount: existingInfo.amount,
            expiresIn
          })
        }
      }
      await cache.del(userDepositKey)
    }

    // Create Lightning invoice
    const { usd } = await satsToUsd(amountSats)
    const memo = `BITBRICK Deposit - ${formatSats(amountSats)} (~$${usd.toFixed(2)})`
    const invoice = await createInvoice(amountSats, memo)

    // Store pending deposit with TTL
    const depositData = {
      userId: req.userId,
      amount: amountSats,
      paymentRequest: invoice.paymentRequest,
      createdAt: Date.now()
    }

    await cache.set(`${DEPOSIT_PREFIX}${invoice.paymentHash}`, depositData, DEPOSIT_TTL)
    await cache.set(userDepositKey, invoice.paymentHash, DEPOSIT_TTL)

    console.log(`[WALLET] Deposit invoice created: ${invoice.paymentHash.substring(0, 16)}... for ${amountSats} sats`)

    res.json({
      invoice: invoice.paymentRequest,
      paymentHash: invoice.paymentHash,
      amount: amountSats,
      expiresIn: 600
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/wallet/deposit/status/:hash
 * Check deposit status
 */
router.get('/deposit/status/:hash', requireAuth, async (req, res, next) => {
  try {
    const { hash } = req.params

    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      return res.status(400).json({ error: 'Invalid payment hash' })
    }

    const pendingInfo = await cache.get(`${DEPOSIT_PREFIX}${hash}`)

    if (!pendingInfo) {
      return res.status(404).json({ error: 'Invoice not found or expired' })
    }

    if (pendingInfo.userId !== req.userId) {
      console.warn(`[SECURITY] User ${req.userId.substring(0, 8)}... tried to check someone else's deposit`)
      return res.status(403).json({ error: 'Access denied' })
    }

    // Check if expired (cache TTL handles this, but double-check)
    const age = Date.now() - pendingInfo.createdAt
    if (age > DEPOSIT_TTL * 1000) {
      await cache.del(`${DEPOSIT_PREFIX}${hash}`)
      return res.json({ paid: false, expired: true })
    }

    // Check payment via LNbits
    const paid = await checkPayment(hash)

    if (paid) {
      // SECURITY: Atomic delete to prevent race condition (double-credit)
      // If another request already processed this, del returns false
      const deleted = await cache.del(`${DEPOSIT_PREFIX}${hash}`)

      if (!deleted) {
        // Already processed by another concurrent request
        console.log(`[WALLET] Deposit already processed: ${hash.substring(0, 16)}...`)
        res.json({ paid: true, amount: pendingInfo.amount, alreadyProcessed: true })
        return
      }

      // Also clean up user deposit key
      await cache.del(`${DEPOSIT_PREFIX}user:${req.userId}`)

      // Credit wallet
      await db.wallets.credit(req.userId, pendingInfo.amount, 'deposit', `Lightning deposit`, hash)

      console.log(`[WALLET] Deposit completed: ${pendingInfo.amount} sats to user ${req.userId.substring(0, 8)}...`)

      res.json({ paid: true, amount: pendingInfo.amount })
    } else {
      res.json({ paid: false, expired: false })
    }
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/wallet/buy-in
 * Deduct $5 from wallet to enter tournament
 */
router.post('/buy-in', requireAuth, async (req, res, next) => {
  try {
    // Get current tournament
    const tournament = await db.tournaments.findCurrent()

    if (!tournament || tournament.status !== 'open') {
      return res.status(400).json({ error: 'No active tournament' })
    }

    // Check if already entered
    const existingEntry = await db.entries.findByUserAndTournament(req.userId, tournament.id)

    if (existingEntry) {
      return res.status(400).json({ error: 'Already entered this tournament' })
    }

    // Get buy-in amount in sats
    const { sats: buyInSats, usd: buyInUsd, rate } = await getBuyInSats()

    // Check wallet balance
    const wallet = await db.wallets.getByUserId(req.userId)
    const balance = wallet?.balance_sats || 0

    if (balance < buyInSats) {
      const { usd: balanceUsd } = await satsToUsd(balance)
      return res.status(400).json({
        error: 'Insufficient balance',
        required: buyInSats,
        requiredUsd: buyInUsd,
        balance: balance,
        balanceUsd: balanceUsd
      })
    }

    // Deduct from wallet
    await db.wallets.debit(req.userId, buyInSats, 'buy_in', `Tournament buy-in ${tournament.date}`)

    // Create tournament entry
    const entry = await db.entries.create(tournament.id, req.userId, 'wallet_buy_in')

    if (!entry) {
      // Refund if entry creation failed
      await db.wallets.credit(req.userId, buyInSats, 'buy_in', 'Buy-in refund - entry creation failed')
      return res.status(500).json({ error: 'Failed to create entry' })
    }

    // Update prize pool
    await db.tournaments.updatePrizePool(tournament.id, buyInSats)

    console.log(`[WALLET] Buy-in completed: ${buyInSats} sats from user ${req.userId.substring(0, 8)}...`)

    res.json({
      success: true,
      entryId: entry.id,
      deducted: buyInSats,
      deductedUsd: buyInUsd,
      exchangeRate: rate
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/wallet/transactions
 * Get user's transaction history
 */
router.get('/transactions', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const offset = parseInt(req.query.offset) || 0

    const transactions = await db.wallets.getTransactions(req.userId, limit, offset)

    res.json({
      transactions,
      limit,
      offset
    })
  } catch (error) {
    next(error)
  }
})

// Cache store handles TTL-based cleanup automatically - no manual cleanup needed
// This also enables graceful shutdown without orphaned intervals

export default router
