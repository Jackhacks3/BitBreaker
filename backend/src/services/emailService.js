/**
 * Email Service – Resend for verification & password reset
 *
 * When RESEND_API_KEY is set, sends via Resend. Otherwise logs to console (dev stub).
 * Set EMAIL_SENDER to a verified domain in Resend (e.g. "BitBreaker <noreply@yourdomain.com>").
 * Resend test domain: onboarding@resend.dev (works with API key; for production verify your domain).
 */

const VERIFY_SUBJECT = 'Verify your BitBreaker email'
const RESET_SUBJECT = 'Reset your BitBreaker password'

let resendClient = null
let resendChecked = false

async function getResend() {
  if (resendClient) return resendClient
  const key = process.env.RESEND_API_KEY
  if (!key || typeof key !== 'string' || key.startsWith('re_your_') || key === '') {
    if (!resendChecked) {
      resendChecked = true
      console.log('[EMAIL] RESEND_API_KEY not set or placeholder – verification/password-reset emails will NOT be sent. Set RESEND_API_KEY in .env to your key from https://resend.com')
    }
    return null
  }
  if (!resendChecked) {
    resendChecked = true
    console.log('[EMAIL] Resend configured (key set). From:', process.env.EMAIL_SENDER || 'BitBreaker <onboarding@resend.dev>')
  }
  const { Resend } = await import('resend')
  resendClient = new Resend(key)
  return resendClient
}

/**
 * Send email via Resend or stub
 * @param {string} to - Email address
 * @param {string} subject - Subject
 * @param {string} body - Plain text body (also used for html)
 * @returns {Promise<boolean>} - true if sent or logged
 */
export async function sendEmail(to, subject, body) {
  if (!to || typeof to !== 'string') return false

  const resend = await getResend()
  const from = process.env.EMAIL_SENDER || 'BitBreaker <onboarding@resend.dev>'

  if (resend) {
    try {
      const { data, error } = await resend.emails.send({
        from,
        to: [to],
        subject,
        text: body,
        html: body.replace(/\n/g, '<br>')
      })
      if (error) {
        console.error('[EMAIL] Resend error:', error.message, typeof error === 'object' ? JSON.stringify(error) : '')
        return false
      }
      console.log('[EMAIL] Sent via Resend:', data?.id, 'to', to)
      return true
    } catch (err) {
      console.error('[EMAIL] Resend send failed:', err.message, err.stack || '')
      return false
    }
  }

  console.log('[EMAIL] (stub – set RESEND_API_KEY to send)', { to: to.substring(0, 20) + '...', subject })
  return true
}

/**
 * Send verification email with link
 */
export async function sendVerificationEmail(to, token, baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000') {
  const base = baseUrl.replace(/\/$/, '')
  const link = `${base}/?verify-email=${encodeURIComponent(token)}`
  const body = `Verify your email by opening this link:\n${link}\n\nIf you didn't sign up, ignore this email.`
  return sendEmail(to, VERIFY_SUBJECT, body)
}

/**
 * Send password reset email with link
 */
export async function sendPasswordResetEmail(to, token, baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000') {
  const base = baseUrl.replace(/\/$/, '')
  const link = `${base}/?reset-password=${encodeURIComponent(token)}`
  const body = `Reset your password by opening this link:\n${link}\n\nLink expires in 1 hour. If you didn't request this, ignore this email.`
  return sendEmail(to, RESET_SUBJECT, body)
}
