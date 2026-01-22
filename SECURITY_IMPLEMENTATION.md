# Security Implementation Guide

This document provides code examples for implementing the critical security fixes identified in SECURITY_PLAN.md.

---

## 1. Webhook Signature Verification (CRITICAL)

**File**: `backend/src/routes/payments.js`

```javascript
import crypto from 'crypto';

/**
 * Verify LNbits webhook signature
 * CRITICAL: Without this, anyone can fake payment confirmations
 */
function verifyWebhookSignature(req) {
  const signature = req.headers['x-lnbits-signature'] ||
                    req.headers['x-webhook-signature'];

  if (!signature) {
    console.error('Webhook missing signature header');
    return false;
  }

  const webhookSecret = process.env.LNBITS_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('LNBITS_WEBHOOK_SECRET not configured');
    return false;
  }

  const payload = JSON.stringify(req.body);
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch (e) {
    return false;
  }
}

// Updated webhook handler
router.post('/webhook', async (req, res, next) => {
  // FIRST: Verify signature
  if (!verifyWebhookSignature(req)) {
    console.error('Invalid webhook signature - possible attack');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Proceed with payment processing...
});
```

---

## 2. Redis Token Storage (CRITICAL)

**File**: `backend/src/services/sessionStore.js`

```javascript
import Redis from 'ioredis';
import crypto from 'crypto';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds
const SESSION_PREFIX = 'session:';

/**
 * Create a new session token
 */
export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const sessionData = {
    userId,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };

  await redis.setex(
    `${SESSION_PREFIX}${token}`,
    SESSION_TTL,
    JSON.stringify(sessionData)
  );

  return token;
}

/**
 * Validate and retrieve session
 */
export async function getSession(token) {
  if (!token || typeof token !== 'string' || token.length !== 64) {
    return null;
  }

  const data = await redis.get(`${SESSION_PREFIX}${token}`);
  if (!data) return null;

  const session = JSON.parse(data);

  // Update last activity (sliding expiration)
  session.lastActivity = Date.now();
  await redis.setex(
    `${SESSION_PREFIX}${token}`,
    SESSION_TTL,
    JSON.stringify(session)
  );

  return session;
}

/**
 * Invalidate session
 */
export async function destroySession(token) {
  await redis.del(`${SESSION_PREFIX}${token}`);
}

/**
 * Auth middleware using Redis sessions
 */
export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const session = await getSession(token);

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.userId = session.userId;
  req.sessionToken = token;
  next();
}
```

---

## 3. CSRF Protection

**File**: `backend/src/middleware/csrf.js`

```javascript
import crypto from 'crypto';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'csrf-token';

/**
 * Generate CSRF token for session
 */
export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF protection middleware
 * Skip for GET, HEAD, OPTIONS (safe methods)
 * Skip for webhook endpoints (use signature verification instead)
 */
export function csrfProtection(req, res, next) {
  // Safe methods don't need CSRF protection
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Webhook endpoints use signature verification
  if (req.path.includes('/webhook')) {
    return next();
  }

  const tokenFromHeader = req.headers[CSRF_HEADER];
  const tokenFromCookie = req.cookies[CSRF_COOKIE];

  if (!tokenFromHeader || !tokenFromCookie) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  // Timing-safe comparison
  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(tokenFromHeader),
      Buffer.from(tokenFromCookie)
    );

    if (!valid) {
      return res.status(403).json({ error: 'CSRF token invalid' });
    }
  } catch (e) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }

  next();
}
```

---

## 4. Input Sanitization (XSS Prevention)

**File**: `backend/src/utils/sanitize.js`

```javascript
import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize user-provided display name
 * Prevents XSS attacks when displaying in leaderboard
 */
export function sanitizeDisplayName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }

  // Remove HTML/JS
  let clean = DOMPurify.sanitize(name, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: []
  });

  // Remove any remaining dangerous characters
  clean = clean
    .replace(/[<>'"&]/g, '')    // Remove HTML-significant chars
    .replace(/[\x00-\x1F]/g, '') // Remove control characters
    .trim();

  // Enforce length limits
  if (clean.length < 2) return '';
  if (clean.length > 20) clean = clean.substring(0, 20);

  return clean;
}

/**
 * Sanitize Lightning address
 */
export function sanitizeLightningAddress(address) {
  if (!address || typeof address !== 'string') {
    return null;
  }

  const clean = address.trim().toLowerCase();

  // Strict validation - only allow valid Lightning address format
  const lnAddressRegex = /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

  if (!lnAddressRegex.test(clean)) {
    return null;
  }

  // Additional checks
  if (clean.length > 100) return null;
  if (clean.includes('..')) return null;
  if (clean.includes('--')) return null;

  return clean;
}
```

---

## 5. Enhanced Anti-Cheat: Input Recording (Client-Side)

**File**: `frontend/src/game/InputRecorder.js`

```javascript
/**
 * Records all player inputs for server-side replay verification
 */
export class InputRecorder {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.inputs = [];
    this.startTime = null;
    this.frameCount = 0;
  }

  start() {
    this.startTime = performance.now();
    this.inputs = [];
    this.frameCount = 0;
  }

  recordInput(type, value) {
    if (!this.startTime) return;

    this.inputs.push({
      t: Math.round(performance.now() - this.startTime), // timestamp (ms)
      type,  // 'left', 'right', 'release'
      v: value
    });
  }

  recordFrame() {
    this.frameCount++;
  }

  getGameData(finalScore, level) {
    const duration = Math.round(performance.now() - this.startTime);

    return {
      sessionId: this.sessionId,
      score: finalScore,
      level,
      duration,
      frameCount: this.frameCount,
      inputLog: this.inputs,
      // Include hash for quick integrity check
      inputHash: this.computeInputHash()
    };
  }

  computeInputHash() {
    // Simple hash for integrity (full verification happens server-side)
    const str = JSON.stringify(this.inputs);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}
```

---

## 6. Enhanced Anti-Cheat: Server Validation

**File**: `backend/src/services/antiCheat.js`

```javascript
/**
 * Server-side anti-cheat validation
 */

// Game physics constants (must match client)
const GAME_CONFIG = {
  PADDLE_SPEED: 20,
  BALL_SPEED_INITIAL: 5,
  POINTS_PER_BRICK: 5,
  FRAME_TIME_MS: 16.67, // 60 FPS
  MAX_HUMAN_INPUTS_PER_SECOND: 30,
  MIN_HUMAN_REACTION_MS: 50
};

/**
 * Validate submitted score against game mechanics
 */
export function validateGameSubmission(data) {
  const errors = [];
  const warnings = [];

  const { score, level, duration, frameCount, inputLog } = data;

  // 1. Basic sanity checks
  if (score < 0 || score > 1000000) {
    errors.push('Invalid score range');
  }

  if (duration < 5000) {
    errors.push('Game too short');
  }

  // 2. Score rate validation
  const scorePerSecond = score / (duration / 1000);
  if (scorePerSecond > 50) {
    errors.push(`Score rate too high: ${scorePerSecond.toFixed(1)}/sec`);
  }

  // 3. Frame count validation (detect speedhacks)
  const expectedFrames = (duration / GAME_CONFIG.FRAME_TIME_MS);
  const frameDeviation = Math.abs(frameCount - expectedFrames) / expectedFrames;

  if (frameDeviation > 0.15) {
    errors.push(`Frame count deviation: ${(frameDeviation * 100).toFixed(1)}%`);
  }

  // 4. Input analysis
  if (inputLog && inputLog.length > 0) {
    const inputAnalysis = analyzeInputs(inputLog, duration);

    if (inputAnalysis.superhuman) {
      errors.push('Superhuman input speed detected');
    }

    if (inputAnalysis.tooRegular) {
      warnings.push('Suspiciously regular input timing');
    }

    if (inputAnalysis.noVariance) {
      warnings.push('No human variance in inputs');
    }
  }

  // 5. Score vs level correlation
  const avgScorePerLevel = score / level;
  if (avgScorePerLevel > 500) {
    warnings.push(`High score per level: ${avgScorePerLevel.toFixed(0)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    confidence: calculateConfidence(errors, warnings)
  };
}

/**
 * Analyze input patterns for bot detection
 */
function analyzeInputs(inputs, duration) {
  if (inputs.length < 10) {
    return { valid: true };
  }

  // Calculate time between inputs
  const intervals = [];
  for (let i = 1; i < inputs.length; i++) {
    intervals.push(inputs[i].t - inputs[i - 1].t);
  }

  // Check for superhuman speed
  const minInterval = Math.min(...intervals);
  const superhuman = minInterval < GAME_CONFIG.MIN_HUMAN_REACTION_MS;

  // Check for too-regular patterns (bots often have constant intervals)
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / avgInterval;

  // Humans typically have CV > 0.3, bots are more regular
  const tooRegular = coefficientOfVariation < 0.1;
  const noVariance = stdDev < 5;

  // Check input rate
  const inputsPerSecond = inputs.length / (duration / 1000);
  const tooFast = inputsPerSecond > GAME_CONFIG.MAX_HUMAN_INPUTS_PER_SECOND;

  return {
    superhuman: superhuman || tooFast,
    tooRegular,
    noVariance,
    stats: {
      minInterval,
      avgInterval,
      stdDev,
      coefficientOfVariation,
      inputsPerSecond
    }
  };
}

/**
 * Calculate confidence score (0-100)
 */
function calculateConfidence(errors, warnings) {
  let confidence = 100;

  // Each error significantly reduces confidence
  confidence -= errors.length * 30;

  // Each warning slightly reduces confidence
  confidence -= warnings.length * 10;

  return Math.max(0, Math.min(100, confidence));
}
```

---

## 7. Secure Error Handling

**File**: `backend/src/middleware/errorHandler.js`

```javascript
/**
 * Secure error handler - prevents information leakage
 */
export function secureErrorHandler(err, req, res, next) {
  // Log full error internally
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.userId,
    timestamp: new Date().toISOString()
  });

  // Determine what to show user
  const isDev = process.env.NODE_ENV === 'development';

  // Known operational errors - safe to expose message
  const operationalErrors = [
    'Invalid score',
    'No active tournament',
    'Tournament is closed',
    'You already have an entry',
    'No tournament entry found',
    'Invalid Lightning address format',
    'Display name must be 2-20 characters'
  ];

  const isOperational = operationalErrors.some(e =>
    err.message?.includes(e)
  );

  if (isOperational) {
    return res.status(err.status || 400).json({
      error: err.message
    });
  }

  // Unknown errors - hide details in production
  if (isDev) {
    res.status(err.status || 500).json({
      error: err.message,
      stack: err.stack
    });
  } else {
    // Generic message - don't leak internal details
    res.status(500).json({
      error: 'An unexpected error occurred. Please try again.'
    });
  }
}
```

---

## 8. Security Headers Configuration

**File**: `backend/src/middleware/securityHeaders.js`

```javascript
import helmet from 'helmet';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // For styled-components
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.LNBITS_URL],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: "same-origin" },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true
});
```

---

## 9. Rate Limiting Configuration

**File**: `backend/src/middleware/rateLimiter.js`

```javascript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Create rate limiter with Redis store (survives restarts)
function createLimiter(options) {
  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args) => redis.call(...args)
    }),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
    ...options
  });
}

// Global limiter
export const globalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});

// Strict limiter for auth endpoints
export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again in 15 minutes' }
});

// Payment endpoints
export const paymentLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: { error: 'Too many payment requests, please wait' }
});

// Game submission
export const gameLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many game submissions' }
});
```

---

## 10. Environment Variables Template

**File**: `backend/.env.example` (updated)

```env
# Server
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/brickbreaker

# Redis (REQUIRED for production)
REDIS_URL=redis://localhost:6379

# Lightning Payments
LNBITS_URL=https://legend.lnbits.com
LNBITS_API_KEY=your_invoice_key_here
LNBITS_ADMIN_KEY=your_admin_key_here
LNBITS_WEBHOOK_SECRET=generate_random_64_char_hex

# Tournament Config
BUY_IN_SATS=10000

# Security
JWT_SECRET=generate_random_64_char_hex
CSRF_SECRET=generate_random_32_char_hex

# To generate secrets:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Deployment Checklist

Before deploying to production:

```bash
# 1. Generate all secrets
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('LNBITS_WEBHOOK_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"

# 2. Verify no secrets in code
grep -r "LNBITS_ADMIN_KEY" --include="*.js" .

# 3. Check for console.log (remove in production)
grep -r "console.log" --include="*.js" src/

# 4. Run security audit
npm audit

# 5. Test rate limiting
for i in {1..20}; do curl -s http://localhost:4000/api/health; done

# 6. Verify HTTPS
curl -I https://your-domain.com
```

---

*This implementation guide accompanies SECURITY_PLAN.md*
