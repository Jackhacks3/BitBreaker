import React from 'react'

/**
 * PrizePool Component
 *
 * Displays the current tournament prize pool:
 * - Total satoshis collected
 * - Approximate USD value
 * - Number of entries
 * - Distributable amount (after 2% house fee)
 */
function PrizePool({ tournament }) {
  // Default values if tournament not loaded
  const prizePoolSats = tournament?.prizePoolSats || 0
  const entryCount = tournament?.entryCount || 0
  const buyInSats = tournament?.buyInSats || 10000

  // Calculate distributable (98% after house fee)
  const houseFee = Math.floor(prizePoolSats * 0.02)
  const distributable = prizePoolSats - houseFee

  // Approximate USD (rough estimate: 1 BTC = $100,000 = 100,000,000 sats)
  // So 1 sat ≈ $0.001
  const btcPrice = 100000 // This should come from an API in production
  const usdValue = (prizePoolSats / 100000000) * btcPrice

  // Format satoshis with commas
  const formatSats = (sats) => {
    if (sats >= 1000000) {
      return (sats / 1000000).toFixed(2) + 'M'
    }
    if (sats >= 1000) {
      return (sats / 1000).toFixed(1) + 'K'
    }
    return sats.toLocaleString()
  }

  return (
    <div className="prize-pool">
      <h3>Prize Pool</h3>

      <div className="prize-amount">
        ⚡ {formatSats(prizePoolSats)} sats
      </div>

      <div className="prize-usd">
        ≈ ${usdValue.toFixed(2)} USD
      </div>

      <div style={{
        marginTop: '1rem',
        padding: '0.75rem',
        background: 'rgba(0, 0, 0, 0.2)',
        borderRadius: '5px',
        fontSize: '0.85rem'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '0.5rem',
          color: 'rgba(255, 255, 255, 0.7)'
        }}>
          <span>Entries:</span>
          <span>{entryCount} players</span>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '0.5rem',
          color: 'rgba(255, 255, 255, 0.7)'
        }}>
          <span>Buy-in:</span>
          <span>{buyInSats.toLocaleString()} sats</span>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.5rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#1dd1a1'
        }}>
          <span>To winners:</span>
          <span>{formatSats(distributable)} sats</span>
        </div>
      </div>

      {/* Live indicator */}
      <div style={{
        marginTop: '0.75rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        fontSize: '0.75rem',
        color: 'rgba(255, 255, 255, 0.5)'
      }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: '#1dd1a1',
          animation: 'pulse 2s infinite'
        }}></span>
        Live updates
      </div>

      <style>{`
        .prize-pool {
          text-align: center;
        }

        .prize-amount {
          font-size: 1.8rem;
          font-weight: 700;
          color: #feca57;
          margin: 0.5rem 0;
          text-shadow: 0 0 20px rgba(254, 202, 87, 0.3);
        }

        .prize-usd {
          font-size: 1rem;
          color: rgba(255, 255, 255, 0.6);
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

export default PrizePool
