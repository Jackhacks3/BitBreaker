import React, { useState } from 'react'

/**
 * PlayerGuideModal Component
 *
 * Comprehensive help guide for players covering:
 * - Getting started
 * - How to deposit via Lightning
 * - How to play the game
 * - How to win prizes
 * - Frequently asked questions
 */
function PlayerGuideModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal guide-modal">
        <button className="modal-close" onClick={onClose}>&times;</button>

        <h2 style={{ color: '#ffd700', marginBottom: '1.5rem', textAlign: 'center' }}>
          Player Guide
        </h2>

        {/* Welcome Banner */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 170, 0, 0.1))',
          borderRadius: '10px',
          padding: '1rem',
          marginBottom: '1.5rem',
          border: '1px solid rgba(255, 215, 0, 0.3)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '1.1rem', color: '#ffd700', fontWeight: '600' }}>
            Welcome to Bit Breaker!
          </div>
          <div style={{ color: '#ccc', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Play, compete, and win Bitcoin prizes daily
          </div>
        </div>

        {/* Getting Started */}
        <Section title="Getting Started">
          <StepCard number={1} title="Create Account" icon="👤">
            Click "Sign Up" and choose a display name. No email required!
          </StepCard>
          <StepCard number={2} title="Deposit Funds" icon="💰">
            Open your wallet and deposit Bitcoin via Lightning Network.
          </StepCard>
          <StepCard number={3} title="Play & Win" icon="🎮">
            Click "Play" to start a game. Get the highest score to win!
          </StepCard>
        </Section>

        {/* How to Deposit */}
        <Section title="How to Deposit">
          <ol style={{ color: '#ccc', fontSize: '0.9rem', paddingLeft: '1.25rem', lineHeight: '2' }}>
            <li>Click the <strong style={{ color: '#ffd700' }}>💰 Wallet</strong> button in the footer</li>
            <li>Enter the amount you want to deposit in USD</li>
            <li>Click <strong style={{ color: '#ffd700' }}>Generate Invoice</strong></li>
            <li>Scan the QR code with any Lightning wallet</li>
            <li>Your balance updates instantly when paid!</li>
          </ol>

          <div style={{
            background: 'rgba(0, 217, 255, 0.1)',
            borderRadius: '8px',
            padding: '1rem',
            marginTop: '1rem',
            border: '1px solid rgba(0, 217, 255, 0.2)'
          }}>
            <div style={{ color: '#00d9ff', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              Compatible Lightning Wallets
            </div>
            <div style={{ color: '#ccc', fontSize: '0.85rem' }}>
              Phoenix, Muun, Strike, Cash App, BlueWallet, Wallet of Satoshi, Alby, Zeus, and any BOLT11 compatible wallet
            </div>
          </div>
        </Section>

        {/* How to Play */}
        <Section title="How to Play">
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginBottom: '1rem' }}>
              <ControlKey label="Move Left" keys={['←', 'A']} />
              <ControlKey label="Move Right" keys={['→', 'D']} />
            </div>
          </div>

          <ul style={{ color: '#ccc', fontSize: '0.9rem', paddingLeft: '1.25rem', lineHeight: '1.8' }}>
            <li><strong style={{ color: '#ffd700' }}>Objective:</strong> Break all the bricks with the ball</li>
            <li><strong style={{ color: '#ffd700' }}>Endless Mode:</strong> Bricks regenerate - play until you miss!</li>
            <li><strong style={{ color: '#ffd700' }}>Scoring:</strong> Each brick gives points, difficulty increases over time</li>
            <li><strong style={{ color: '#ffd700' }}>Cost:</strong> $5 per attempt, maximum 3 attempts per day</li>
          </ul>
        </Section>

        {/* How to Win */}
        <Section title="How to Win Prizes">
          <div style={{
            background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(192, 192, 192, 0.1))',
            borderRadius: '10px',
            padding: '1rem',
            marginBottom: '1rem'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', textAlign: 'center' }}>
              <PrizeTier place="1st" percent="50%" color="#ffd700" />
              <PrizeTier place="2nd" percent="30%" color="#c0c0c0" />
              <PrizeTier place="3rd" percent="20%" color="#cd7f32" />
            </div>
          </div>

          <ul style={{ color: '#ccc', fontSize: '0.9rem', paddingLeft: '1.25rem', lineHeight: '1.8' }}>
            <li>Tournament resets daily at <strong>midnight UTC</strong></li>
            <li>Your <strong style={{ color: '#ffd700' }}>best score</strong> of 3 attempts counts</li>
            <li>Top 3 players split 98% of the prize pool</li>
            <li>Winnings are paid automatically via Lightning</li>
          </ul>
        </Section>

        {/* FAQ Section */}
        <Section title="Frequently Asked Questions">
          <FAQItem question="What Lightning wallets work?">
            Any wallet that supports BOLT11 invoices: Phoenix, Muun, Strike, Cash App, BlueWallet, Wallet of Satoshi, Alby, Zeus, and many more.
          </FAQItem>

          <FAQItem question="When do I get paid if I win?">
            Winners are paid automatically after the tournament closes at midnight UTC. Payments are sent to your Lightning address.
          </FAQItem>

          <FAQItem question="Can I play more than 3 times per day?">
            No, each player gets exactly 3 attempts per day. Your best score counts for the leaderboard.
          </FAQItem>

          <FAQItem question="What happens to my deposit if I don't win?">
            Game fees go to the prize pool. Any unused balance stays in your wallet for future games.
          </FAQItem>

          <FAQItem question="Is my money safe?">
            Yes! We use LNbits for Lightning payments. Your funds are held securely until you play or withdraw.
          </FAQItem>

          <FAQItem question="How is the winner determined?">
            The player with the highest score at the end of the day (midnight UTC) wins 1st place. Ties are broken by who achieved the score first.
          </FAQItem>
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
        .guide-modal {
          max-width: 550px;
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

function StepCard({ number, title, icon, children }) {
  return (
    <div style={{
      display: 'flex',
      gap: '1rem',
      alignItems: 'flex-start',
      padding: '0.75rem',
      background: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '8px',
      marginBottom: '0.75rem'
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #ffd700, #ffaa00)',
        color: '#000',
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: '700',
        fontSize: '0.9rem',
        flexShrink: 0
      }}>
        {number}
      </div>
      <div>
        <div style={{ color: '#fff', fontWeight: '600', marginBottom: '0.25rem' }}>
          {icon} {title}
        </div>
        <div style={{ color: '#888', fontSize: '0.85rem' }}>
          {children}
        </div>
      </div>
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

function PrizeTier({ place, percent, color }) {
  return (
    <div>
      <div style={{ color: color, fontWeight: '700', fontSize: '1.25rem' }}>{percent}</div>
      <div style={{ color: '#888', fontSize: '0.75rem' }}>{place} Place</div>
    </div>
  )
}

function FAQItem({ question, children }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '8px',
      marginBottom: '0.5rem',
      overflow: 'hidden'
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '0.75rem 1rem',
          background: 'transparent',
          border: 'none',
          color: '#fff',
          fontSize: '0.9rem',
          fontWeight: '500',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>{question}</span>
        <span style={{
          color: '#ffd700',
          fontSize: '1.25rem',
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease'
        }}>
          +
        </span>
      </button>
      {isOpen && (
        <div style={{
          padding: '0 1rem 0.75rem 1rem',
          color: '#888',
          fontSize: '0.85rem',
          lineHeight: '1.6'
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

export default PlayerGuideModal
