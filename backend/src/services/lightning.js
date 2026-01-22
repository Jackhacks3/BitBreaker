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

const LNBITS_URL = process.env.LNBITS_URL || 'https://legend.lnbits.com'
const LNBITS_API_KEY = process.env.LNBITS_API_KEY // Invoice key (read)
const LNBITS_ADMIN_KEY = process.env.LNBITS_ADMIN_KEY // Admin key (send payments)

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
    const response = await fetch(`${LNBITS_URL}/api/v1/payments`, {
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
      const error = await response.text()
      throw new Error(`LNbits error: ${error}`)
    }

    const data = await response.json()

    return {
      paymentHash: data.payment_hash,
      paymentRequest: data.payment_request
    }
  } catch (error) {
    console.error('Create invoice error:', error)
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
    const response = await fetch(`${LNBITS_URL}/api/v1/payments/${paymentHash}`, {
      headers: {
        'X-Api-Key': LNBITS_API_KEY
      }
    })

    if (!response.ok) {
      return false
    }

    const data = await response.json()
    return data.paid === true
  } catch (error) {
    console.error('Check payment error:', error)
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
    return { success: false, error: 'Payouts not configured' }
  }

  try {
    // First, get invoice from Lightning address
    const invoice = await fetchLNURLInvoice(lightningAddress, amountSats, comment)

    if (!invoice) {
      return { success: false, error: 'Could not get invoice from Lightning address' }
    }

    // Pay the invoice
    const response = await fetch(`${LNBITS_URL}/api/v1/payments`, {
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
      const error = await response.text()
      throw new Error(`Payment failed: ${error}`)
    }

    const data = await response.json()

    return {
      success: true,
      paymentHash: data.payment_hash
    }
  } catch (error) {
    console.error('Pay to address error:', error)
    return { success: false, error: error.message }
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
    const metaResponse = await fetch(wellKnownUrl)

    if (!metaResponse.ok) {
      throw new Error('Could not fetch Lightning address metadata')
    }

    const metadata = await metaResponse.json()

    // Validate amount is within limits
    const amountMsat = amountSats * 1000
    if (amountMsat < metadata.minSendable || amountMsat > metadata.maxSendable) {
      throw new Error(`Amount ${amountSats} sats out of range`)
    }

    // Request invoice
    let callbackUrl = `${metadata.callback}?amount=${amountMsat}`

    if (comment && metadata.commentAllowed) {
      callbackUrl += `&comment=${encodeURIComponent(comment.substring(0, metadata.commentAllowed))}`
    }

    const invoiceResponse = await fetch(callbackUrl)

    if (!invoiceResponse.ok) {
      throw new Error('Could not get invoice from Lightning address')
    }

    const invoiceData = await invoiceResponse.json()

    if (invoiceData.status === 'ERROR') {
      throw new Error(invoiceData.reason || 'Invoice request failed')
    }

    return invoiceData.pr // The BOLT11 invoice
  } catch (error) {
    console.error('LNURL invoice error:', error)
    return null
  }
}

/**
 * Get wallet balance
 */
export async function getBalance() {
  if (!LNBITS_API_KEY) {
    return { balance: 0 }
  }

  try {
    const response = await fetch(`${LNBITS_URL}/api/v1/wallet`, {
      headers: {
        'X-Api-Key': LNBITS_API_KEY
      }
    })

    if (!response.ok) {
      return { balance: 0 }
    }

    const data = await response.json()
    return { balance: Math.floor(data.balance / 1000) } // Convert msat to sat
  } catch (error) {
    console.error('Get balance error:', error)
    return { balance: 0 }
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

// Need crypto for mock
import crypto from 'crypto'

export default {
  createInvoice,
  checkPayment,
  payToAddress,
  getBalance
}
