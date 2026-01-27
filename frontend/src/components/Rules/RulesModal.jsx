import React from 'react'

/**
 * RulesModal Component
 *
 * Displays game rules, controls, pricing, and payout structure.
 */
function RulesModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rules-modal">
        <button className="modal-close" onClick={onClose}>&times;</button>

        <h2 style={{ color: '#ffd700', marginBottom: '1.5rem', textAlign: 'center' }}>
          How to Play
        </h2>

        {/* Quick Overview */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 170, 0, 0.1))',
          borderRadius: '10px',
          padding: '1rem',
          marginBottom: '1.5rem',
          border: '1px solid rgba(255, 215, 0, 0.3)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '1.1rem', color: '#ffd700', fontWeight: '600' }}>
            $5 per attempt • 3 attempts daily • Top 3 win!
          </div>
        </div>

        {/* Game Controls */}
        <Section title="Controls">
          <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginBottom: '1rem' }}>
            <ControlKey label="Left" keys={['←', 'A']} />
            <ControlKey label="Right" keys={['→', 'D']} />
          </div>
          <p style={{ color: '#888', fontSize: '0.85rem', textAlign: 'center' }}>
            Move the paddle to bounce the ball and break bricks!
          </p>
        </Section>

        {/* Game Rules */}
        <Section title="Endless Mode">
          <ul style={{ color: '#ccc', fontSize: '0.9rem', paddingLeft: '1.25rem', lineHeight: '1.8' }}>
            <li>Bricks regenerate when rows are cleared</li>
            <li>Ball speed increases every 500 points</li>
            <li>Paddle shrinks every 1000 points</li>
            <li>New rows drop from above periodically</li>
            <li>Game ends when:
              <ul style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
                <li>Ball falls below the paddle</li>
                <li>Bricks reach the paddle level</li>
              </ul>
            </li>
          </ul>
        </Section>

        {/* Pricing */}
        <Section title="Attempts & Pricing">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <InfoBox label="Cost per Attempt" value="$5.00" />
            <InfoBox label="Max per Day" value="3 attempts" />
          </div>
          <p style={{ color: '#888', fontSize: '0.85rem', textAlign: 'center' }}>
            Attempts reset at midnight UTC. Your <strong>best score</strong> counts for the leaderboard.
          </p>
        </Section>

        {/* Payout Structure */}
        <Section title="Prize Structure">
          <div style={{ marginBottom: '1rem' }}>
            <PrizeRow place="1st" percent="50%" color="#ffd700" />
            <PrizeRow place="2nd" percent="30%" color="#c0c0c0" />
            <PrizeRow place="3rd" percent="20%" color="#cd7f32" />
          </div>
          <div style={{
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '5px',
            padding: '0.75rem',
            textAlign: 'center'
          }}>
            <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>
              98% of the jackpot is distributed to winners<br />
              <span style={{ fontSize: '0.75rem' }}>2% house fee</span>
            </p>
          </div>
        </Section>

        {/* Tournament Info */}
        <Section title="Daily Tournament">
          <ul style={{ color: '#ccc', fontSize: '0.9rem', paddingLeft: '1.25rem', lineHeight: '1.8' }}>
            <li>New tournament starts at <strong>00:00 UTC</strong> daily</li>
            <li>Tournament ends at <strong>23:59 UTC</strong></li>
            <li>Winners receive payouts via Lightning</li>
            <li>All entry fees go to the jackpot</li>
          </ul>
        </Section>

        {/* Wallet Info */}
        <Section title="Wallet & Payments">
          <ul style={{ color: '#ccc', fontSize: '0.9rem', paddingLeft: '1.25rem', lineHeight: '1.8' }}>
            <li>Deposit using Bitcoin Lightning Network</li>
            <li>Funds stored in your account wallet</li>
            <li>$5 deducted per game attempt</li>
            <li>Winnings credited automatically</li>
          </ul>
          <p style={{ color: '#888', fontSize: '0.75rem', textAlign: 'center', marginTop: '0.75rem' }}>
            Compatible wallets: Alby, Phoenix, Zeus, BlueWallet, Muun, and more
          </p>
        </Section>

        {/* Close Button */}
        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.75rem 2rem',
              background: 'linear-gradient(90deg, #ffd700, #ffaa00)',
              border: 'none',
              borderRadius: '5px',
              color: '#000',
              fontWeight: '600',
              fontSize: '1rem',
              cursor: 'pointer'
            }}
          >
            Got it!
          </button>
        </div>
      </div>

      <style>{`
        .rules-modal {
          max-width: 500px;
          max-height: 90vh;
          overflow-y: auto;
        }
      `}</style>
    </div>
  )
}

// Helper Components
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{
        color: '#ffd700',
        fontSize: '1rem',
        marginBottom: '0.75rem',
        borderBottom: '1px solid rgba(255, 215, 0, 0.3)',
        paddingBottom: '0.5rem'
      }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function ControlKey({ label, keys }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.5rem' }}>{label}</div>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
        {keys.map((key, i) => (
          <React.Fragment key={key}>
            <kbd style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '4px',
              padding: '0.5rem 0.75rem',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: '1rem'
            }}>
              {key}
            </kbd>
            {i < keys.length - 1 && <span style={{ color: '#666', alignSelf: 'center' }}>or</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function InfoBox({ label, value }) {
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '8px',
      padding: '1rem',
      textAlign: 'center'
    }}>
      <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ color: '#ffd700', fontSize: '1.25rem', fontWeight: '600' }}>{value}</div>
    </div>
  )
}

function PrizeRow({ place, percent, color }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0.75rem',
      background: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '5px',
      marginBottom: '0.5rem',
      borderLeft: `3px solid ${color}`
    }}>
      <span style={{ color: color, fontWeight: '600' }}>{place} Place</span>
      <span style={{ color: '#fff', fontSize: '1.1rem', fontWeight: '600' }}>{percent}</span>
    </div>
  )
}

export default RulesModal
