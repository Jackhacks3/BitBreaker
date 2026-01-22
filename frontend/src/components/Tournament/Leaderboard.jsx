import React from 'react'

/**
 * Leaderboard Component
 *
 * Displays current tournament rankings:
 * - Rank position
 * - Player display name
 * - Best score
 * - Highlights top 3 (prize winners)
 * - Highlights current user
 */
function Leaderboard({ entries = [], currentUser }) {
  // Sort by best score (descending)
  const sortedEntries = [...entries].sort((a, b) => b.bestScore - a.bestScore)

  return (
    <div className="leaderboard">
      <h3>Leaderboard</h3>

      {sortedEntries.length === 0 ? (
        <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '2rem 0' }}>
          No players yet. Be the first!
        </p>
      ) : (
        <ul className="leaderboard-list">
          {sortedEntries.map((entry, index) => {
            const rank = index + 1
            const isCurrentUser = currentUser && entry.userId === currentUser.id
            const isTopThree = rank <= 3

            return (
              <li
                key={entry.userId}
                className={`leaderboard-entry ${isCurrentUser ? 'current-user' : ''} ${isTopThree ? `place-${rank}` : ''}`}
              >
                <span className={`entry-rank ${isTopThree ? 'top-3' : ''}`}>
                  {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
                </span>
                <span className="entry-name" title={entry.displayName}>
                  {entry.displayName}
                  {isCurrentUser && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>(you)</span>}
                </span>
                <span className="entry-score">
                  {entry.bestScore.toLocaleString()}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {/* Prize indicators for top 3 */}
      {sortedEntries.length >= 3 && (
        <div style={{
          marginTop: '1rem',
          paddingTop: '1rem',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          fontSize: '0.8rem',
          color: 'rgba(255,255,255,0.5)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <span>🥇 1st wins 50%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <span>🥈 2nd wins 30%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>🥉 3rd wins 20%</span>
          </div>
        </div>
      )}

      <style>{`
        .leaderboard {
          max-height: 500px;
          overflow-y: auto;
        }

        .leaderboard-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .leaderboard-entry {
          display: flex;
          align-items: center;
          padding: 0.6rem 0.5rem;
          border-radius: 5px;
          margin-bottom: 0.25rem;
          background: rgba(255, 255, 255, 0.03);
          transition: background 0.2s;
        }

        .leaderboard-entry:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .leaderboard-entry.current-user {
          background: rgba(0, 217, 255, 0.15);
          border: 1px solid rgba(0, 217, 255, 0.3);
        }

        .leaderboard-entry.place-1 {
          background: linear-gradient(90deg, rgba(255, 215, 0, 0.15), transparent);
        }

        .leaderboard-entry.place-2 {
          background: linear-gradient(90deg, rgba(192, 192, 192, 0.15), transparent);
        }

        .leaderboard-entry.place-3 {
          background: linear-gradient(90deg, rgba(205, 127, 50, 0.15), transparent);
        }

        .entry-rank {
          width: 32px;
          text-align: center;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.5);
        }

        .entry-rank.top-3 {
          font-size: 1.1rem;
        }

        .entry-name {
          flex: 1;
          margin-left: 0.5rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 0.95rem;
        }

        .entry-score {
          font-family: monospace;
          font-weight: 600;
          color: #00d9ff;
          font-size: 0.95rem;
        }
      `}</style>
    </div>
  )
}

export default Leaderboard
