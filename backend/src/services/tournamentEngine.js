/**
 * Tournament Engine
 *
 * Manages the daily tournament lifecycle:
 * - Creates new tournaments at midnight UTC
 * - Closes tournaments at 23:59 UTC
 * - Calculates and distributes prizes to top 3
 * - Takes 2% house fee
 */

import db from './database.js'
import { payToAddress } from './lightning.js'

// Prize distribution (of 98% after house fee)
const PRIZE_DISTRIBUTION = [
  { place: 1, percentage: 0.50 }, // 50% to 1st
  { place: 2, percentage: 0.30 }, // 30% to 2nd
  { place: 3, percentage: 0.20 }  // 20% to 3rd
]

const HOUSE_FEE_PERCENTAGE = 0.02 // 2%

export class TournamentEngine {
  constructor() {
    this.isProcessing = false
  }

  /**
   * Ensure today's tournament exists
   */
  async ensureTodaysTournament() {
    const today = new Date().toISOString().split('T')[0]
    let tournament = await db.tournaments.findByDate(today)

    if (!tournament) {
      tournament = await this.createDailyTournament()
    }

    return tournament
  }

  /**
   * Create a new daily tournament
   */
  async createDailyTournament() {
    const today = new Date().toISOString().split('T')[0]
    const buyInSats = parseInt(process.env.BUY_IN_SATS) || 10000

    const tournament = await db.tournaments.create(today, buyInSats)

    if (tournament) {
      console.log(`Created tournament for ${today} with ${buyInSats} sat buy-in`)
    }

    return tournament
  }

  /**
   * Close the current tournament and process payouts
   */
  async closeTournament() {
    if (this.isProcessing) {
      console.log('Tournament close already in progress')
      return
    }

    this.isProcessing = true

    try {
      const tournament = await db.tournaments.findCurrent()

      if (!tournament) {
        console.log('No tournament to close')
        return
      }

      if (tournament.status !== 'open') {
        console.log('Tournament already closed')
        return
      }

      console.log(`Closing tournament ${tournament.id}...`)

      // Get top 3 players
      const winners = await db.entries.getTopThree(tournament.id)

      if (winners.length === 0) {
        console.log('No participants - closing without payouts')
        await db.tournaments.close(tournament.id)
        return
      }

      // Calculate prize pool after house fee
      const totalPool = parseInt(tournament.prize_pool_sats)
      const houseFee = Math.floor(totalPool * HOUSE_FEE_PERCENTAGE)
      const distributablePool = totalPool - houseFee

      console.log(`Prize pool: ${totalPool} sats`)
      console.log(`House fee (2%): ${houseFee} sats`)
      console.log(`Distributable: ${distributablePool} sats`)

      // Calculate and create payouts
      const payouts = []

      for (let i = 0; i < Math.min(winners.length, 3); i++) {
        const winner = winners[i]
        const distribution = PRIZE_DISTRIBUTION[i]
        const amount = Math.floor(distributablePool * distribution.percentage)

        if (amount > 0) {
          const payout = await db.payouts.create(
            tournament.id,
            winner.user_id,
            distribution.place,
            amount,
            winner.lightning_address
          )

          payouts.push({
            ...payout,
            displayName: winner.display_name,
            score: winner.best_score
          })

          console.log(`${distribution.place}${this.getOrdinalSuffix(distribution.place)} place: ${winner.display_name} - ${amount} sats`)
        }
      }

      // Process payouts (send Lightning payments)
      for (const payout of payouts) {
        await this.processPayout(payout)
      }

      // Mark tournament as completed
      await db.tournaments.close(tournament.id)

      console.log(`Tournament ${tournament.id} closed successfully`)

      // Create tomorrow's tournament
      await this.createNextDayTournament()

    } catch (error) {
      console.error('Error closing tournament:', error)
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Process a single payout with comprehensive audit logging
   */
  async processPayout(payout) {
    const auditData = {
      payoutId: payout.id,
      tournamentId: payout.tournament_id,
      userId: payout.user_id?.substring(0, 8) + '...',
      place: payout.place,
      amountSats: parseInt(payout.amount_sats),
      lightningAddress: payout.lightning_address,
      displayName: payout.displayName,
      score: payout.score,
      timestamp: new Date().toISOString()
    }

    console.log('[PAYOUT] Processing:', JSON.stringify(auditData))

    try {
      const result = await payToAddress(
        payout.lightning_address,
        parseInt(payout.amount_sats),
        `Brick Breaker - ${payout.place}${this.getOrdinalSuffix(payout.place)} Place Prize!`
      )

      if (result.success) {
        await db.payouts.markPaid(payout.id, result.paymentHash)

        // Comprehensive success log for audit
        console.log('[PAYOUT] SUCCESS:', JSON.stringify({
          ...auditData,
          paymentHash: result.paymentHash,
          status: 'completed',
          completedAt: new Date().toISOString()
        }))

        return true
      } else {
        // Comprehensive failure log for audit
        console.error('[PAYOUT] FAILED:', JSON.stringify({
          ...auditData,
          error: result.error,
          status: 'failed',
          failedAt: new Date().toISOString()
        }))

        return false
      }
    } catch (error) {
      // Comprehensive error log for audit
      console.error('[PAYOUT] ERROR:', JSON.stringify({
        ...auditData,
        error: error.message,
        status: 'error',
        errorAt: new Date().toISOString()
      }))

      return false
    }
  }

  /**
   * Create tournament for the next day
   */
  async createNextDayTournament() {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    const existing = await db.tournaments.findByDate(tomorrowStr)

    if (!existing) {
      const buyInSats = parseInt(process.env.BUY_IN_SATS) || 10000
      await db.tournaments.create(tomorrowStr, buyInSats)
      console.log(`Created tournament for ${tomorrowStr}`)
    }
  }

  /**
   * Get ordinal suffix (1st, 2nd, 3rd)
   */
  getOrdinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return s[(v - 20) % 10] || s[v] || s[0]
  }

  /**
   * Retry failed payouts
   */
  async retryFailedPayouts() {
    const pending = await db.payouts.getPending()

    for (const payout of pending) {
      // Only retry payouts older than 5 minutes
      const age = Date.now() - new Date(payout.created_at).getTime()
      if (age > 5 * 60 * 1000) {
        console.log(`Retrying payout ${payout.id}...`)
        await this.processPayout(payout)
      }
    }
  }

  /**
   * Get tournament statistics
   */
  async getStats() {
    const tournament = await db.tournaments.findCurrent()

    if (!tournament) {
      return null
    }

    const leaderboard = await db.entries.getLeaderboard(tournament.id, 100)
    const totalPool = parseInt(tournament.prize_pool_sats)
    const houseFee = Math.floor(totalPool * HOUSE_FEE_PERCENTAGE)
    const distributablePool = totalPool - houseFee

    return {
      tournament: {
        id: tournament.id,
        date: tournament.date,
        status: tournament.status,
        buyInSats: parseInt(tournament.buy_in_sats),
        prizePoolSats: totalPool,
        distributableSats: distributablePool,
        houseFeeSats: houseFee
      },
      entryCount: leaderboard.length,
      prizes: PRIZE_DISTRIBUTION.map(p => ({
        place: p.place,
        amount: Math.floor(distributablePool * p.percentage)
      }))
    }
  }
}

export default TournamentEngine
