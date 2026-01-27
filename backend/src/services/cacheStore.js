/**
 * Cache Store Service
 *
 * General-purpose caching with Redis support.
 * Falls back to in-memory store with proper TTL enforcement for development.
 *
 * Used for:
 * - Pending invoice tracking
 * - Webhook idempotency
 * - Rate limiting counters
 *
 * SECURITY FEATURES:
 * - Automatic TTL expiration
 * - Memory-bounded in dev mode
 * - Graceful shutdown support
 */

const CACHE_PREFIX = 'cache:'
const DEFAULT_TTL_SECONDS = 600 // 10 minutes
const MAX_MEMORY_ENTRIES = 1000 // Prevent unbounded growth in dev
const CLEANUP_INTERVAL_MS = 60 * 1000 // 1 minute

let redis = null
let useMemoryStore = true
let cleanupInterval = null

// In-memory fallback with TTL (development only)
// Structure: Map<key, { value, expiresAt }>
const memoryStore = new Map()

/**
 * Initialize cache store
 * Shares Redis connection with session store if available
 */
export async function initCacheStore() {
  const redisUrl = process.env.REDIS_URL

  if (!redisUrl) {
    console.log('[Cache] Using in-memory store (development only)')
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
      lazyConnect: true,
      keyPrefix: CACHE_PREFIX
    })

    await redis.connect()
    await redis.ping()

    useMemoryStore = false
    console.log('[Cache] Redis connected')
  } catch (error) {
    console.warn('[Cache] Redis connection failed, using memory store:', error.message)
    useMemoryStore = true
    startMemoryCleanup()
  }
}

/**
 * Set a value with TTL
 * @param {string} key - Cache key
 * @param {any} value - Value to store (will be JSON serialized)
 * @param {number} ttlSeconds - Time-to-live in seconds
 */
export async function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!key || typeof key !== 'string') {
    throw new Error('Cache key must be a non-empty string')
  }

  const serialized = JSON.stringify(value)

  if (useMemoryStore) {
    // Enforce memory limit
    if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
      evictOldestEntries(Math.floor(MAX_MEMORY_ENTRIES * 0.1)) // Evict 10%
    }

    memoryStore.set(key, {
      value: serialized,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    })
    return
  }

  await redis.setex(key, ttlSeconds, serialized)
}

/**
 * Get a value
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} - Parsed value or null if not found/expired
 */
export async function get(key) {
  if (!key || typeof key !== 'string') {
    return null
  }

  if (useMemoryStore) {
    const entry = memoryStore.get(key)

    if (!entry) return null

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      memoryStore.delete(key)
      return null
    }

    try {
      return JSON.parse(entry.value)
    } catch {
      memoryStore.delete(key)
      return null
    }
  }

  const data = await redis.get(key)
  if (!data) return null

  try {
    return JSON.parse(data)
  } catch (error) {
    console.error('[Cache] Parse error for key:', key, error.message)
    await redis.del(key)
    return null
  }
}

/**
 * Delete a value
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} - True if key existed and was deleted, false otherwise
 */
export async function del(key) {
  if (!key) return false

  if (useMemoryStore) {
    // Map.delete returns true if element existed and was removed
    return memoryStore.delete(key)
  }

  // Redis DEL returns number of keys deleted (0 or 1)
  const deleted = await redis.del(key)
  return deleted > 0
}

/**
 * Check if key exists (without retrieving value)
 * @param {string} key - Cache key
 * @returns {Promise<boolean>}
 */
export async function has(key) {
  if (!key) return false

  if (useMemoryStore) {
    const entry = memoryStore.get(key)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) {
      memoryStore.delete(key)
      return false
    }
    return true
  }

  const exists = await redis.exists(key)
  return exists === 1
}

/**
 * Set a simple flag (for idempotency checks)
 * @param {string} key - Cache key
 * @param {number} ttlSeconds - Time-to-live
 * @returns {Promise<boolean>} - True if newly set, false if already existed
 */
export async function setIfNotExists(key, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (useMemoryStore) {
    if (await has(key)) {
      return false
    }
    await set(key, 1, ttlSeconds)
    return true
  }

  // Redis SETNX with expiry
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX')
  return result === 'OK'
}

/**
 * Get all keys matching a pattern (memory store only, for debugging)
 * @param {string} pattern - Key pattern (e.g., "invoice:*")
 * @returns {string[]}
 */
export function getKeysByPattern(pattern) {
  if (!useMemoryStore) {
    console.warn('[Cache] Pattern matching not supported with Redis - use SCAN instead')
    return []
  }

  const regex = new RegExp('^' + pattern.replace('*', '.*') + '$')
  const keys = []

  for (const key of memoryStore.keys()) {
    if (regex.test(key)) {
      keys.push(key)
    }
  }

  return keys
}

/**
 * Get cache statistics
 * @returns {Object}
 */
export function getStats() {
  if (useMemoryStore) {
    let validCount = 0
    let expiredCount = 0
    const now = Date.now()

    for (const entry of memoryStore.values()) {
      if (now > entry.expiresAt) {
        expiredCount++
      } else {
        validCount++
      }
    }

    return {
      type: 'memory',
      entries: validCount,
      expired: expiredCount,
      maxEntries: MAX_MEMORY_ENTRIES
    }
  }

  return {
    type: 'redis',
    connected: redis?.status === 'ready'
  }
}

/**
 * Evict oldest entries from memory store
 */
function evictOldestEntries(count) {
  const entries = Array.from(memoryStore.entries())
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    .slice(0, count)

  for (const [key] of entries) {
    memoryStore.delete(key)
  }

  console.log(`[Cache] Evicted ${entries.length} oldest entries`)
}

/**
 * Cleanup expired entries from memory store
 */
function cleanupMemoryStore() {
  const now = Date.now()
  let cleaned = 0

  for (const [key, entry] of memoryStore.entries()) {
    if (now > entry.expiresAt) {
      memoryStore.delete(key)
      cleaned++
    }
  }

  if (cleaned > 0) {
    console.log(`[Cache] Cleaned up ${cleaned} expired entries`)
  }
}

/**
 * Start periodic cleanup for memory store
 */
function startMemoryCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
  }
  cleanupInterval = setInterval(cleanupMemoryStore, CLEANUP_INTERVAL_MS)
}

/**
 * Stop cleanup interval (for graceful shutdown)
 */
export function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
    console.log('[Cache] Cleanup interval stopped')
  }
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function close() {
  stopCleanup()

  if (redis) {
    await redis.quit()
    redis = null
    console.log('[Cache] Redis connection closed')
  }
}

/**
 * Check if using Redis
 * @returns {boolean}
 */
export function isUsingRedis() {
  return !useMemoryStore
}

export default {
  initCacheStore,
  set,
  get,
  del,
  has,
  setIfNotExists,
  getKeysByPattern,
  getStats,
  stopCleanup,
  close,
  isUsingRedis
}
