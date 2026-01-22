import React, { useState } from 'react'

/**
 * Login Component
 *
 * Simple login that collects:
 * 1. Display name (for leaderboard)
 * 2. Lightning address (for payouts - e.g., user@getalby.com)
 *
 * In production, this would use LNURL-auth for cryptographic verification.
 * For simplicity, we're using a basic registration flow.
 */
function Login({ onLogin }) {
  const [displayName, setDisplayName] = useState('')
  const [lightningAddress, setLightningAddress] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Validate display name
    if (!displayName.trim() || displayName.length < 2) {
      setError('Display name must be at least 2 characters')
      return
    }

    if (displayName.length > 20) {
      setError('Display name must be 20 characters or less')
      return
    }

    // Validate Lightning address format (basic check)
    const lnAddressRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    if (!lnAddressRegex.test(lightningAddress)) {
      setError('Invalid Lightning address format (e.g., yourname@getalby.com)')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          lightningAddress: lightningAddress.trim().toLowerCase()
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed')
      }

      // Success - pass user data to parent
      onLogin({
        id: data.userId,
        displayName: data.displayName,
        lightningAddress: data.lightningAddress,
        token: data.token
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="btn-login"
        style={{
          padding: '0.5rem 1.5rem',
          background: 'linear-gradient(90deg, #00d9ff, #0099cc)',
          border: 'none',
          borderRadius: '5px',
          color: '#fff',
          fontWeight: '600',
          cursor: 'pointer'
        }}
      >
        Login / Register
      </button>
    )
  }

  return (
    <div className="login-modal" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: '#1a1a2e',
        borderRadius: '15px',
        padding: '2rem',
        maxWidth: '400px',
        width: '90%',
        border: '1px solid rgba(0, 217, 255, 0.3)'
      }}>
        <h2 style={{ marginBottom: '1rem', color: '#00d9ff', textAlign: 'center' }}>
          Join Tournament
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              Display Name (for leaderboard)
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="YourName"
              maxLength={20}
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '5px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: '1rem'
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              Lightning Address (for payouts)
            </label>
            <input
              type="text"
              value={lightningAddress}
              onChange={(e) => setLightningAddress(e.target.value)}
              placeholder="yourname@getalby.com"
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '5px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: '1rem'
              }}
            />
            <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.5rem' }}>
              Get a free Lightning address at getalby.com or walletofsatoshi.com
            </p>
          </div>

          {error && (
            <p style={{ color: '#ff6b6b', marginBottom: '1rem', fontSize: '0.9rem' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{
                flex: 1,
                padding: '0.75rem',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: '5px',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              style={{
                flex: 2,
                padding: '0.75rem',
                background: 'linear-gradient(90deg, #00d9ff, #0099cc)',
                border: 'none',
                borderRadius: '5px',
                color: '#fff',
                fontWeight: '600',
                cursor: isLoading ? 'wait' : 'pointer',
                opacity: isLoading ? 0.7 : 1
              }}
            >
              {isLoading ? 'Registering...' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Login
