/**
 * Session Store Service
 *
 * Secure session management with Redis storage.
 * Falls back to in-memory store for development when Redis is unavailable.
 *
 * SECURITY FEATURES:
 * - Cryptographically secure token generation
 * - Sliding expiration (extends on activity)
 * - Automatic cleanup of expired sessions
 * - Session invalidation support
 */

import crypto from 'crypto'

const SESSION_TTL_SECONDS = 24 * 60 * 60 // 24 hours
const SESSION_PREFIX = 'session:'
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

let redis = null
let useMemoryStore = true
let cleanupInterval = null

// In-memory fallback (development only)
const memoryStore = new Map()

/**
 * Initialize session store
 * Attempts Redis connection, falls back to memory store
 */
export async function initSessionStore() {
  const redisUrl = process.env.REDIS_URL

  if (!redisUrl) {
    console.log('REDIS_URL not set - using in-memory session store (development only)')
    useMemoryStore = true
    startMemoryCleanup()
    return
  }

  try {
    const Redis = (await import('ioredis')).default
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true
    })

    await redis.connect()
    await redis.ping()

    useMemoryStore = false
    console.log('Session store: Redis connected')
  } catch (error) {
    console.warn('Redis connection failed, using memory store:', error.message)
    useMemoryStore = true
    startMemoryCleanup()
  }
}

/**
 * Generate a cryptographically secure session token
 * @returns {string} 64-character hex token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Create a new session
 * @param {string} userId - User ID to associate with session
 * @returns {Promise<string>} Session token
 */
export async function createSession(userId) {
  const token = generateToken()
  const sessionData = {
    userId,
    createdAt: Date.now(),
    lastActivity: Date.now()
  }

  if (useMemoryStore) {
    memoryStore.set(token, {
      ...sessionData,
      expiresAt: Date.now() + (SESSION_TTL_SECONDS * 1000)
    })
  } else {
    await redis.setex(
      `${SESSION_PREFIX}${token}`,
      SESSION_TTL_SECONDS,
      JSON.stringify(sessionData)
    )
  }

  return token
}

/**
 * Get session data and extend expiration
 * @param {string} token - Session token
 * @returns {Promise<{userId: string, createdAt: number, lastActivity: number}|null>}
 */
export async function getSession(token) {
  // Validate token format
  if (!token || typeof token !== 'string' || token.length !== 64) {
    return null
  }

  // Reject tokens that aren't valid hex
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return null
  }

  if (useMemoryStore) {
    const session = memoryStore.get(token)

    if (!session) return null

    // Check expiration
    if (Date.now() > session.expiresAt) {
      memoryStore.delete(token)
      return null
    }

    // Extend session (sliding expiration)
    session.lastActivity = Date.now()
    session.expiresAt = Date.now() + (SESSION_TTL_SECONDS * 1000)

    return {
      userId: session.userId,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity
    }
  }

  // Redis implementation
  const data = await redis.get(`${SESSION_PREFIX}${token}`)

  if (!data) return null

  try {
    const session = JSON.parse(data)

    // Update last activity and extend TTL
    session.lastActivity = Date.now()
    await redis.setex(
      `${SESSION_PREFIX}${token}`,
      SESSION_TTL_SECONDS,
      JSON.stringify(session)
    )

    return session
  } catch (error) {
    console.error('Session parse error:', error)
    return null
  }
}

/**
 * Destroy a session
 * @param {string} token - Session token to invalidate
 */
export async function destroySession(token) {
  if (!token) return

  if (useMemoryStore) {
    memoryStore.delete(token)
  } else {
    await redis.del(`${SESSION_PREFIX}${token}`)
  }
}

/**
 * Destroy all sessions for a user (logout everywhere)
 * Note: Only works efficiently with Redis SCAN
 * @param {string} userId - User ID to invalidate all sessions for
 */
export async function destroyAllUserSessions(userId) {
  if (useMemoryStore) {
    for (const [token, session] of memoryStore.entries()) {
      if (session.userId === userId) {
        memoryStore.delete(token)
      }
    }
    return
  }

  // Redis: scan for matching sessions
  let cursor = '0'
  do {
    const [newCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${SESSION_PREFIX}*`,
      'COUNT',
      100
    )
    cursor = newCursor

    for (const key of keys) {
      const data = await redis.get(key)
      if (data) {
        try {
          const session = JSON.parse(data)
          if (session.userId === userId) {
            await redis.del(key)
          }
        } catch (e) {
          // Skip invalid sessions
        }
      }
    }
  } while (cursor !== '0')
}

/**
 * Get session count for a user
 * @param {string} userId - User ID
 * @returns {Promise<number>}
 */
export async function getUserSessionCount(userId) {
  let count = 0

  if (useMemoryStore) {
    for (const session of memoryStore.values()) {
      if (session.userId === userId && Date.now() < session.expiresAt) {
        count++
      }
    }
    return count
  }

  // Redis implementation
  let cursor = '0'
  do {
    const [newCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${SESSION_PREFIX}*`,
      'COUNT',
      100
    )
    cursor = newCursor

    for (const key of keys) {
      const data = await redis.get(key)
      if (data) {
        try {
          const session = JSON.parse(data)
          if (session.userId === userId) {
            count++
          }
        } catch (e) {
          // Skip invalid sessions
        }
      }
    }
  } while (cursor !== '0')

  return count
}

/**
 * Cleanup expired sessions from memory store
 */
function cleanupMemorySessions() {
  const now = Date.now()
  let cleaned = 0

  for (const [token, session] of memoryStore.entries()) {
    if (now > session.expiresAt) {
      memoryStore.delete(token)
      cleaned++
    }
  }

  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired sessions`)
  }
}

/**
 * Start periodic cleanup for memory store
 */
function startMemoryCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
  }
  cleanupInterval = setInterval(cleanupMemorySessions, CLEANUP_INTERVAL_MS)
}

/**
 * Stop periodic cleanup (for graceful shutdown)
 */
export function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
    console.log('[Session] Cleanup interval stopped')
  }
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function close() {
  stopCleanup()

  if (redis) {
    try {
      await redis.quit()
      redis = null
      console.log('[Session] Redis connection closed')
    } catch (error) {
      console.error('[Session] Error closing Redis:', error.message)
    }
  }
}

/**
 * Check if session store is using Redis
 * @returns {boolean}
 */
export function isUsingRedis() {
  return !useMemoryStore
}

export default {
  initSessionStore,
  createSession,
  getSession,
  destroySession,
  destroyAllUserSessions,
  getUserSessionCount,
  isUsingRedis,
  stopCleanup,
  close
}
