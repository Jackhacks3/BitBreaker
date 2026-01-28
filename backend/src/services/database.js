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
  payouts: new Map(),
  whitelist: new Map(),
  lnurlChallenges: new Map(),
  wallets: new Map(),
  transactions: new Map()
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
      // Configurable pool settings via environment variables
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS) || 2000
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
          username VARCHAR(30) UNIQUE,
          password_hash VARCHAR(255),
          lightning_address VARCHAR(255) UNIQUE,
          last_login_at TIMESTAMP,
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
          attempts_used INT DEFAULT 0,
          max_attempts INT DEFAULT 3,
          attempt_1_score INT,
          attempt_2_score INT,
          attempt_3_score INT,
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

        -- Whitelist for approved wallet public keys
        CREATE TABLE IF NOT EXISTS whitelist (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          linking_key VARCHAR(66) UNIQUE NOT NULL,
          display_name VARCHAR(50),
          is_admin BOOLEAN DEFAULT FALSE,
          approved_at TIMESTAMP DEFAULT NOW(),
          approved_by UUID REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW()
        );

        -- LNURL-auth challenges
        CREATE TABLE IF NOT EXISTS lnurl_challenges (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          k1 VARCHAR(64) UNIQUE NOT NULL,
          linking_key VARCHAR(66),
          status VARCHAR(20) DEFAULT 'pending',
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );

        -- User wallets for balance tracking
        CREATE TABLE IF NOT EXISTS user_wallets (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) UNIQUE NOT NULL,
          balance_sats BIGINT DEFAULT 0 CHECK (balance_sats >= 0),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );

        -- Transaction history
        CREATE TABLE IF NOT EXISTS transactions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) NOT NULL,
          type VARCHAR(20) NOT NULL,
          amount_sats BIGINT NOT NULL,
          description TEXT,
          reference VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW()
        );

        -- Ensure display_name column exists
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='users' AND column_name='display_name') THEN
            ALTER TABLE users ADD COLUMN display_name VARCHAR(50);
          END IF;
        END $$;

        -- Add linking_key to users table if not exists
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='users' AND column_name='linking_key') THEN
            ALTER TABLE users ADD COLUMN linking_key VARCHAR(66) UNIQUE;
          END IF;
        END $$;

        -- Add username/password columns to users table
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='users' AND column_name='username') THEN
            ALTER TABLE users ADD COLUMN username VARCHAR(30) UNIQUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='users' AND column_name='password_hash') THEN
            ALTER TABLE users ADD COLUMN password_hash VARCHAR(255);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='users' AND column_name='last_login_at') THEN
            ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP;
          END IF;
        END $$;

        -- Make lightning_address nullable (only if it exists and is NOT NULL)
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users'
            AND column_name = 'lightning_address'
            AND is_nullable = 'NO'
          ) THEN
            ALTER TABLE users ALTER COLUMN lightning_address DROP NOT NULL;
          END IF;
        END $$;

        -- Add attempt tracking columns to tournament_entries
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='tournament_entries' AND column_name='attempts_used') THEN
            ALTER TABLE tournament_entries ADD COLUMN attempts_used INT DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='tournament_entries' AND column_name='max_attempts') THEN
            ALTER TABLE tournament_entries ADD COLUMN max_attempts INT DEFAULT 3;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='tournament_entries' AND column_name='attempt_1_score') THEN
            ALTER TABLE tournament_entries ADD COLUMN attempt_1_score INT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='tournament_entries' AND column_name='attempt_2_score') THEN
            ALTER TABLE tournament_entries ADD COLUMN attempt_2_score INT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='tournament_entries' AND column_name='attempt_3_score') THEN
            ALTER TABLE tournament_entries ADD COLUMN attempt_3_score INT;
          END IF;
        END $$;
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

/**
 * Custom database error class for better error handling
 */
export class DatabaseError extends Error {
  constructor(message, { cause, query, code } = {}) {
    super(message)
    this.name = 'DatabaseError'
    this.cause = cause
    this.query = query ? query.substring(0, 100) : undefined // Truncate for logging
    this.code = code
  }
}

// Query helpers with error handling
// SECURITY: In production, don't log query text to prevent info leaks
const isProduction = process.env.NODE_ENV === 'production'

export async function query(text, params) {
  if (useMockDb) {
    throw new Error('Use specific db functions in mock mode')
  }

  try {
    return await pool.query(text, params)
  } catch (error) {
    if (isProduction) {
      // Production: Only log error code, not query text
      console.error('[DB] Query failed:', { code: error.code })
    } else {
      // Development: Include query for debugging
      console.error('[DB] Query failed:', {
        query: text.substring(0, 100),
        code: error.code,
        message: error.message
      })
    }
    throw new DatabaseError('Database query failed', {
      cause: error,
      query: isProduction ? undefined : text,
      code: error.code
    })
  }
}

export async function queryOne(text, params) {
  if (useMockDb) {
    throw new Error('Use specific db functions in mock mode')
  }

  try {
    const result = await pool.query(text, params)
    return result.rows[0] || null
  } catch (error) {
    if (isProduction) {
      console.error('[DB] Query failed:', { code: error.code })
    } else {
      console.error('[DB] Query failed:', {
        query: text.substring(0, 100),
        code: error.code,
        message: error.message
      })
    }
    throw new DatabaseError('Database query failed', {
      cause: error,
      query: isProduction ? undefined : text,
      code: error.code
    })
  }
}

export async function queryMany(text, params) {
  if (useMockDb) {
    throw new Error('Use specific db functions in mock mode')
  }

  try {
    const result = await pool.query(text, params)
    return result.rows
  } catch (error) {
    if (isProduction) {
      console.error('[DB] Query failed:', { code: error.code })
    } else {
      console.error('[DB] Query failed:', {
        query: text.substring(0, 100),
        code: error.code,
        message: error.message
      })
    }
    throw new DatabaseError('Database query failed', {
      cause: error,
      query: isProduction ? undefined : text,
      code: error.code
    })
  }
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
  },

  async findByUsername(username) {
    if (useMockDb) {
      for (const user of mockData.users.values()) {
        if (user.username === username) return user
      }
      return null
    }
    return queryOne('SELECT * FROM users WHERE username = $1', [username])
  },

  async createWithPassword(displayName, username, passwordHash) {
    if (useMockDb) {
      // Check if username exists
      for (const user of mockData.users.values()) {
        if (user.username === username) {
          throw new Error('Username already exists')
        }
      }
      const user = {
        id: uuid(),
        display_name: displayName,
        username: username,
        password_hash: passwordHash,
        lightning_address: null,
        linking_key: null,
        last_login_at: new Date(),
        created_at: new Date()
      }
      mockData.users.set(user.id, user)
      return user
    }
    return queryOne(
      `INSERT INTO users (display_name, username, password_hash, last_login_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [displayName, username, passwordHash]
    )
  },

  async updateLastLogin(userId) {
    if (useMockDb) {
      const user = mockData.users.get(userId)
      if (user) {
        user.last_login_at = new Date()
        return user
      }
      return null
    }
    return queryOne(
      `UPDATE users SET last_login_at = NOW() WHERE id = $1 RETURNING *`,
      [userId]
    )
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

  /**
   * Find current day's tournament
   * NOTE: Uses UTC timezone for date calculation to match cron schedule
   * Tournaments run on UTC day boundaries (00:00-23:59 UTC)
   */
  async findCurrent() {
    // toISOString() always returns UTC, ensuring consistent date across server timezones
    const todayUTC = new Date().toISOString().split('T')[0]
    return this.findByDate(todayUTC)
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
  },

  async getOrCreateEntry(tournamentId, userId) {
    if (useMockDb) {
      for (const e of mockData.entries.values()) {
        if (e.tournament_id === tournamentId && e.user_id === userId) return e
      }
      // Create new entry
      const entry = {
        id: uuid(),
        tournament_id: tournamentId,
        user_id: userId,
        payment_hash: null,
        paid_at: null,
        best_score: 0,
        attempts: 0,
        attempts_used: 0,
        max_attempts: 3,
        attempt_1_score: null,
        attempt_2_score: null,
        attempt_3_score: null,
        created_at: new Date()
      }
      mockData.entries.set(entry.id, entry)
      return entry
    }
    return queryOne(
      `INSERT INTO tournament_entries (tournament_id, user_id, attempts_used, max_attempts)
       VALUES ($1, $2, 0, 3)
       ON CONFLICT (tournament_id, user_id) DO UPDATE SET tournament_id = $1
       RETURNING *`,
      [tournamentId, userId]
    )
  },

  async incrementAttempt(entryId) {
    if (useMockDb) {
      const e = mockData.entries.get(entryId)
      if (e && e.attempts_used < e.max_attempts) {
        e.attempts_used = (e.attempts_used || 0) + 1
        return e
      }
      return null
    }
    return queryOne(
      `UPDATE tournament_entries
       SET attempts_used = attempts_used + 1
       WHERE id = $1 AND attempts_used < max_attempts
       RETURNING *`,
      [entryId]
    )
  },

  async recordAttemptScore(entryId, attemptNumber, score) {
    // Validate attemptNumber to prevent SQL injection
    // Only allow integers 1, 2, or 3
    const validAttempts = [1, 2, 3]
    if (!validAttempts.includes(attemptNumber)) {
      console.error('[DB] Invalid attempt number:', attemptNumber)
      throw new DatabaseError('Invalid attempt number', { code: 'INVALID_ATTEMPT' })
    }

    if (useMockDb) {
      const e = mockData.entries.get(entryId)
      if (e) {
        e[`attempt_${attemptNumber}_score`] = score
        e.best_score = Math.max(e.best_score || 0, score)
        e.attempts = (e.attempts || 0) + 1
        return e
      }
      return null
    }

    // Use CASE statement instead of string interpolation to prevent SQL injection
    return queryOne(
      `UPDATE tournament_entries
       SET
         attempt_1_score = CASE WHEN $2 = 1 THEN $3 ELSE attempt_1_score END,
         attempt_2_score = CASE WHEN $2 = 2 THEN $3 ELSE attempt_2_score END,
         attempt_3_score = CASE WHEN $2 = 3 THEN $3 ELSE attempt_3_score END,
         best_score = GREATEST(best_score, $3),
         attempts = attempts + 1
       WHERE id = $1
       RETURNING *`,
      [entryId, attemptNumber, score]
    )
  },

  async getTournamentStats(tournamentId) {
    if (useMockDb) {
      let playerCount = 0
      let totalAttempts = 0
      for (const e of mockData.entries.values()) {
        if (e.tournament_id === tournamentId) {
          playerCount++
          totalAttempts += e.attempts_used || 0
        }
      }
      return { playerCount, totalAttempts }
    }
    const result = await queryOne(
      `SELECT COUNT(DISTINCT user_id) as player_count, SUM(attempts_used) as total_attempts
       FROM tournament_entries
       WHERE tournament_id = $1`,
      [tournamentId]
    )
    return {
      playerCount: parseInt(result?.player_count || 0),
      totalAttempts: parseInt(result?.total_attempts || 0)
    }
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

// ============= WHITELIST FUNCTIONS =============
export const whitelist = {
  async add(linkingKey, displayName = null, isAdmin = false, approvedBy = null) {
    if (useMockDb) {
      const entry = {
        id: uuid(),
        linking_key: linkingKey,
        display_name: displayName,
        is_admin: isAdmin,
        approved_by: approvedBy,
        approved_at: new Date(),
        created_at: new Date()
      }
      mockData.whitelist.set(linkingKey, entry)
      return entry
    }
    return queryOne(
      `INSERT INTO whitelist (linking_key, display_name, is_admin, approved_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (linking_key) DO UPDATE SET display_name = COALESCE($2, whitelist.display_name)
       RETURNING *`,
      [linkingKey, displayName, isAdmin, approvedBy]
    )
  },

  async check(linkingKey) {
    if (useMockDb) {
      return mockData.whitelist.get(linkingKey) || null
    }
    return queryOne('SELECT * FROM whitelist WHERE linking_key = $1', [linkingKey])
  },

  async remove(linkingKey) {
    if (useMockDb) {
      mockData.whitelist.delete(linkingKey)
      return true
    }
    await query('DELETE FROM whitelist WHERE linking_key = $1', [linkingKey])
    return true
  },

  async getAll() {
    if (useMockDb) {
      return Array.from(mockData.whitelist.values())
    }
    return queryMany('SELECT * FROM whitelist ORDER BY created_at DESC')
  }
}

// ============= LNURL CHALLENGE FUNCTIONS =============
export const lnurlChallenges = {
  async create(k1, expiresInSeconds = 300) {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)

    if (useMockDb) {
      const challenge = {
        id: uuid(),
        k1,
        linking_key: null,
        status: 'pending',
        expires_at: expiresAt,
        created_at: new Date()
      }
      mockData.lnurlChallenges.set(k1, challenge)
      return challenge
    }
    return queryOne(
      `INSERT INTO lnurl_challenges (k1, expires_at) VALUES ($1, $2) RETURNING *`,
      [k1, expiresAt]
    )
  },

  async verify(k1, linkingKey) {
    if (useMockDb) {
      const challenge = mockData.lnurlChallenges.get(k1)
      if (!challenge) return null
      if (challenge.status !== 'pending') return null
      if (new Date() > challenge.expires_at) return null

      challenge.linking_key = linkingKey
      challenge.status = 'verified'
      return challenge
    }
    return queryOne(
      `UPDATE lnurl_challenges
       SET linking_key = $2, status = 'verified'
       WHERE k1 = $1 AND status = 'pending' AND expires_at > NOW()
       RETURNING *`,
      [k1, linkingKey]
    )
  },

  async get(k1) {
    if (useMockDb) {
      return mockData.lnurlChallenges.get(k1) || null
    }
    return queryOne('SELECT * FROM lnurl_challenges WHERE k1 = $1', [k1])
  },

  async consume(k1) {
    if (useMockDb) {
      const challenge = mockData.lnurlChallenges.get(k1)
      if (challenge && challenge.status === 'verified') {
        challenge.status = 'consumed'
        return challenge
      }
      return null
    }
    return queryOne(
      `UPDATE lnurl_challenges SET status = 'consumed' WHERE k1 = $1 AND status = 'verified' RETURNING *`,
      [k1]
    )
  },

  async cleanup() {
    if (useMockDb) {
      const now = new Date()
      for (const [k1, challenge] of mockData.lnurlChallenges) {
        if (challenge.expires_at < now) {
          mockData.lnurlChallenges.delete(k1)
        }
      }
      return
    }
    await query(`DELETE FROM lnurl_challenges WHERE expires_at < NOW()`)
  }
}

// ============= WALLET FUNCTIONS =============
export const wallets = {
  async getByUserId(userId) {
    if (useMockDb) {
      return mockData.wallets.get(userId) || null
    }
    return queryOne('SELECT * FROM user_wallets WHERE user_id = $1', [userId])
  },

  async getOrCreate(userId) {
    if (useMockDb) {
      let wallet = mockData.wallets.get(userId)
      if (!wallet) {
        wallet = {
          id: uuid(),
          user_id: userId,
          balance_sats: 0,
          created_at: new Date(),
          updated_at: new Date()
        }
        mockData.wallets.set(userId, wallet)
      }
      return wallet
    }
    return queryOne(
      `INSERT INTO user_wallets (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [userId]
    )
  },

  async credit(userId, amountSats, type, description, reference = null) {
    if (useMockDb) {
      let wallet = mockData.wallets.get(userId)
      if (!wallet) {
        wallet = { id: uuid(), user_id: userId, balance_sats: 0, created_at: new Date(), updated_at: new Date() }
        mockData.wallets.set(userId, wallet)
      }
      wallet.balance_sats += amountSats
      wallet.updated_at = new Date()

      // Record transaction
      const tx = { id: uuid(), user_id: userId, type, amount_sats: amountSats, description, reference, created_at: new Date() }
      mockData.transactions.set(tx.id, tx)
      return wallet
    }

    // Record transaction first
    await query(
      `INSERT INTO transactions (user_id, type, amount_sats, description, reference) VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, amountSats, description, reference]
    )

    return queryOne(
      `INSERT INTO user_wallets (user_id, balance_sats) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET balance_sats = user_wallets.balance_sats + $2, updated_at = NOW()
       RETURNING *`,
      [userId, amountSats]
    )
  },

  async debit(userId, amountSats, type, description, reference = null) {
    if (useMockDb) {
      const wallet = mockData.wallets.get(userId)
      if (!wallet || wallet.balance_sats < amountSats) {
        throw new Error('Insufficient balance')
      }
      wallet.balance_sats -= amountSats
      wallet.updated_at = new Date()

      const tx = { id: uuid(), user_id: userId, type, amount_sats: -amountSats, description, reference, created_at: new Date() }
      mockData.transactions.set(tx.id, tx)
      return wallet
    }

    // Check balance first
    const wallet = await queryOne('SELECT balance_sats FROM user_wallets WHERE user_id = $1', [userId])
    if (!wallet || wallet.balance_sats < amountSats) {
      throw new Error('Insufficient balance')
    }

    // Record transaction
    await query(
      `INSERT INTO transactions (user_id, type, amount_sats, description, reference) VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, -amountSats, description, reference]
    )

    return queryOne(
      `UPDATE user_wallets SET balance_sats = balance_sats - $2, updated_at = NOW()
       WHERE user_id = $1 AND balance_sats >= $2
       RETURNING *`,
      [userId, amountSats]
    )
  },

  async getTransactions(userId, limit = 20, offset = 0) {
    if (useMockDb) {
      return Array.from(mockData.transactions.values())
        .filter(t => t.user_id === userId)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(offset, offset + limit)
    }
    return queryMany(
      `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    )
  }
}

// Update users to support linking_key
users.findByLinkingKey = async function(linkingKey) {
  if (useMockDb) {
    for (const user of mockData.users.values()) {
      if (user.linking_key === linkingKey) return user
    }
    return null
  }
  return queryOne('SELECT * FROM users WHERE linking_key = $1', [linkingKey])
}

users.createFromLnurl = async function(linkingKey, displayName) {
  if (useMockDb) {
    // Check if exists
    for (const user of mockData.users.values()) {
      if (user.linking_key === linkingKey) {
        return user
      }
    }
    const user = {
      id: uuid(),
      display_name: displayName,
      lightning_address: null,
      linking_key: linkingKey,
      created_at: new Date()
    }
    mockData.users.set(user.id, user)
    return user
  }
  return queryOne(
    `INSERT INTO users (display_name, linking_key, lightning_address)
     VALUES ($1, $2, $2)
     ON CONFLICT (linking_key) DO UPDATE SET display_name = COALESCE(NULLIF($1, ''), users.display_name)
     RETURNING *`,
    [displayName, linkingKey]
  )
}

/**
 * Close database connection pool
 * Called during graceful shutdown
 */
export async function close() {
  if (pool) {
    try {
      await pool.end()
      pool = null
      console.log('[DB] Connection pool closed')
    } catch (error) {
      console.error('[DB] Error closing connection pool:', error.message)
    }
  }
}

export default { query, queryOne, queryMany, users, tournaments, entries, sessions, payouts, whitelist, lnurlChallenges, wallets, close }
