import React, { useState } from 'react'

/**
 * Login Component - Username/Password Auth
 *
 * Simple username/password authentication:
 * 1. User enters username and password
 * 2. On register: creates new account
 * 3. On login: validates credentials
 * 4. Returns session token on success
 */

const API_BASE = import.meta.env.VITE_API_URL || 'https://bitbreaker.onrender.com/api'

function Login({ onLogin }) {
  const [mode, setMode] = useState('login') // login | register
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'
      const body = mode === 'login'
        ? { username, password }
        : { username, password, displayName: displayName || username }

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed')
      }

      // Success - pass user data to parent
      onLogin({
        id: data.userId,
        username: data.username,
        displayName: data.displayName,
        token: data.token
      })

      setShowModal(false)
      resetForm()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setUsername('')
    setPassword('')
    setDisplayName('')
    setError('')
  }

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setError('')
  }

  // Render login button
  if (!showModal) {
    return (
      <button
        onClick={() => setShowModal(true)}
        style={{
          padding: '0.5rem 1.5rem',
          background: 'linear-gradient(90deg, #ffd700, #ffaa00)',
          border: 'none',
          borderRadius: '5px',
          color: '#000',
          fontWeight: '600',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
        </svg>
        Login / Sign Up
      </button>
    )
  }

  // Render modal
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.9)',
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
        border: '2px solid rgba(255, 215, 0, 0.3)',
        textAlign: 'center'
      }}>
        {/* Header */}
        <h2 style={{ marginBottom: '0.5rem', color: '#ffd700' }}>
          {mode === 'login' ? 'Welcome Back!' : 'Create Account'}
        </h2>
        <p style={{ color: '#888', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          {mode === 'login'
            ? 'Login to play and compete for the jackpot'
            : 'Sign up to start playing - $5 per attempt, 3 max daily'}
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Username */}
          <div style={{ marginBottom: '1rem', textAlign: 'left' }}>
            <label style={{ color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9_]+"
              title="Letters, numbers, and underscores only"
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

          {/* Display Name (register only) */}
          {mode === 'register' && (
            <div style={{ marginBottom: '1rem', textAlign: 'left' }}>
              <label style={{ color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                Display Name <span style={{ color: '#666' }}>(optional)</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How you'll appear on leaderboard"
                maxLength={50}
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
          )}

          {/* Password */}
          <div style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
            <label style={{ color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Min 8 characters' : 'Enter password'}
              required
              minLength={mode === 'register' ? 8 : 1}
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

          {/* Error message */}
          {error && (
            <div style={{
              padding: '0.75rem',
              background: 'rgba(231, 76, 60, 0.2)',
              border: '1px solid rgba(231, 76, 60, 0.5)',
              borderRadius: '5px',
              color: '#e74c3c',
              marginBottom: '1rem',
              fontSize: '0.9rem'
            }}>
              {error}
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: loading ? '#666' : 'linear-gradient(90deg, #ffd700, #ffaa00)',
              border: 'none',
              borderRadius: '5px',
              color: '#000',
              fontWeight: '600',
              fontSize: '1rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              marginBottom: '1rem'
            }}
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}
          </button>
        </form>

        {/* Toggle mode */}
        <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '1rem' }}>
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
          <button
            onClick={toggleMode}
            style={{
              background: 'none',
              border: 'none',
              color: '#ffd700',
              cursor: 'pointer',
              marginLeft: '0.5rem',
              textDecoration: 'underline'
            }}
          >
            {mode === 'login' ? 'Sign Up' : 'Login'}
          </button>
        </p>

        {/* Close button */}
        <button
          onClick={() => {
            setShowModal(false)
            resetForm()
          }}
          style={{
            padding: '0.5rem 1rem',
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '5px',
            color: '#888',
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>

        {/* Info notice */}
        <p style={{
          marginTop: '1.5rem',
          padding: '0.75rem',
          background: 'rgba(255, 215, 0, 0.1)',
          borderRadius: '5px',
          color: '#888',
          fontSize: '0.75rem'
        }}>
          💰 $5 per attempt • 🎮 3 attempts daily • 🏆 Top 3 split 98% jackpot
        </p>
      </div>
    </div>
  )
}

export default Login
