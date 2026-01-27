import React, { useRef, useEffect, useState } from 'react'
import { BrickBreaker } from '../../game/BrickBreaker'

/**
 * GameCanvas - React wrapper for the BrickBreaker game engine
 *
 * This component:
 * 1. Creates and manages the canvas element
 * 2. Initializes the game engine
 * 3. Passes score updates and game over events to parent
 * 4. Records input for anti-cheat server validation
 */
function GameCanvas({ onScoreUpdate, onGameOver }) {
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const [gameStarted, setGameStarted] = useState(false)

  // Use refs for callbacks to prevent game restart on callback changes
  const onScoreUpdateRef = useRef(onScoreUpdate)
  const onGameOverRef = useRef(onGameOver)

  // Keep refs updated
  useEffect(() => {
    onScoreUpdateRef.current = onScoreUpdate
    onGameOverRef.current = onGameOver
  }, [onScoreUpdate, onGameOver])

  useEffect(() => {
    if (!canvasRef.current) return

    // Initialize game engine with ref-wrapped callbacks
    const game = new BrickBreaker(
      canvasRef.current,
      (score) => {
        onScoreUpdateRef.current(score)
      },
      (gameData) => {
        setGameStarted(false)
        onGameOverRef.current(gameData)
      }
    )

    gameRef.current = game

    // Start the game
    game.start()
    setGameStarted(true)

    // Cleanup on unmount only
    return () => {
      if (gameRef.current) {
        gameRef.current.destroy()
      }
    }
  }, []) // Empty deps - only run once on mount

  return (
    <div className="game-canvas-container">
      <canvas
        ref={canvasRef}
        style={{
          border: '3px solid #00d9ff',
          borderRadius: '10px',
          boxShadow: '0 0 30px rgba(0, 217, 255, 0.3)'
        }}
      />
      {gameStarted && (
        <div className="game-controls-hint">
          Use ← → arrow keys or A/D to move paddle
        </div>
      )}
      <style>{`
        .game-canvas-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }
        .game-controls-hint {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.5);
        }
      `}</style>
    </div>
  )
}

export default GameCanvas
