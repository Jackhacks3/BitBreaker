import React, { useState, useEffect } from 'react'
import GameCanvas from './components/Game/GameCanvas'
import Login from './components/Auth/Login'
import Leaderboard from './components/Tournament/Leaderboard'
import PrizePool from './components/Tournament/PrizePool'
import BuyInModal from './components/Payment/BuyInModal'
import './App.css'

const API_URL = '/api'

function App() {
  // Auth state
  const [user, setUser] = useState(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // Tournament state
  const [tournament, setTournament] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [hasEntry, setHasEntry] = useState(false)

  // UI state
  const [showBuyIn, setShowBuyIn] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentScore, setCurrentScore] = useState(0)

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

  // Check if user has entry when logged in
  useEffect(() => {
    if (isLoggedIn && user && tournament) {
      checkEntry()
    }
  }, [isLoggedIn, user, tournament])

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

  const checkEntry = async () => {
    try {
      const res = await fetch(`${API_URL}/tournaments/current/entry`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await res.json()
      setHasEntry(data.hasEntry)
    } catch (err) {
      setHasEntry(false)
    }
  }

  const handleLogin = (userData) => {
    setUser(userData)
    setIsLoggedIn(true)
    localStorage.setItem('user', JSON.stringify(userData))
  }

  const handleLogout = () => {
    setUser(null)
    setIsLoggedIn(false)
    setHasEntry(false)
    localStorage.removeItem('user')
  }

  const handleBuyInSuccess = () => {
    setShowBuyIn(false)
    setHasEntry(true)
    fetchTournament()
  }

  const handleGameOver = async (gameData) => {
    setIsPlaying(false)

    // Submit score to server
    if (user && hasEntry) {
      try {
        await fetch(`${API_URL}/game/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.token}`
          },
          body: JSON.stringify(gameData)
        })
        fetchLeaderboard()
      } catch (err) {
        console.error('Failed to submit score:', err)
      }
    }
  }

  const handleScoreUpdate = (score) => {
    setCurrentScore(score)
  }

  const startGame = () => {
    if (!hasEntry) {
      setShowBuyIn(true)
      return
    }
    setIsPlaying(true)
    setCurrentScore(0)
  }

  return (
    <div className="app">
      <header className="header">
        <h1>BRICK BREAKER</h1>
        <div className="header-info">
          {isLoggedIn ? (
            <div className="user-info">
              <span className="username">{user.displayName}</span>
              <button onClick={handleLogout} className="btn-logout">Logout</button>
            </div>
          ) : (
            <Login onLogin={handleLogin} />
          )}
        </div>
      </header>

      <main className="main">
        <aside className="sidebar left">
          <PrizePool tournament={tournament} />

          <div className="tournament-info">
            <h3>Today's Tournament</h3>
            <div className="info-row">
              <span>Buy-in:</span>
              <span>{tournament?.buyInSats?.toLocaleString() || '10,000'} sats</span>
            </div>
            <div className="info-row">
              <span>Players:</span>
              <span>{tournament?.entryCount || 0}</span>
            </div>
            <div className="info-row">
              <span>Ends in:</span>
              <CountdownTimer endTime={tournament?.endTime} />
            </div>
          </div>

          <div className="prize-split">
            <h3>Prize Split</h3>
            <div className="split-row first">
              <span>1st Place</span>
              <span>50%</span>
            </div>
            <div className="split-row second">
              <span>2nd Place</span>
              <span>30%</span>
            </div>
            <div className="split-row third">
              <span>3rd Place</span>
              <span>20%</span>
            </div>
            <div className="house-fee">
              <span>House Fee</span>
              <span>2%</span>
            </div>
          </div>
        </aside>

        <div className="game-area">
          {isPlaying ? (
            <GameCanvas
              onScoreUpdate={handleScoreUpdate}
              onGameOver={handleGameOver}
            />
          ) : (
            <div className="game-placeholder">
              <h2>ENDLESS BRICK BREAKER</h2>
              <p>Break bricks, score points, climb the leaderboard!</p>
              <ul className="rules">
                <li>Bricks regenerate - the game never ends</li>
                <li>Speed increases every 500 points</li>
                <li>Paddle shrinks every 1000 points</li>
                <li>New rows drop from above periodically</li>
                <li>Game ends when ball falls or bricks reach paddle</li>
              </ul>

              {!isLoggedIn ? (
                <p className="login-prompt">Login to play!</p>
              ) : !hasEntry ? (
                <button onClick={() => setShowBuyIn(true)} className="btn-play">
                  Buy In to Play ({tournament?.buyInSats?.toLocaleString() || '10,000'} sats)
                </button>
              ) : (
                <button onClick={startGame} className="btn-play">
                  START GAME
                </button>
              )}
            </div>
          )}

          {isPlaying && (
            <div className="score-display">
              <span>SCORE: {currentScore.toLocaleString()}</span>
            </div>
          )}
        </div>

        <aside className="sidebar right">
          <Leaderboard entries={leaderboard} currentUser={user} />
        </aside>
      </main>

      {showBuyIn && (
        <BuyInModal
          tournament={tournament}
          user={user}
          onSuccess={handleBuyInSuccess}
          onClose={() => setShowBuyIn(false)}
        />
      )}
    </div>
  )
}

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
