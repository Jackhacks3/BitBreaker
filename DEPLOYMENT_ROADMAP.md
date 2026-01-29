# BitBreaker Deployment Roadmap
## Branch: production-deployment-fixes

**Evaluation Date:** January 28, 2026
**Target Platforms:** Render (Backend) + Vercel (Frontend)
**Status:** NEARLY READY - Minor fixes required

---

## Executive Summary

The `production-deployment-fixes` branch is well-structured for deployment with comprehensive security measures, proper error handling, and production-ready architecture. However, there are **7 issues** that should be addressed before deployment.

| Category | Status |
|----------|--------|
| Backend Code | ✅ Ready |
| Frontend Code | ✅ Ready |
| Security | ✅ Production-ready |
| Error Handling | ✅ Comprehensive |
| Database | ⚠️ Minor config needed |
| Dependencies | ⚠️ Vulnerabilities to fix |
| Environment Config | ⚠️ Manual setup required |

---

## Required Environment Variables

### Backend (Render)

```env
# REQUIRED - Server will NOT start without these in production
NODE_ENV=production
PORT=4000
DATABASE_URL=<your-neon-connection-string>?sslmode=require
REDIS_URL=<your-upstash-redis-url>
LNBITS_URL=https://legend.lnbits.com
LNBITS_API_KEY=<your-invoice-key>
LNBITS_ADMIN_KEY=<your-admin-key>
LNBITS_WEBHOOK_SECRET=<generate-with-openssl-rand-hex-32>

# REQUIRED - CORS
FRONTEND_URL=https://your-vercel-domain.vercel.app

# OPTIONAL - Pricing
ATTEMPT_COST_USD=5.00
BTC_FALLBACK_PRICE=100000

# OPTIONAL - Database Pool
DB_POOL_MAX=20
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECT_TIMEOUT_MS=2000

# OPTIONAL - Admin bootstrap (one-time use)
ADMIN_BOOTSTRAP_SECRET=<generate-with-openssl-rand-hex-32>
```

### Frontend (Vercel)

```env
# Set in Vercel project settings
VITE_API_URL=https://brick-breaker-api.onrender.com
```

---

## Pre-Deployment Checklist

### 1. Fix Dependency Vulnerabilities (PRIORITY: HIGH)

```bash
cd backend
npm audit fix
npm update
```

**Current vulnerabilities found:**
- `qs` (high) - DoS via memory exhaustion
- `@modelcontextprotocol/sdk` (high) - DNS rebinding + ReDoS
- `body-parser` (moderate) - DoS with URL encoding
- `undici` (moderate) - Decompression chain DoS
- `js-yaml` (moderate) - Prototype pollution
- `diff` (low) - Parsepatch DoS

### 2. Update Vercel API Rewrite (PRIORITY: HIGH)

The `frontend/vercel.json` has a hardcoded URL that must match your Render backend:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://YOUR-RENDER-SERVICE-NAME.onrender.com/api/:path*"
    }
  ]
}
```

**Action:** Update `brick-breaker-api.onrender.com` to your actual Render service URL.

### 3. Update PostgreSQL SSL Mode (PRIORITY: MEDIUM)

The current `DATABASE_URL` uses `sslmode=require` which triggers a deprecation warning. For Neon PostgreSQL:

```env
# Recommended format
DATABASE_URL=postgresql://user:pass@host/db?sslmode=verify-full

# Or for libpq compatibility
DATABASE_URL=postgresql://user:pass@host/db?uselibpqcompat=true&sslmode=require
```

### 4. Setup Redis (PRIORITY: CRITICAL)

Production **requires** Redis for:
- Session persistence (survives restarts)
- Cache storage (invoice tracking, webhook idempotency)

**Recommended:** [Upstash Redis](https://upstash.com/) - Free tier available

```env
REDIS_URL=rediss://default:your-password@your-instance.upstash.io:6379
```

### 5. Configure LNbits Webhook (PRIORITY: CRITICAL)

After deploying the backend, configure your LNbits wallet webhook:

1. Go to your LNbits wallet settings
2. Add webhook URL: `https://your-backend.onrender.com/api/payments/webhook`
3. Set the same secret as `LNBITS_WEBHOOK_SECRET`

### 6. Update CORS Origin (PRIORITY: HIGH)

In Render environment variables, set:
```env
FRONTEND_URL=https://your-vercel-app.vercel.app
```

### 7. Run Database Migrations (PRIORITY: LOW)

The schema is auto-created in `database.js`, but you may want to apply migrations for:
- Wallet system (`002_wallets.sql`)
- Attempt tracking (`003_one_attempt.sql`)

Note: These add indexes and views for optimization - the base schema works without them.

---

## Deployment Steps

### Step 1: Deploy Backend to Render

1. Connect GitHub repo to Render
2. Create new **Web Service**
3. Configure:
   - **Build Command:** `cd backend && npm install`
   - **Start Command:** `cd backend && npm start`
   - **Health Check Path:** `/api/health`
4. Add all environment variables (see above)
5. Deploy

### Step 2: Deploy Frontend to Vercel

1. Connect GitHub repo to Vercel
2. Configure:
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Add environment variables if needed
4. Update `vercel.json` with correct backend URL
5. Deploy

### Step 3: Post-Deployment Verification

```bash
# Test backend health
curl https://your-backend.onrender.com/api/health

# Expected response:
# {"status":"ok","timestamp":"...","uptime":...,"sessionStore":"redis"}

# Test CORS
curl -I -X OPTIONS https://your-backend.onrender.com/api/tournaments/current \
  -H "Origin: https://your-frontend.vercel.app"
```

---

## Potential Issues & Mitigations

### Issue 1: Cold Starts on Render Free Tier
**Risk:** First request after inactivity takes 30+ seconds
**Mitigation:**
- Use Render's always-on paid tier, OR
- Set up an external ping service (UptimeRobot, etc.)

### Issue 2: CoinGecko Rate Limits
**Risk:** Price API calls may be rate limited
**Mitigation:**
- Price is cached for 5 minutes
- Fallback to `BTC_FALLBACK_PRICE` env var
- Monitoring logs for fallback usage alerts

### Issue 3: Lightning Network Reliability
**Risk:** LNbits may be temporarily unavailable
**Mitigation:**
- 10-second API timeout prevents hanging requests
- Payout retry job runs every 30 minutes
- Alerting for persistent payout failures

### Issue 4: Webhook Delivery
**Risk:** Render may not receive webhooks during cold starts
**Mitigation:**
- Payment status polling (`GET /api/payments/status/:hash`)
- Payments are confirmed via polling if webhook missed

### Issue 5: Database Connection Pool
**Risk:** Pool exhaustion under load
**Mitigation:**
- Configurable pool size via `DB_POOL_MAX`
- 30-second idle timeout releases connections
- Health endpoint can be extended to show pool status

---

## Security Verification

All security measures are in place:

| Check | Status |
|-------|--------|
| Webhook signature verification | ✅ Required in production |
| CSRF protection | ✅ Double-submit cookie |
| Rate limiting | ✅ Global + per-endpoint |
| SQL injection prevention | ✅ Parameterized queries |
| XSS prevention | ✅ Input sanitization |
| Secure headers (Helmet) | ✅ CSP, HSTS enabled |
| Session security | ✅ Crypto-random tokens |
| Error message sanitization | ✅ No internal info leak |
| Graceful shutdown | ✅ Cleans up resources |

---

## Monitoring Recommendations

### Logs to Watch

```
[SECURITY]     - Auth failures, rate limits, suspicious activity
[PAYMENT]      - Invoice creation, payment confirmations
[PAYOUT]       - Winner payouts (success/failure)
[PAYOUT-ALERT] - Multiple payout failures (critical)
[PRICE]        - BTC rate updates, fallback usage
[CRON]         - Tournament creation/closing
```

### Key Metrics

- Response time on `/api/health`
- Payment success rate
- Payout success rate
- Active sessions count
- Database connection pool usage

---

## Files Modified in This Branch

| File | Changes |
|------|---------|
| `backend/src/routes/game.js` | Added error codes, fixed wallet debit type |
| `backend/src/services/lightning.js` | API timeout protection |
| `backend/src/services/priceService.js` | Price bounds validation |
| `backend/src/services/tournamentEngine.js` | Payout failure alerting |
| `frontend/src/App.css` | UI improvements |
| `frontend/src/components/Rules/RulesModal.jsx` | Rules content updates |

---

## Quick Reference Commands

```bash
# Generate secrets
openssl rand -hex 32

# Test backend locally
cd backend && npm run dev

# Build frontend locally
cd frontend && npm run build

# Check for vulnerabilities
cd backend && npm audit

# View git changes
git diff --stat
```

---

## Final Verdict

**DEPLOYMENT READY** with the following mandatory pre-deployment tasks:

1. ⚠️ **Fix npm vulnerabilities** (`npm audit fix`)
2. ⚠️ **Update vercel.json** with correct backend URL
3. ⚠️ **Setup Redis** (Upstash recommended)
4. ⚠️ **Configure environment variables** on Render/Vercel
5. ⚠️ **Configure LNbits webhook** after backend deployment

**Estimated Time to Deploy:** 30-60 minutes

---

*Generated by Claude Code - January 28, 2026*
