/**
 * Bitcoin Price Service for BITBRICK
 *
 * Fetches BTC/USD rates from CoinGecko API
 * Caches rates for 5 minutes to reduce API calls
 * Provides USD to sats conversion
 */

// In-memory cache
let cachedRate = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// CoinGecko API (free, no key required)
const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';

// Fallback rate if API fails
// Can be overridden via environment variable for production
// Update this periodically or set BTC_FALLBACK_PRICE env var
const FALLBACK_BTC_USD = parseInt(process.env.BTC_FALLBACK_PRICE) || 100000;

// Price bounds validation - reject prices outside reasonable range
const MIN_BTC_PRICE = 10000;    // $10,000 minimum (safety floor)
const MAX_BTC_PRICE = 500000;   // $500,000 maximum (safety ceiling)

// Track fallback usage for alerting
let fallbackUsageCount = 0;
const MAX_FALLBACK_WARNINGS = 5;

/**
 * Fetch current BTC/USD rate from CoinGecko
 * @returns {Promise<{btcUsd: number, satsPerUsd: number, cached: boolean}>}
 */
export async function getBtcRate() {
  const now = Date.now();

  // Return cached rate if still valid
  if (cachedRate && now < cacheExpiry) {
    return { ...cachedRate, cached: true };
  }

  try {
    const response = await fetch(COINGECKO_API, {
      headers: {
        'Accept': 'application/json'
      },
      timeout: 5000
    });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    const btcUsd = data.bitcoin?.usd;

    if (!btcUsd || btcUsd <= 0) {
      throw new Error('Invalid price data from CoinGecko');
    }

    // Price bounds validation - reject unreasonable prices
    if (btcUsd < MIN_BTC_PRICE || btcUsd > MAX_BTC_PRICE) {
      console.error(`[PRICE] BTC price out of bounds: $${btcUsd} (valid range: $${MIN_BTC_PRICE}-$${MAX_BTC_PRICE})`);
      throw new Error(`BTC price out of bounds: $${btcUsd}`);
    }

    // Calculate sats per USD: 100,000,000 sats / BTC price
    const satsPerUsd = Math.round(100_000_000 / btcUsd);

    cachedRate = {
      btcUsd,
      satsPerUsd,
      fetchedAt: new Date().toISOString()
    };
    cacheExpiry = now + CACHE_TTL_MS;

    console.log(`[PRICE] BTC rate updated: $${btcUsd.toFixed(2)} (${satsPerUsd} sats/USD)`);

    return { ...cachedRate, cached: false };
  } catch (error) {
    console.error('[PRICE] Failed to fetch BTC rate:', error.message);

    // Return cached rate even if expired (better than failing)
    if (cachedRate) {
      console.warn('[PRICE] Using stale cached rate');
      return { ...cachedRate, cached: true, stale: true };
    }

    // Use fallback rate with alerting
    fallbackUsageCount++;
    if (fallbackUsageCount <= MAX_FALLBACK_WARNINGS) {
      console.warn(`[PRICE] Using fallback rate: $${FALLBACK_BTC_USD} (warning ${fallbackUsageCount}/${MAX_FALLBACK_WARNINGS})`);
      if (fallbackUsageCount === MAX_FALLBACK_WARNINGS) {
        console.error('[PRICE] ALERT: Price API consistently failing, check CoinGecko status or set BTC_FALLBACK_PRICE env var');
      }
    }

    const satsPerUsd = Math.round(100_000_000 / FALLBACK_BTC_USD);
    return {
      btcUsd: FALLBACK_BTC_USD,
      satsPerUsd,
      cached: false,
      fallback: true,
      fallbackCount: fallbackUsageCount
    };
  }
}

/**
 * Convert USD to sats at current rate
 * @param {number} usd - USD amount
 * @returns {Promise<{sats: number, rate: object}>}
 */
export async function usdToSats(usd) {
  const rate = await getBtcRate();
  const sats = Math.round(usd * rate.satsPerUsd);
  return { sats, rate };
}

/**
 * Convert sats to USD at current rate
 * @param {number} sats - Sats amount
 * @returns {Promise<{usd: number, rate: object}>}
 */
export async function satsToUsd(sats) {
  const rate = await getBtcRate();
  const usd = sats / rate.satsPerUsd;
  return { usd: Math.round(usd * 100) / 100, rate };
}

/**
 * Get the buy-in amount in sats
 * Uses ATTEMPT_COST_USD env var, defaults to $0.01 for testing
 * @returns {Promise<{sats: number, usd: number, rate: object}>}
 */
export async function getBuyInSats() {
  const BUY_IN_USD = parseFloat(process.env.ATTEMPT_COST_USD) || 0.01;
  const { sats, rate } = await usdToSats(BUY_IN_USD);
  return { sats, usd: BUY_IN_USD, rate };
}

/**
 * Format sats for display (e.g., "10,000 sats" or "0.0001 BTC")
 * @param {number} sats
 * @param {boolean} showBtc - Show BTC equivalent
 * @returns {string}
 */
export function formatSats(sats, showBtc = false) {
  const formatted = sats.toLocaleString();
  if (showBtc && sats >= 100000) {
    const btc = sats / 100_000_000;
    return `${formatted} sats (${btc.toFixed(8)} BTC)`;
  }
  return `${formatted} sats`;
}

export default {
  getBtcRate,
  usdToSats,
  satsToUsd,
  getBuyInSats,
  formatSats
};
