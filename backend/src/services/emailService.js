/**
 * Email Service – Resend for verification & password reset
 *
 * When RESEND_API_KEY is set, sends via Resend. Otherwise logs to console (dev stub).
 * Set EMAIL_SENDER to a verified domain in Resend (e.g. "BitBreaker <noreply@yourdomain.com>").
 */

const VERIFY_SUBJECT = 'Verify your BitBreaker email'
const RESET_SUBJECT = 'Reset your BitBreaker password'

let resendClient = null

async function getResend() {
  if (resendClient) return resendClient
  const key = process.env.RESEND_API_KEY
  if (!key || typeof key !== 'string') return null
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
        console.error('[EMAIL] Resend error:', error.message)
        return false
      }
      console.log('[EMAIL] Sent via Resend:', data?.id, to.substring(0, 20) + '...')
      return true
    } catch (err) {
      console.error('[EMAIL] Resend send failed:', err.message)
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
