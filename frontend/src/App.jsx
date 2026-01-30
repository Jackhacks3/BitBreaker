import React, { useState, useEffect, useCallback } from 'react'
import GameCanvas from './components/Game/GameCanvas'
import Login from './components/Auth/Login'
import Leaderboard from './components/Tournament/Leaderboard'
import WalletModal from './components/Wallet/WalletModal'
import RulesModal from './components/Rules/RulesModal'
import PlayerGuideModal from './components/Guide/PlayerGuideModal'
import { API_BASE as API_URL } from './utils/api'
import './App.css'

// Fetch CSRF token for protected routes
async function getCsrfToken() {
  try {
    const res = await fetch(`${API_URL}/csrf-token`, { credentials: 'include' })
    const data = await res.json()
    return data.csrfToken
  } catch (err) {
    console.error('Failed to get CSRF token:', err)
    return null
  }
}

function App() {
  // Auth state
  const [user, setUser] = useState(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // Tournament state
  const [tournament, setTournament] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])

  // Attempts state
  const [attempts, setAttempts] = useState({ used: 0, remaining: 3, max: 3 })
  const [attemptScores, setAttemptScores] = useState({ attempt1: null, attempt2: null, attempt3: null, best: 0 })
  const [walletBalance, setWalletBalance] = useState({ sats: 0, usd: 0 })
  const [canPlay, setCanPlay] = useState(false)
  const [costSats, setCostSats] = useState(0)
  const [costUsd, setCostUsd] = useState(5)

  // UI state
  const [showWallet, setShowWallet] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentScore, setCurrentScore] = useState(0)
  const [currentAttemptId, setCurrentAttemptId] = useState(null)
  const [currentAttemptNumber, setCurrentAttemptNumber] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [startingAttempt, setStartingAttempt] = useState(false)

  // Check login status on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('user')
    if (savedUser) {
      const userData = JSON.parse(savedUser)
      setUser(userData)
      setIsLoggedIn(true)
    }
  }, [])

  // Fetch tournament data
  useEffect(() => {
    fetchTournament()
    fetchLeaderboard()

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchTournament()
      fetchLeaderboard()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  // Fetch attempts when logged in
  useEffect(() => {
    if (isLoggedIn && user) {
      fetchAttempts()
    }
  }, [isLoggedIn, user])

  const fetchTournament = async () => {
    try {
      const res = await fetch(`${API_URL}/tournaments/current`)
      const data = await res.json()
      setTournament(data)
    } catch (err) {
      console.error('Failed to fetch tournament:', err)
    }
  }

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch(`${API_URL}/tournaments/current/leaderboard`)
      const data = await res.json()
      setLeaderboard(data)
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err)
    }
  }

  const fetchAttempts = async () => {
    if (!user?.token) return

    try {
      const res = await fetch(`${API_URL}/game/attempts`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })

      // Handle unauthorized - clear stale session
      if (res.status === 401) {
        console.log('Session expired, logging out')
        handleLogout()
        return
      }

      const data = await res.json()

      setAttempts({
        used: data.attemptsUsed || 0,
        remaining: data.attemptsRemaining ?? 3,
        max: data.maxAttempts || 3
      })
      setAttemptScores(data.scores || { attempt1: null, attempt2: null, attempt3: null, best: 0 })
      const costRatio = (data.costSats && data.costUsd) ? (data.costSats / data.costUsd) : 1141
      setWalletBalance({ sats: data.balanceSats || 0, usd: (data.balanceSats || 0) / costRatio })
      setCanPlay(data.canPlay || false)
      setCostSats(data.costSats || 5705)
      setCostUsd(data.costUsd || 5)
    } catch (err) {
      console.error('Failed to fetch attempts:', err)
    }
  }

  const handleLogin = (userData) => {
    setUser(userData)
    setIsLoggedIn(true)
    localStorage.setItem('user', JSON.stringify(userData))
    // Fetch attempts after login
    setTimeout(fetchAttempts, 100)
  }

  const handleLogout = () => {
    setUser(null)
    setIsLoggedIn(false)
    setAttempts({ used: 0, remaining: 3, max: 3 })
    setCanPlay(false)
    localStorage.removeItem('user')
  }

  const handleWalletUpdate = () => {
    fetchAttempts()
  }

  const startAttempt = async () => {
    if (!user?.token || startingAttempt) return

    setStartingAttempt(true)
    setShowConfirm(false)

    try {
      // Get CSRF token first
      const csrfToken = await getCsrfToken()

      const res = await fetch(`${API_URL}/game/start-attempt`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`,
          'x-csrf-token': csrfToken || ''
        }
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.error === 'Insufficient balance') {
          alert(`Insufficient balance! You need ${data.requiredUsd?.toFixed(2) || '$5.00'}. Current balance: $${data.balanceUsd?.toFixed(2) || '0.00'}`)
          setShowWallet(true)
        } else {
          alert(data.error || 'Failed to start attempt')
        }
        return
      }

      // Start game
      setCurrentAttemptId(data.attemptId)
      setCurrentAttemptNumber(data.attemptNumber)
      setIsPlaying(true)
      setCurrentScore(0)

      // Update local state
      setAttempts(prev => ({
        ...prev,
        used: data.attemptNumber,
        remaining: data.attemptsRemaining
      }))
      setWalletBalance(prev => ({
        ...prev,
        sats: data.newBalanceSats
      }))

      // Refresh tournament data
      fetchTournament()
    } catch (err) {
      console.error('Failed to start attempt:', err)
      alert('Failed to start game. Please try again.')
    } finally {
      setStartingAttempt(false)
    }
  }

  const handleGameOver = async (gameData) => {
    setIsPlaying(false)

    if (user && currentAttemptId) {
      try {
        // Get CSRF token for submission
        const csrfToken = await getCsrfToken()

        const res = await fetch(`${API_URL}/game/submit`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.token}`,
            'x-csrf-token': csrfToken || ''
          },
          body: JSON.stringify({
            ...gameData,
            attemptId: currentAttemptId
          })
        })

        const data = await res.json()

        if (res.ok) {
          // Update attempt scores
          setAttemptScores(data.scores || attemptScores)

          // Show result
          const isNewBest = data.isNewBest
          alert(`Game Over!\n\nScore: ${gameData.score.toLocaleString()}\n${isNewBest ? '🏆 NEW BEST SCORE!' : `Best: ${data.bestScore.toLocaleString()}`}`)
        }

        fetchLeaderboard()
        fetchAttempts()
      } catch (err) {
        console.error('Failed to submit score:', err)
      }
    }

    setCurrentAttemptId(null)
    setCurrentAttemptNumber(null)
  }

  const handleScoreUpdate = useCallback((score) => {
    setCurrentScore(score)
  }, [])

  const handlePlayClick = () => {
    if (!isLoggedIn) {
      return // Login component will handle this
    }
    if (attempts.remaining <= 0) {
      alert('You have used all 3 attempts for today. Come back tomorrow!')
      return
    }
    if (!canPlay) {
      setShowWallet(true)
      return
    }
    setShowConfirm(true)
  }

  return (
    <div className="app">
      {/* Top Bar - Jackpot and Timer */}
      <header className="header">
        <div className="jackpot-display">
          <span className="jackpot-label">JACKPOT</span>
          <span className="jackpot-amount">${tournament?.jackpotUsd?.toFixed(2) || '0.00'}</span>
        </div>
        <h1 className="title">BIT BREAKER</h1>
        <div className="timer-display">
          <span className="timer-label">ENDS IN</span>
          <CountdownTimer endTime={tournament?.endTime} />
        </div>
      </header>

      <main className="main-layout">
        {/* Game Area */}
        <div className="game-section">
          {isPlaying ? (
            <div className="game-active">
              <div className="game-header">
                <span className="attempt-badge">Attempt #{currentAttemptNumber}</span>
                <span className="score-display">SCORE: {currentScore.toLocaleString()}</span>
              </div>
              <GameCanvas
                onScoreUpdate={handleScoreUpdate}
                onGameOver={handleGameOver}
              />
            </div>
          ) : (
            <div className="game-placeholder">
              <h2>ENDLESS BIT BREAKER</h2>
              <p className="game-tagline">$5 per attempt • 3 max daily • Top 3 win the jackpot!</p>

              {/* Attempt Indicators */}
              {isLoggedIn && (
                <div className="attempts-section">
                  <AttemptIndicator
                    attempts={attempts}
                    scores={attemptScores}
                  />
                </div>
              )}

              {/* Play Button */}
              {!isLoggedIn ? (
                <div className="login-section">
                  <p className="login-prompt">Login or Sign Up to play!</p>
                  <Login onLogin={handleLogin} />
                </div>
              ) : (
                <button
                  onClick={handlePlayClick}
                  className={`btn-play ${!canPlay || attempts.remaining <= 0 ? 'disabled' : ''}`}
                  disabled={startingAttempt}
                >
                  {startingAttempt ? 'STARTING...' :
                    attempts.remaining <= 0 ? 'NO ATTEMPTS LEFT' :
                      `PLAY ($${(costUsd || 5).toFixed(2)})`}
                </button>
              )}

              {/* Quick Info */}
              <div className="quick-info">
                <div className="info-item">
                  <span className="info-icon">🎮</span>
                  <span>Arrow keys or A/D to move</span>
                </div>
                <div className="info-item">
                  <span className="info-icon">🏆</span>
                  <span>Best score counts for ranking</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <aside className="leaderboard-section">
          <div className="leaderboard-header">
            <h3>TODAY'S LEADERBOARD</h3>
            <span className="player-count">{tournament?.playerCount || 0} players</span>
          </div>
          <Leaderboard entries={leaderboard} currentUser={user} />

          {/* Prize Structure */}
          <div className="prize-structure">
            <h4>PRIZE SPLIT</h4>
            <div className="prize-row first">
              <span>1st</span>
              <span>${tournament?.payoutStructure?.first?.usd?.toFixed(2) || '0.00'}</span>
              <span className="percent">50%</span>
            </div>
            <div className="prize-row second">
              <span>2nd</span>
              <span>${tournament?.payoutStructure?.second?.usd?.toFixed(2) || '0.00'}</span>
              <span className="percent">30%</span>
            </div>
            <div className="prize-row third">
              <span>3rd</span>
              <span>${tournament?.payoutStructure?.third?.usd?.toFixed(2) || '0.00'}</span>
              <span className="percent">20%</span>
            </div>
            <div className="house-fee">2% house fee</div>
          </div>
        </aside>
      </main>

      {/* Bottom Bar - User Actions */}
      <footer className="footer">
        {isLoggedIn ? (
          <>
            <button onClick={() => setShowWallet(true)} className="btn-footer">
              💰 ${walletBalance.sats > 0 ? (walletBalance.sats / ((costSats || 5705) / (costUsd || 5))).toFixed(2) : '0.00'}
            </button>
            <span className="username">{user.displayName}</span>
            <button onClick={() => setShowGuide(true)} className="btn-footer">❓ Help</button>
            <button onClick={() => setShowRules(true)} className="btn-footer">📖 Rules</button>
            <button onClick={handleLogout} className="btn-footer btn-logout">Logout</button>
          </>
        ) : (
          <>
            <button onClick={() => setShowGuide(true)} className="btn-footer">❓ Help</button>
            <button onClick={() => setShowRules(true)} className="btn-footer">📖 Rules</button>
            <Login onLogin={handleLogin} />
          </>
        )}
      </footer>

      {/* Confirm Modal */}
      {showConfirm && (
        <div className="modal-overlay">
          <div className="modal confirm-modal">
            <h3>Start Attempt #{attempts.used + 1}?</h3>
            <p className="cost-display">Cost: ${(costUsd || 5).toFixed(2)}</p>
            <p className="remaining-display">
              {attempts.remaining - 1} attempt{attempts.remaining - 1 !== 1 ? 's' : ''} remaining after this
            </p>
            <div className="modal-buttons">
              <button onClick={() => setShowConfirm(false)} className="btn-cancel">Cancel</button>
              <button onClick={startAttempt} className="btn-confirm">
                {startingAttempt ? 'Starting...' : 'Pay & Play'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Modal */}
      {showWallet && (
        <WalletModal
          user={user}
          onClose={() => setShowWallet(false)}
          onUpdate={handleWalletUpdate}
        />
      )}

      {/* Rules Modal */}
      {showRules && (
        <RulesModal onClose={() => setShowRules(false)} />
      )}

      {/* Player Guide Modal */}
      {showGuide && (
        <PlayerGuideModal onClose={() => setShowGuide(false)} />
      )}
    </div>
  )
}

// Attempt Indicator Component
function AttemptIndicator({ attempts, scores }) {
  return (
    <div className="attempt-indicator">
      <div className="attempt-dots">
        {[1, 2, 3].map(num => {
          const isUsed = num <= attempts.used
          const score = scores[`attempt${num}`]
          return (
            <div
              key={num}
              className={`attempt-dot ${isUsed ? 'used' : 'available'}`}
              title={isUsed ? `Attempt ${num}: ${score?.toLocaleString() || 0} points` : `Attempt ${num}: Available`}
            >
              {isUsed ? (
                <span className="dot-score">{score?.toLocaleString() || 0}</span>
              ) : (
                <span className="dot-number">{num}</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="attempt-text">
        {attempts.remaining > 0
          ? `${attempts.remaining} attempt${attempts.remaining !== 1 ? 's' : ''} remaining`
          : 'No attempts left today'}
      </div>
      {scores.best > 0 && (
        <div className="best-score">Best: {scores.best.toLocaleString()}</div>
      )}
    </div>
  )
}

// Countdown Timer Component
function CountdownTimer({ endTime }) {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    const updateTimer = () => {
      if (!endTime) {
        setTimeLeft('--:--:--')
        return
      }

      const now = new Date()
      const end = new Date(endTime)
      const diff = end - now

      if (diff <= 0) {
        setTimeLeft('Ended')
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      setTimeLeft(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`)
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [endTime])

  return <span className="countdown">{timeLeft}</span>
}

export default App
