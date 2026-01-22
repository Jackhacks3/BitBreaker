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

  useEffect(() => {
    if (!canvasRef.current) return

    // Initialize game engine
    const game = new BrickBreaker(
      canvasRef.current,
      (score) => {
        onScoreUpdate(score)
      },
      (gameData) => {
        setGameStarted(false)
        onGameOver(gameData)
      }
    )

    gameRef.current = game

    // Start the game
    game.start()
    setGameStarted(true)

    // Cleanup on unmount
    return () => {
      if (gameRef.current) {
        gameRef.current.destroy()
      }
    }
  }, [onScoreUpdate, onGameOver])

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
