import React, { useState, useEffect, useCallback, useMemo } from 'react'

const API_BASE = '/api'

/**
 * WalletModal Component
 *
 * Displays user wallet balance, allows deposits via Lightning,
 * and shows transaction history.
 */
function WalletModal({ user, onClose, onUpdate }) {
  const [balance, setBalance] = useState({ sats: 0, usd: 0 })
  const [exchangeRate, setExchangeRate] = useState({ btcUsd: 0, satsPerUsd: 0 })
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Deposit state
  const [depositAmount, setDepositAmount] = useState(0.50) // Default $0.50 for testing
  const [depositInvoice, setDepositInvoice] = useState(null)
  const [depositHash, setDepositHash] = useState(null)
  const [checkingPayment, setCheckingPayment] = useState(false)
  const [depositSuccess, setDepositSuccess] = useState(false)
  const [qrLoaded, setQrLoaded] = useState(false)
  const [generatingInvoice, setGeneratingInvoice] = useState(false)

  // Memoize QR code URL to prevent re-renders
  const qrCodeUrl = useMemo(() => {
    if (!depositInvoice) return null
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(depositInvoice)}`
  }, [depositInvoice])

  // Fetch wallet data on mount
  useEffect(() => {
    fetchWalletData()
  }, [])

  // Poll for payment when we have an invoice
  useEffect(() => {
    if (!depositHash || !user?.token) return

    const pollInterval = setInterval(async () => {
      setCheckingPayment(true)
      try {
        const res = await fetch(`${API_BASE}/wallet/deposit/status/${depositHash}`, {
          headers: { 'Authorization': `Bearer ${user.token}` }
        })
        const data = await res.json()

        if (data.paid) {
          setDepositSuccess(true)
          setDepositInvoice(null)
          setDepositHash(null)
          clearInterval(pollInterval)
          fetchWalletData()
          if (onUpdate) onUpdate()
        } else if (data.expired) {
          setError('Invoice expired. Please try again.')
          setDepositInvoice(null)
          setDepositHash(null)
          clearInterval(pollInterval)
        }
      } catch (err) {
        console.error('Payment check error:', err)
      }
      setCheckingPayment(false)
    }, 3000) // Check every 3 seconds

    return () => clearInterval(pollInterval)
  }, [depositHash, user?.token])

  const fetchWalletData = async () => {
    if (!user?.token) return

    setLoading(true)
    try {
      // Fetch balance
      const balanceRes = await fetch(`${API_BASE}/wallet/balance`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const balanceData = await balanceRes.json()

      setBalance({
        sats: balanceData.balanceSats || 0,
        usd: balanceData.balanceUsd || 0
      })
      setExchangeRate(balanceData.exchangeRate || { btcUsd: 0, satsPerUsd: 0 })

      // Fetch transactions
      const txRes = await fetch(`${API_BASE}/wallet/transactions?limit=10`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const txData = await txRes.json()
      setTransactions(txData.transactions || [])
    } catch (err) {
      setError('Failed to load wallet data')
      console.error(err)
    }
    setLoading(false)
  }

  const handleDeposit = async () => {
    if (!user?.token || depositAmount < 0.10 || generatingInvoice) return

    setError('')
    setGeneratingInvoice(true)
    setQrLoaded(false)

    try {
      // Convert USD to sats
      const amountSats = Math.round(depositAmount * exchangeRate.satsPerUsd)

      const res = await fetch(`${API_BASE}/wallet/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({ amountSats })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create invoice')
      }

      setDepositInvoice(data.invoice)
      setDepositHash(data.paymentHash)
      setDepositSuccess(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setGeneratingInvoice(false)
    }
  }

  const copyInvoice = async () => {
    if (depositInvoice) {
      try {
        await navigator.clipboard.writeText(depositInvoice)
        alert('Invoice copied to clipboard!')
      } catch (err) {
        console.error('Copy failed:', err)
      }
    }
  }

  const openInWallet = () => {
    if (depositInvoice) {
      window.location.href = `lightning:${depositInvoice}`
    }
  }

  const cancelDeposit = () => {
    setDepositInvoice(null)
    setDepositHash(null)
    setDepositSuccess(false)
    setQrLoaded(false)
  }

  const formatDate = (dateStr) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatType = (type) => {
    const types = {
      'deposit': 'Deposit',
      'game_attempt': 'Game Attempt',
      'buy_in': 'Tournament Buy-in',
      'payout': 'Prize Payout',
      'refund': 'Refund'
    }
    return types[type] || type
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wallet-modal">
        <button className="modal-close" onClick={onClose}>&times;</button>

        <h2 style={{ color: '#ffd700', marginBottom: '1.5rem' }}>Your Wallet</h2>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <p style={{ color: '#888' }}>Loading wallet...</p>
          </div>
        ) : (
          <>
            {/* Balance Display */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 170, 0, 0.1))',
              borderRadius: '10px',
              padding: '1.5rem',
              textAlign: 'center',
              marginBottom: '1.5rem',
              border: '1px solid rgba(255, 215, 0, 0.3)'
            }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ffd700' }}>
                ${balance.usd.toFixed(2)}
              </div>
              <div style={{ color: '#888', fontSize: '0.9rem' }}>
                {balance.sats.toLocaleString()} sats
              </div>
              <div style={{ color: '#666', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                Rate: ${exchangeRate.btcUsd?.toLocaleString() || '?'}/BTC
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div style={{
                background: 'rgba(231, 76, 60, 0.2)',
                border: '1px solid rgba(231, 76, 60, 0.5)',
                borderRadius: '5px',
                padding: '0.75rem',
                color: '#e74c3c',
                marginBottom: '1rem',
                fontSize: '0.9rem'
              }}>
                {error}
              </div>
            )}

            {/* Success message */}
            {depositSuccess && (
              <div style={{
                background: 'rgba(46, 204, 113, 0.2)',
                border: '1px solid rgba(46, 204, 113, 0.5)',
                borderRadius: '5px',
                padding: '0.75rem',
                color: '#2ecc71',
                marginBottom: '1rem',
                fontSize: '0.9rem'
              }}>
                Deposit successful! Your balance has been updated.
              </div>
            )}

            {/* Deposit Section */}
            {!depositInvoice ? (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ color: '#fff', marginBottom: '1rem', fontSize: '1rem' }}>Deposit via Lightning</h3>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: '#888', fontSize: '0.75rem' }}>Amount (USD)</label>
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(Math.max(0.10, parseFloat(e.target.value) || 0))}
                      min="0.10"
                      max="1000"
                      step="0.10"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 215, 0, 0.3)',
                        borderRadius: '5px',
                        color: '#fff',
                        fontSize: '1rem',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      onClick={handleDeposit}
                      disabled={generatingInvoice}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: generatingInvoice
                          ? 'rgba(255, 215, 0, 0.5)'
                          : 'linear-gradient(90deg, #ffd700, #ffaa00)',
                        border: 'none',
                        borderRadius: '5px',
                        color: '#000',
                        fontWeight: '600',
                        cursor: generatingInvoice ? 'wait' : 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {generatingInvoice ? 'Generating...' : 'Generate Invoice'}
                    </button>
                  </div>
                </div>
                <p style={{ color: '#666', fontSize: '0.75rem' }}>
                  Minimum deposit: $0.10 (~{Math.round(0.10 * exchangeRate.satsPerUsd).toLocaleString()} sats)
                </p>
              </div>
            ) : (
              /* Invoice Display */
              <div style={{
                marginBottom: '1.5rem',
                textAlign: 'center',
                animation: 'fadeIn 0.3s ease'
              }}>
                <h3 style={{ color: '#fff', marginBottom: '1rem', fontSize: '1rem' }}>
                  Pay ${depositAmount.toFixed(2)} via Lightning
                </h3>

                {/* QR Code with loading state */}
                <div style={{
                  background: '#fff',
                  padding: '1rem',
                  borderRadius: '10px',
                  display: 'inline-block',
                  marginBottom: '1rem',
                  position: 'relative',
                  minWidth: '200px',
                  minHeight: '200px'
                }}>
                  {!qrLoaded && (
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      color: '#333'
                    }}>
                      Loading QR...
                    </div>
                  )}
                  <img
                    src={qrCodeUrl}
                    alt="Lightning Invoice QR"
                    onLoad={() => setQrLoaded(true)}
                    style={{
                      display: 'block',
                      width: '200px',
                      height: '200px',
                      opacity: qrLoaded ? 1 : 0,
                      transition: 'opacity 0.3s ease'
                    }}
                  />
                </div>

                <p style={{
                  color: checkingPayment ? '#ffd700' : '#888',
                  fontSize: '0.85rem',
                  marginBottom: '0.5rem',
                  minHeight: '1.2em',
                  transition: 'color 0.2s ease'
                }}>
                  {checkingPayment ? '⚡ Checking for payment...' : 'Scan with Lightning wallet'}
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginBottom: '1rem' }}>
                  <button
                    onClick={openInWallet}
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'linear-gradient(90deg, #ffd700, #ffaa00)',
                      border: 'none',
                      borderRadius: '5px',
                      color: '#000',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Open in Wallet
                  </button>
                  <button
                    onClick={copyInvoice}
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'transparent',
                      border: '1px solid rgba(255, 215, 0, 0.5)',
                      borderRadius: '5px',
                      color: '#ffd700',
                      cursor: 'pointer'
                    }}
                  >
                    Copy Invoice
                  </button>
                </div>

                <button
                  onClick={cancelDeposit}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '5px',
                    color: '#888',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Transaction History */}
            <div>
              <h3 style={{ color: '#fff', marginBottom: '0.75rem', fontSize: '1rem' }}>Recent Activity</h3>
              {transactions.length === 0 ? (
                <p style={{ color: '#666', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
                  No transactions yet
                </p>
              ) : (
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {transactions.map((tx) => (
                    <div
                      key={tx.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.75rem',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                        fontSize: '0.85rem'
                      }}
                    >
                      <div>
                        <div style={{ color: '#fff' }}>{formatType(tx.type)}</div>
                        <div style={{ color: '#666', fontSize: '0.75rem' }}>{formatDate(tx.created_at)}</div>
                      </div>
                      <div style={{
                        color: tx.amount_sats > 0 ? '#2ecc71' : '#e74c3c',
                        fontWeight: '600'
                      }}>
                        {tx.amount_sats > 0 ? '+' : ''}{tx.amount_sats.toLocaleString()} sats
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        .wallet-modal {
          max-width: 450px;
          max-height: 90vh;
          overflow-y: auto;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }

        .wallet-modal button {
          transition: all 0.2s ease;
        }

        .wallet-modal button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(255, 215, 0, 0.3);
        }

        .wallet-modal button:active:not(:disabled) {
          transform: translateY(0);
        }

        .wallet-modal input {
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .wallet-modal input:focus {
          outline: none;
          border-color: rgba(255, 215, 0, 0.6);
          box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.1);
        }
      `}</style>
    </div>
  )
}

export default WalletModal
