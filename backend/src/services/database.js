import crypto from 'crypto'

/**
 * Database Service
 *
 * Supports two modes:
 * 1. PostgreSQL (production) - when DATABASE_URL is valid
 * 2. In-memory mock (development) - when no database available
 */

let useMockDb = false
let pool = null

// In-memory mock storage
const mockData = {
  users: new Map(),
  tournaments: new Map(),
  entries: new Map(),
  sessions: new Map(),
  payouts: new Map()
}

// Try to connect to PostgreSQL
async function tryPostgres() {
  if (!process.env.DATABASE_URL || process.env.USE_MOCK_DB === 'true') {
    return false
  }

  try {
    const pg = await import('pg')
    pool = new pg.default.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    })

    // Test connection
    const client = await pool.connect()
    await client.query('SELECT 1')
    client.release()
    return true
  } catch (error) {
    console.warn('PostgreSQL not available:', error.message)
    return false
  }
}

/**
 * Initialize database
 */
export async function initDatabase() {
  const pgAvailable = await tryPostgres()

  if (pgAvailable) {
    console.log('Using PostgreSQL database')
    useMockDb = false

    // Create schema
    const client = await pool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          display_name VARCHAR(50) NOT NULL,
          lightning_address VARCHAR(255) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS tournaments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          date DATE UNIQUE NOT NULL,
          buy_in_sats BIGINT NOT NULL DEFAULT 10000,
          prize_pool_sats BIGINT DEFAULT 0,
          status VARCHAR(20) DEFAULT 'open',
          start_time TIMESTAMP DEFAULT NOW(),
          end_time TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS tournament_entries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tournament_id UUID REFERENCES tournaments(id),
          user_id UUID REFERENCES users(id),
          payment_hash VARCHAR(64),
          paid_at TIMESTAMP,
          best_score INT DEFAULT 0,
          attempts INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(tournament_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS game_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entry_id UUID REFERENCES tournament_entries(id),
          score INT NOT NULL,
          level INT DEFAULT 1,
          duration_ms INT,
          input_hash VARCHAR(64),
          verified BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS payouts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tournament_id UUID REFERENCES tournaments(id),
          user_id UUID REFERENCES users(id),
          place INT,
          amount_sats BIGINT,
          lightning_address VARCHAR(255),
          payment_hash VARCHAR(64),
          status VARCHAR(20) DEFAULT 'pending',
          paid_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `)
      console.log('PostgreSQL schema initialized')
    } finally {
      client.release()
    }
  } else {
    console.log('Using in-memory mock database (development mode)')
    useMockDb = true
  }
}

// Generate UUID
function uuid() {
  return crypto.randomUUID()
}

// Query helpers
export async function query(text, params) {
  if (useMockDb) {
    throw new Error('Use specific db functions in mock mode')
  }
  return pool.query(text, params)
}

export async function queryOne(text, params) {
  if (useMockDb) {
    throw new Error('Use specific db functions in mock mode')
  }
  const result = await pool.query(text, params)
  return result.rows[0] || null
}

export async function queryMany(text, params) {
  if (useMockDb) {
    throw new Error('Use specific db functions in mock mode')
  }
  const result = await pool.query(text, params)
  return result.rows
}

// ============= USER FUNCTIONS =============
export const users = {
  async create(displayName, lightningAddress) {
    if (useMockDb) {
      // Check if exists
      for (const user of mockData.users.values()) {
        if (user.lightning_address === lightningAddress) {
          user.display_name = displayName
          return user
        }
      }
      const user = {
        id: uuid(),
        display_name: displayName,
        lightning_address: lightningAddress,
        created_at: new Date()
      }
      mockData.users.set(user.id, user)
      return user
    }
    return queryOne(
      `INSERT INTO users (display_name, lightning_address)
       VALUES ($1, $2)
       ON CONFLICT (lightning_address) DO UPDATE SET display_name = $1
       RETURNING *`,
      [displayName, lightningAddress]
    )
  },

  async findById(id) {
    if (useMockDb) {
      return mockData.users.get(id) || null
    }
    return queryOne('SELECT * FROM users WHERE id = $1', [id])
  },

  async findByLightningAddress(address) {
    if (useMockDb) {
      for (const user of mockData.users.values()) {
        if (user.lightning_address === address) return user
      }
      return null
    }
    return queryOne('SELECT * FROM users WHERE lightning_address = $1', [address])
  }
}

// ============= TOURNAMENT FUNCTIONS =============
export const tournaments = {
  async create(date, buyInSats = 10000) {
    const endTime = new Date(date)
    endTime.setHours(23, 59, 59, 999)

    if (useMockDb) {
      // Check if exists
      for (const t of mockData.tournaments.values()) {
        if (t.date === date) return null
      }
      const tournament = {
        id: uuid(),
        date: date,
        buy_in_sats: buyInSats,
        prize_pool_sats: 0,
        status: 'open',
        start_time: new Date(),
        end_time: endTime,
        created_at: new Date()
      }
      mockData.tournaments.set(tournament.id, tournament)
      return tournament
    }
    return queryOne(
      `INSERT INTO tournaments (date, buy_in_sats, end_time)
       VALUES ($1, $2, $3)
       ON CONFLICT (date) DO NOTHING
       RETURNING *`,
      [date, buyInSats, endTime]
    )
  },

  async findByDate(date) {
    if (useMockDb) {
      for (const t of mockData.tournaments.values()) {
        if (t.date === date) return t
      }
      return null
    }
    return queryOne('SELECT * FROM tournaments WHERE date = $1', [date])
  },

  async findCurrent() {
    const today = new Date().toISOString().split('T')[0]
    return this.findByDate(today)
  },

  async updatePrizePool(id, amount) {
    if (useMockDb) {
      const t = mockData.tournaments.get(id)
      if (t) {
        t.prize_pool_sats = (t.prize_pool_sats || 0) + amount
        return t
      }
      return null
    }
    return queryOne(
      `UPDATE tournaments SET prize_pool_sats = prize_pool_sats + $2 WHERE id = $1 RETURNING *`,
      [id, amount]
    )
  },

  async close(id) {
    if (useMockDb) {
      const t = mockData.tournaments.get(id)
      if (t) {
        t.status = 'completed'
        return t
      }
      return null
    }
    return queryOne(`UPDATE tournaments SET status = 'completed' WHERE id = $1 RETURNING *`, [id])
  }
}

// ============= ENTRY FUNCTIONS =============
export const entries = {
  async create(tournamentId, userId, paymentHash) {
    if (useMockDb) {
      // Check if exists
      for (const e of mockData.entries.values()) {
        if (e.tournament_id === tournamentId && e.user_id === userId) return null
      }
      const entry = {
        id: uuid(),
        tournament_id: tournamentId,
        user_id: userId,
        payment_hash: paymentHash,
        paid_at: new Date(),
        best_score: 0,
        attempts: 0,
        created_at: new Date()
      }
      mockData.entries.set(entry.id, entry)
      return entry
    }
    return queryOne(
      `INSERT INTO tournament_entries (tournament_id, user_id, payment_hash, paid_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tournament_id, user_id) DO NOTHING
       RETURNING *`,
      [tournamentId, userId, paymentHash]
    )
  },

  async findByUserAndTournament(userId, tournamentId) {
    if (useMockDb) {
      for (const e of mockData.entries.values()) {
        if (e.user_id === userId && e.tournament_id === tournamentId) return e
      }
      return null
    }
    return queryOne(
      `SELECT * FROM tournament_entries WHERE user_id = $1 AND tournament_id = $2`,
      [userId, tournamentId]
    )
  },

  async updateBestScore(id, score) {
    if (useMockDb) {
      const e = mockData.entries.get(id)
      if (e) {
        e.best_score = Math.max(e.best_score || 0, score)
        e.attempts = (e.attempts || 0) + 1
        return e
      }
      return null
    }
    return queryOne(
      `UPDATE tournament_entries
       SET best_score = GREATEST(best_score, $2), attempts = attempts + 1
       WHERE id = $1 RETURNING *`,
      [id, score]
    )
  },

  async getLeaderboard(tournamentId, limit = 100) {
    if (useMockDb) {
      const results = []
      for (const e of mockData.entries.values()) {
        if (e.tournament_id === tournamentId && e.best_score > 0) {
          const user = mockData.users.get(e.user_id)
          results.push({
            user_id: e.user_id,
            best_score: e.best_score,
            display_name: user?.display_name || 'Unknown'
          })
        }
      }
      return results.sort((a, b) => b.best_score - a.best_score).slice(0, limit)
    }
    return queryMany(
      `SELECT e.user_id, e.best_score, u.display_name
       FROM tournament_entries e
       JOIN users u ON e.user_id = u.id
       WHERE e.tournament_id = $1 AND e.best_score > 0
       ORDER BY e.best_score DESC
       LIMIT $2`,
      [tournamentId, limit]
    )
  },

  async getTopThree(tournamentId) {
    if (useMockDb) {
      const results = []
      for (const e of mockData.entries.values()) {
        if (e.tournament_id === tournamentId) {
          const user = mockData.users.get(e.user_id)
          results.push({
            ...e,
            display_name: user?.display_name || 'Unknown',
            lightning_address: user?.lightning_address
          })
        }
      }
      return results.sort((a, b) => b.best_score - a.best_score).slice(0, 3)
    }
    return queryMany(
      `SELECT e.*, u.display_name, u.lightning_address
       FROM tournament_entries e
       JOIN users u ON e.user_id = u.id
       WHERE e.tournament_id = $1
       ORDER BY e.best_score DESC
       LIMIT 3`,
      [tournamentId]
    )
  }
}

// ============= SESSION FUNCTIONS =============
export const sessions = {
  async create(entryId, score, level, durationMs, inputHash) {
    if (useMockDb) {
      const session = {
        id: uuid(),
        entry_id: entryId,
        score,
        level,
        duration_ms: durationMs,
        input_hash: inputHash,
        verified: false,
        created_at: new Date()
      }
      mockData.sessions.set(session.id, session)
      return session
    }
    return queryOne(
      `INSERT INTO game_sessions (entry_id, score, level, duration_ms, input_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [entryId, score, level, durationMs, inputHash]
    )
  }
}

// ============= PAYOUT FUNCTIONS =============
export const payouts = {
  async create(tournamentId, userId, place, amountSats, lightningAddress) {
    if (useMockDb) {
      const payout = {
        id: uuid(),
        tournament_id: tournamentId,
        user_id: userId,
        place,
        amount_sats: amountSats,
        lightning_address: lightningAddress,
        status: 'pending',
        created_at: new Date()
      }
      mockData.payouts.set(payout.id, payout)
      return payout
    }
    return queryOne(
      `INSERT INTO payouts (tournament_id, user_id, place, amount_sats, lightning_address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tournamentId, userId, place, amountSats, lightningAddress]
    )
  },

  async markPaid(id, paymentHash) {
    if (useMockDb) {
      const p = mockData.payouts.get(id)
      if (p) {
        p.status = 'paid'
        p.payment_hash = paymentHash
        p.paid_at = new Date()
        return p
      }
      return null
    }
    return queryOne(
      `UPDATE payouts SET status = 'paid', payment_hash = $2, paid_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, paymentHash]
    )
  },

  async getPending() {
    if (useMockDb) {
      return Array.from(mockData.payouts.values()).filter(p => p.status === 'pending')
    }
    return queryMany(`SELECT * FROM payouts WHERE status = 'pending' ORDER BY created_at`)
  }
}

export default { query, queryOne, queryMany, users, tournaments, entries, sessions, payouts }
