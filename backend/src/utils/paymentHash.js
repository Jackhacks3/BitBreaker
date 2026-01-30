/**
 * Normalize Lightning payment hash for cache keys and webhook lookups.
 * LNbits may send with different casing or dashes; we store and look up as 64 hex lowercase.
 *
 * @param {string} hash - Raw payment_hash from API or webhook
 * @returns {string|null} - 64-char lowercase hex or null if invalid
 */
export function normalizePaymentHash(hash) {
  if (hash == null || typeof hash !== 'string') return null
  const normalized = String(hash).toLowerCase().replace(/-/g, '').trim()
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null
  return normalized
}
