/**
 * Input Sanitization Utilities
 *
 * Prevents XSS, injection attacks, and malformed input.
 * All user input should be passed through these functions.
 *
 * SECURITY FEATURES:
 * - HTML entity encoding
 * - Control character removal
 * - Length enforcement
 * - Format validation
 */

/**
 * HTML entities to escape
 */
const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
}

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  return str.replace(/[&<>"'`=/]/g, char => HTML_ENTITIES[char])
}

/**
 * Remove control characters (except newline, tab)
 * @param {string} str - String to clean
 * @returns {string} Cleaned string
 */
function removeControlChars(str) {
  // Remove all control chars except tab (0x09), newline (0x0A), carriage return (0x0D)
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/**
 * Sanitize display name
 *
 * Rules:
 * - 2-20 characters
 * - Alphanumeric, spaces, underscores, hyphens only
 * - No HTML/JS injection
 * - No control characters
 *
 * @param {string} name - Raw display name
 * @returns {{valid: boolean, sanitized: string, error?: string}}
 */
export function sanitizeDisplayName(name) {
  // Type check
  if (name === null || name === undefined) {
    return { valid: false, sanitized: '', error: 'Display name is required' }
  }

  if (typeof name !== 'string') {
    return { valid: false, sanitized: '', error: 'Display name must be a string' }
  }

  // Trim whitespace
  let cleaned = name.trim()

  // Remove control characters
  cleaned = removeControlChars(cleaned)

  // Remove any HTML tags completely
  cleaned = cleaned.replace(/<[^>]*>/g, '')

  // Escape remaining HTML entities
  cleaned = escapeHtml(cleaned)

  // Decode common HTML entities that might have been double-encoded
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

  // Now escape again for final storage
  cleaned = escapeHtml(cleaned)

  // Only allow safe characters for display names
  // This is a whitelist approach - much safer than blacklist
  const safeChars = cleaned.replace(/[^a-zA-Z0-9\s_\-\.]/g, '')

  // Collapse multiple spaces
  const finalName = safeChars.replace(/\s+/g, ' ').trim()

  // Length validation
  if (finalName.length < 2) {
    return { valid: false, sanitized: '', error: 'Display name must be at least 2 characters' }
  }

  if (finalName.length > 20) {
    return { valid: false, sanitized: finalName.substring(0, 20), error: 'Display name must be 20 characters or less' }
  }

  return { valid: true, sanitized: finalName }
}

/**
 * Sanitize Lightning address
 *
 * Rules:
 * - Valid email-like format: user@domain.tld
 * - Lowercase only
 * - No special characters except . _ - in username
 * - Valid domain format
 *
 * @param {string} address - Raw Lightning address
 * @returns {{valid: boolean, sanitized: string, error?: string}}
 */
export function sanitizeLightningAddress(address) {
  // Type check
  if (address === null || address === undefined) {
    return { valid: false, sanitized: '', error: 'Lightning address is required' }
  }

  if (typeof address !== 'string') {
    return { valid: false, sanitized: '', error: 'Lightning address must be a string' }
  }

  // Trim and lowercase
  const cleaned = address.trim().toLowerCase()

  // Remove any HTML/control characters
  const safe = removeControlChars(cleaned).replace(/<[^>]*>/g, '')

  // Length check
  if (safe.length < 5 || safe.length > 100) {
    return { valid: false, sanitized: '', error: 'Invalid Lightning address length' }
  }

  // Must contain exactly one @
  const atCount = (safe.match(/@/g) || []).length
  if (atCount !== 1) {
    return { valid: false, sanitized: '', error: 'Invalid Lightning address format' }
  }

  // Split and validate parts
  const [username, domain] = safe.split('@')

  // Username validation (before @)
  // Allow: a-z, 0-9, ., _, -
  // Must start with alphanumeric
  const usernameRegex = /^[a-z0-9][a-z0-9._-]*$/
  if (!username || !usernameRegex.test(username)) {
    return { valid: false, sanitized: '', error: 'Invalid username in Lightning address' }
  }

  // Check for consecutive special chars in username
  if (/[._-]{2,}/.test(username)) {
    return { valid: false, sanitized: '', error: 'Invalid username format' }
  }

  // Domain validation (after @)
  // Must have at least one dot, valid TLD
  const domainRegex = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/
  if (!domain || !domainRegex.test(domain)) {
    return { valid: false, sanitized: '', error: 'Invalid domain in Lightning address' }
  }

  // Check for consecutive special chars in domain
  if (/[.-]{2,}/.test(domain)) {
    return { valid: false, sanitized: '', error: 'Invalid domain format' }
  }

  // Reconstruct sanitized address
  const sanitized = `${username}@${domain}`

  return { valid: true, sanitized }
}

/**
 * Sanitize score value
 *
 * @param {any} score - Raw score input
 * @returns {{valid: boolean, value: number, error?: string}}
 */
export function sanitizeScore(score) {
  // Must be a number
  if (typeof score !== 'number') {
    return { valid: false, value: 0, error: 'Score must be a number' }
  }

  // Must be finite
  if (!Number.isFinite(score)) {
    return { valid: false, value: 0, error: 'Score must be a finite number' }
  }

  // Must be integer
  if (!Number.isInteger(score)) {
    return { valid: false, value: 0, error: 'Score must be an integer' }
  }

  // Must be non-negative
  if (score < 0) {
    return { valid: false, value: 0, error: 'Score cannot be negative' }
  }

  // Must be reasonable (prevent overflow attacks)
  if (score > 10000000) {
    return { valid: false, value: 0, error: 'Score exceeds maximum allowed' }
  }

  return { valid: true, value: score }
}

/**
 * Sanitize duration value (in milliseconds)
 *
 * @param {any} duration - Raw duration input
 * @returns {{valid: boolean, value: number, error?: string}}
 */
export function sanitizeDuration(duration) {
  if (typeof duration !== 'number') {
    return { valid: false, value: 0, error: 'Duration must be a number' }
  }

  if (!Number.isFinite(duration) || !Number.isInteger(duration)) {
    return { valid: false, value: 0, error: 'Duration must be a finite integer' }
  }

  // Minimum 5 seconds
  if (duration < 5000) {
    return { valid: false, value: 0, error: 'Game duration too short' }
  }

  // Maximum 24 hours (prevent abuse)
  if (duration > 86400000) {
    return { valid: false, value: 0, error: 'Game duration exceeds maximum' }
  }

  return { valid: true, value: duration }
}

/**
 * Sanitize level value
 *
 * @param {any} level - Raw level input
 * @returns {{valid: boolean, value: number, error?: string}}
 */
export function sanitizeLevel(level) {
  if (typeof level !== 'number') {
    return { valid: false, value: 0, error: 'Level must be a number' }
  }

  if (!Number.isInteger(level)) {
    return { valid: false, value: 0, error: 'Level must be an integer' }
  }

  if (level < 1) {
    return { valid: false, value: 0, error: 'Level must be at least 1' }
  }

  if (level > 10000) {
    return { valid: false, value: 0, error: 'Level exceeds maximum' }
  }

  return { valid: true, value: level }
}

/**
 * Sanitize generic string input
 *
 * @param {any} str - Raw string input
 * @param {number} maxLength - Maximum allowed length
 * @returns {{valid: boolean, sanitized: string, error?: string}}
 */
export function sanitizeString(str, maxLength = 1000) {
  if (str === null || str === undefined) {
    return { valid: true, sanitized: '' }
  }

  if (typeof str !== 'string') {
    return { valid: false, sanitized: '', error: 'Input must be a string' }
  }

  let cleaned = str.trim()
  cleaned = removeControlChars(cleaned)
  cleaned = escapeHtml(cleaned)

  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength)
  }

  return { valid: true, sanitized: cleaned }
}

export default {
  sanitizeDisplayName,
  sanitizeLightningAddress,
  sanitizeScore,
  sanitizeDuration,
  sanitizeLevel,
  sanitizeString
}
