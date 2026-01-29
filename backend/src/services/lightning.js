/**
 * Lightning Network Service
 *
 * Integration with LNbits for:
 * - Creating payment invoices (buy-ins)
 * - Checking payment status
 * - Sending payouts to winners
 *
 * Supports both LNbits self-hosted and hosted instances.
 */

import crypto from 'crypto'

// Configuration
const LNBITS_URL = process.env.LNBITS_URL || 'https://legend.lnbits.com'
const LNBITS_API_KEY = process.env.LNBITS_API_KEY // Invoice key (read)
const LNBITS_ADMIN_KEY = process.env.LNBITS_ADMIN_KEY // Admin key (send payments)
const API_TIMEOUT_MS = parseInt(process.env.LIGHTNING_API_TIMEOUT) || 10000 // 10 second default

/**
 * Fetch with timeout protection
 * Prevents hanging requests from blocking the server
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return response
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Create a Lightning invoice
 *
 * @param {number} amountSats - Amount in satoshis
 * @param {string} memo - Invoice description
 * @returns {Promise<{paymentHash: string, paymentRequest: string}>}
 */
export async function createInvoice(amountSats, memo) {
  // If no LNbits configured, use mock for development
  if (!LNBITS_API_KEY) {
    console.warn('LNbits not configured - using mock invoice')
    return createMockInvoice(amountSats, memo)
  }

  try {
    const response = await fetchWithTimeout(`${LNBITS_URL}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'X-Api-Key': LNBITS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        out: false,
        amount: amountSats,
        memo: memo,
        expiry: 600 // 10 minutes
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Lightning] Create invoice failed:', { status: response.status, error: errorText })
      throw new Error(`LNbits error (${response.status}): ${errorText.substring(0, 100)}`)
    }

    const data = await response.json()

    if (!data.payment_hash || !data.payment_request) {
      throw new Error('Invalid response from LNbits: missing payment_hash or payment_request')
    }

    return {
      paymentHash: data.payment_hash,
      paymentRequest: data.payment_request
    }
  } catch (error) {
    console.error('[Lightning] Create invoice error:', error.message)
    throw error
  }
}

/**
 * Check if an invoice has been paid
 *
 * @param {string} paymentHash - The payment hash to check
 * @returns {Promise<boolean>}
 */
export async function checkPayment(paymentHash) {
  // Mock mode for development
  if (!LNBITS_API_KEY) {
    return checkMockPayment(paymentHash)
  }

  try {
    const response = await fetchWithTimeout(`${LNBITS_URL}/api/v1/payments/${paymentHash}`, {
      headers: {
        'X-Api-Key': LNBITS_API_KEY
      }
    })

    if (!response.ok) {
      console.warn('[Lightning] Check payment failed:', { hash: paymentHash.substring(0, 16), status: response.status })
      return false
    }

    const data = await response.json()
    return data.paid === true
  } catch (error) {
    console.error('[Lightning] Check payment error:', { hash: paymentHash.substring(0, 16), error: error.message })
    return false
  }
}

/**
 * Pay to a Lightning address (for payouts)
 *
 * @param {string} lightningAddress - e.g., "user@getalby.com"
 * @param {number} amountSats - Amount in satoshis
 * @param {string} comment - Payment comment
 * @returns {Promise<{success: boolean, paymentHash?: string}>}
 */
export async function payToAddress(lightningAddress, amountSats, comment = '') {
  // Mock mode for development
  if (!LNBITS_ADMIN_KEY) {
    console.warn('LNbits admin key not configured - skipping payout')
    return { success: false, error: 'Payouts not configured', code: 'PAYOUTS_NOT_CONFIGURED' }
  }

  try {
    // First, get invoice from Lightning address
    const invoice = await fetchLNURLInvoice(lightningAddress, amountSats, comment)

    if (!invoice) {
      return { success: false, error: 'Could not get invoice from Lightning address', code: 'INVALID_ADDRESS' }
    }

    // Pay the invoice
    const response = await fetchWithTimeout(`${LNBITS_URL}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'X-Api-Key': LNBITS_ADMIN_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        out: true,
        bolt11: invoice
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Lightning] Payout failed:', { address: lightningAddress, status: response.status, error: errorText })
      throw new Error(`Payment failed (${response.status}): ${errorText.substring(0, 100)}`)
    }

    const data = await response.json()

    console.log('[Lightning] Payout successful:', { address: lightningAddress, amount: amountSats, hash: data.payment_hash?.substring(0, 16) })

    return {
      success: true,
      paymentHash: data.payment_hash
    }
  } catch (error) {
    console.error('[Lightning] Pay to address error:', { address: lightningAddress, error: error.message })
    return { success: false, error: error.message, code: 'PAYMENT_FAILED' }
  }
}

/**
 * Fetch an invoice from a Lightning address (LNURL-pay)
 */
async function fetchLNURLInvoice(lightningAddress, amountSats, comment = '') {
  try {
    // Parse Lightning address
    const [username, domain] = lightningAddress.split('@')

    if (!username || !domain) {
      throw new Error('Invalid Lightning address format')
    }

    // Fetch LNURL-pay metadata
    const wellKnownUrl = `https://${domain}/.well-known/lnurlp/${username}`
    const metaResponse = await fetchWithTimeout(wellKnownUrl, {}, 5000) // 5s timeout for external LNURL

    if (!metaResponse.ok) {
      throw new Error(`Could not fetch Lightning address metadata (${metaResponse.status})`)
    }

    const metadata = await metaResponse.json()

    // Validate amount is within limits
    const amountMsat = amountSats * 1000
    if (amountMsat < metadata.minSendable || amountMsat > metadata.maxSendable) {
      throw new Error(`Amount ${amountSats} sats out of range (min: ${metadata.minSendable / 1000}, max: ${metadata.maxSendable / 1000})`)
    }

    // Request invoice
    let callbackUrl = `${metadata.callback}?amount=${amountMsat}`

    if (comment && metadata.commentAllowed) {
      callbackUrl += `&comment=${encodeURIComponent(comment.substring(0, metadata.commentAllowed))}`
    }

    const invoiceResponse = await fetchWithTimeout(callbackUrl, {}, 5000)

    if (!invoiceResponse.ok) {
      throw new Error(`Could not get invoice from Lightning address (${invoiceResponse.status})`)
    }

    const invoiceData = await invoiceResponse.json()

    if (invoiceData.status === 'ERROR') {
      throw new Error(invoiceData.reason || 'Invoice request failed')
    }

    if (!invoiceData.pr) {
      throw new Error('Invalid LNURL response: missing payment request')
    }

    return invoiceData.pr // The BOLT11 invoice
  } catch (error) {
    console.error('[Lightning] LNURL invoice error:', { address: lightningAddress, error: error.message })
    return null
  }
}

/**
 * Get wallet balance
 */
export async function getBalance() {
  if (!LNBITS_API_KEY) {
    return { balance: 0, error: 'LNbits not configured' }
  }

  try {
    const response = await fetchWithTimeout(`${LNBITS_URL}/api/v1/wallet`, {
      headers: {
        'X-Api-Key': LNBITS_API_KEY
      }
    })

    if (!response.ok) {
      console.warn('[Lightning] Get balance failed:', { status: response.status })
      return { balance: 0, error: `HTTP ${response.status}` }
    }

    const data = await response.json()

    if (typeof data.balance !== 'number') {
      console.warn('[Lightning] Invalid balance response:', data)
      return { balance: 0, error: 'Invalid response' }
    }

    return { balance: Math.floor(data.balance / 1000) } // Convert msat to sat
  } catch (error) {
    console.error('[Lightning] Get balance error:', error.message)
    return { balance: 0, error: error.message }
  }
}

// ============= MOCK FUNCTIONS FOR DEVELOPMENT =============

const mockPayments = new Map()

function createMockInvoice(amountSats, memo) {
  const paymentHash = crypto.randomBytes(32).toString('hex')
  const paymentRequest = `lnbc${amountSats}n1mock${paymentHash.substring(0, 20)}`

  mockPayments.set(paymentHash, {
    amount: amountSats,
    memo,
    paid: false,
    createdAt: Date.now()
  })

  // Auto-pay mock invoice after 3 seconds (for testing)
  setTimeout(() => {
    const payment = mockPayments.get(paymentHash)
    if (payment) {
      payment.paid = true
      console.log(`Mock payment received: ${amountSats} sats`)
    }
  }, 3000)

  return {
    paymentHash,
    paymentRequest
  }
}

function checkMockPayment(paymentHash) {
  const payment = mockPayments.get(paymentHash)
  return payment?.paid === true
}

export default {
  createInvoice,
  checkPayment,
  payToAddress,
  getBalance
}
