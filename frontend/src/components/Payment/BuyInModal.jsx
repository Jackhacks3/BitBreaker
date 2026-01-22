import React, { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'

/**
 * BuyInModal Component
 *
 * Handles the Lightning payment flow:
 * 1. Requests invoice from backend
 * 2. Displays QR code for payment
 * 3. Polls for payment confirmation
 * 4. Supports WebLN for browser wallet payments
 */
function BuyInModal({ tournament, user, onSuccess, onClose }) {
  const [invoice, setInvoice] = useState(null)
  const [paymentHash, setPaymentHash] = useState(null)
  const [status, setStatus] = useState('loading') // loading, ready, paying, success, error
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const buyInSats = tournament?.buyInSats || 10000

  // Request invoice on mount
  useEffect(() => {
    requestInvoice()
  }, [])

  // Poll for payment when we have an invoice
  useEffect(() => {
    if (!paymentHash || status !== 'ready') return

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/status/${paymentHash}`, {
          headers: { 'Authorization': `Bearer ${user.token}` }
        })
        const data = await res.json()

        if (data.paid) {
          setStatus('success')
          clearInterval(pollInterval)
          setTimeout(() => onSuccess(), 1500)
        }
      } catch (err) {
        console.error('Poll error:', err)
      }
    }, 2000) // Check every 2 seconds

    return () => clearInterval(pollInterval)
  }, [paymentHash, status, user.token, onSuccess])

  const requestInvoice = async () => {
    setStatus('loading')
    setError('')

    try {
      const res = await fetch('/api/payments/buy-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          tournamentId: tournament.id
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create invoice')
      }

      setInvoice(data.invoice)
      setPaymentHash(data.paymentHash)
      setStatus('ready')

      // Try WebLN auto-payment
      tryWebLN(data.invoice)
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const tryWebLN = async (bolt11) => {
    // Check if WebLN is available (Alby, etc.)
    if (typeof window.webln !== 'undefined') {
      try {
        await window.webln.enable()
        setStatus('paying')
        await window.webln.sendPayment(bolt11)
        // Payment will be detected by polling
      } catch (err) {
        // User cancelled or WebLN failed - that's OK, they can scan QR
        console.log('WebLN payment cancelled or failed:', err)
        setStatus('ready')
      }
    }
  }

  const copyInvoice = () => {
    navigator.clipboard.writeText(invoice)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openInWallet = () => {
    window.open(`lightning:${invoice}`, '_blank')
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {status === 'loading' && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div className="spinner"></div>
            <p style={{ marginTop: '1rem' }}>Creating invoice...</p>
          </div>
        )}

        {status === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: '#ff6b6b' }}>Error</h2>
            <p style={{ margin: '1rem 0' }}>{error}</p>
            <button onClick={requestInvoice} className="btn-copy">
              Try Again
            </button>
            <button onClick={onClose} className="btn-close">
              Cancel
            </button>
          </div>
        )}

        {(status === 'ready' || status === 'paying') && invoice && (
          <div style={{ textAlign: 'center' }}>
            <h2>Buy In: {buyInSats.toLocaleString()} sats</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '1rem' }}>
              Scan with any Lightning wallet to pay
            </p>

            <div className="qr-code">
              <QRCodeSVG
                value={invoice.toUpperCase()}
                size={200}
                level="M"
                includeMargin={true}
              />
            </div>

            {status === 'paying' && (
              <p style={{ color: '#feca57', margin: '1rem 0' }}>
                Waiting for payment confirmation...
              </p>
            )}

            <div className="invoice-text">
              {invoice.substring(0, 40)}...
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={copyInvoice} className="btn-copy">
                {copied ? 'Copied!' : 'Copy Invoice'}
              </button>
              <button onClick={openInWallet} className="btn-copy">
                Open in Wallet
              </button>
            </div>

            <button onClick={onClose} className="btn-close" style={{ marginTop: '1rem' }}>
              Cancel
            </button>

            {/* WebLN indicator */}
            {typeof window !== 'undefined' && window.webln && (
              <p style={{ fontSize: '0.75rem', color: '#1dd1a1', marginTop: '1rem' }}>
                ✓ WebLN detected - payment may auto-complete
              </p>
            )}
          </div>
        )}

        {status === 'success' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>⚡</div>
            <h2 style={{ color: '#1dd1a1' }}>Payment Received!</h2>
            <p style={{ margin: '1rem 0' }}>You're in! Good luck!</p>
          </div>
        )}

        <style>{`
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          }

          .modal {
            background: #1a1a2e;
            border-radius: 15px;
            padding: 2rem;
            max-width: 400px;
            width: 90%;
            border: 1px solid rgba(0, 217, 255, 0.3);
          }

          .modal h2 {
            color: #00d9ff;
            margin-bottom: 0.5rem;
          }

          .qr-code {
            background: #fff;
            padding: 1rem;
            border-radius: 10px;
            display: inline-block;
            margin: 1rem 0;
          }

          .invoice-text {
            font-family: monospace;
            font-size: 0.7rem;
            word-break: break-all;
            background: rgba(0, 0, 0, 0.3);
            padding: 0.5rem;
            border-radius: 5px;
            margin: 1rem 0;
            color: rgba(255, 255, 255, 0.5);
          }

          .btn-copy {
            padding: 0.5rem 1rem;
            background: rgba(0, 217, 255, 0.2);
            border: 1px solid #00d9ff;
            color: #00d9ff;
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.2s;
          }

          .btn-copy:hover {
            background: rgba(0, 217, 255, 0.3);
          }

          .btn-close {
            padding: 0.5rem 1rem;
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: rgba(255, 255, 255, 0.7);
            border-radius: 5px;
            cursor: pointer;
          }

          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(0, 217, 255, 0.3);
            border-top-color: #00d9ff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto;
          }

          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  )
}

export default BuyInModal
