# Deployment Diagnosis Report

## Executive Summary

The Brick Breaker application was working in containerized mode but is failing in the Vercel + Render production deployment. After analyzing the codebase, I've identified **5 critical issues** that are likely causing the login flow and deposit system to fail.

---

## Critical Issues Identified

### Issue #1: Missing DATABASE_URL on Render (CRITICAL)

**Problem:** The `render.env` file contains individual PostgreSQL variables (`PGHOST`, `PGDATABASE`, etc.) but **does NOT contain `DATABASE_URL`**.

The database service in `backend/src/services/database.js:29` checks for:
```javascript
if (!process.env.DATABASE_URL || process.env.USE_MOCK_DB === 'true') {
  return false  // Falls back to mock in-memory database
}
```

**Impact:**
- Backend is using **in-memory mock database** instead of Neon PostgreSQL
- All user registrations and logins are lost on every restart/deploy
- No data persistence whatsoever

**Solution:** Add to Render environment variables:
```
DATABASE_URL=postgresql://neondb_owner:npg_87sauHxUcTnr@ep-floral-bonus-ahnsyf45-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

---

### Issue #2: CORS Blocking Frontend Requests (CRITICAL)

**Problem:** The CORS configuration in `backend/src/index.js:69-73` allows:
```javascript
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:5173'
]
```

If `FRONTEND_URL` is not set correctly on Render, CORS will block all requests from `https://bit-breaker-psi.vercel.app`.

**Current render.env:** `FRONTEND_URL=https://bit-breaker-psi.vercel.app` (correct)

**Verification Required:** Ensure this is actually set in **Render Dashboard > Environment Variables**, not just in the local file.

**Impact:**
- All API requests from Vercel frontend blocked
- Login returns network error
- Deposit system fails silently

---

### Issue #3: Session Storage Without Redis (HIGH)

**Problem:** `render.env` has no `REDIS_URL` configured.

The session store in `backend/src/services/sessionStore.js` falls back to in-memory storage when Redis is unavailable.

**Impact:**
- User sessions are lost every time Render restarts/redeploys
- Users get logged out unexpectedly
- Login appears to work but subsequent requests fail

**Solution:** Either:
1. Add Render Redis add-on or Upstash Redis
2. Or accept that sessions will be lost on restart (add warning to users)

---

### Issue #4: LNbits Demo Server (MEDIUM)

**Problem:** `render.env` uses:
```
LNBITS_URL=https://demo.lnbits.com
```

The LNbits demo server has:
- Rate limits
- No uptime guarantees
- May delete wallets/invoices without notice

**Impact:**
- Deposit invoices may fail to generate
- Payment verification may be unreliable
- Demo server may throttle requests

---

### Issue #5: render.yaml vs render.env Conflict (MEDIUM)

**Problem:** `render.yaml` specifies:
```yaml
- key: DATABASE_URL
  fromDatabase:
    name: brick-breaker-db
    property: connectionString
```

This creates a Render-managed PostgreSQL database, but `render.env` has Neon credentials.

**Impact:**
- If using Blueprint deployment, it creates a different database than intended
- Confusion about which database is actually being used

---

## Diagnostic Steps

### Step 1: Verify Render Environment Variables

Go to Render Dashboard > Your Service > Environment and verify these are set:

| Variable | Required Value |
|----------|---------------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://neondb_owner:npg_87sauHxUcTnr@ep-floral-bonus-ahnsyf45-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require` |
| `FRONTEND_URL` | `https://bit-breaker-psi.vercel.app` |
| `LNBITS_URL` | `https://demo.lnbits.com` |
| `LNBITS_API_KEY` | `38ef31f4a6dd47ad8b713ba89645aa21` |
| `LNBITS_ADMIN_KEY` | `d3422d9c267744eaae36ba2e9ae151ee` |
| `LNBITS_WEBHOOK_SECRET` | `3f2ff8c0cbf153df18f8948c184979ef8b5156fea9864cdf970e291d98c86ddb` |

### Step 2: Check Render Logs

```bash
# Look for these messages in Render logs:
"Using PostgreSQL database"          # GOOD - DB connected
"Using in-memory mock database"      # BAD - No DATABASE_URL
"[CORS] Blocked request from origin" # BAD - CORS misconfigured
```

### Step 3: Test API Health

```bash
curl https://bitbreaker.onrender.com/api/health
```

Expected response shows which storage is being used:
```json
{
  "status": "ok",
  "sessionStore": "redis"  // or "memory" if no Redis
}
```

### Step 4: Test CORS

Open browser console on https://bit-breaker-psi.vercel.app and check for:
- `Access-Control-Allow-Origin` errors
- Failed preflight requests

---

## Recommended Fixes

### Immediate Fixes (Apply Now)

1. **Add DATABASE_URL to Render environment variables:**
   ```
   DATABASE_URL=postgresql://neondb_owner:npg_87sauHxUcTnr@ep-floral-bonus-ahnsyf45-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

2. **Verify FRONTEND_URL is set on Render:**
   ```
   FRONTEND_URL=https://bit-breaker-psi.vercel.app
   ```

3. **Redeploy the Render service** after adding environment variables

### Short-term Fixes

4. **Add Redis for session persistence:**
   - Option A: Render Redis add-on ($7/month)
   - Option B: Upstash Redis (free tier available)
   - Add `REDIS_URL` to environment variables

### Long-term Fixes

5. **Replace LNbits demo with production instance:**
   - Self-host LNbits, or
   - Use a commercial Lightning provider

6. **Remove render.yaml Blueprint conflicts** if not using Render-managed database

---

## Configuration Files Comparison

| Setting | render.env | Render Dashboard (verify) | Required |
|---------|------------|---------------------------|----------|
| DATABASE_URL | **MISSING** | ? | YES |
| NODE_ENV | production | ? | YES |
| FRONTEND_URL | https://bit-breaker-psi.vercel.app | ? | YES |
| REDIS_URL | MISSING | ? | Recommended |
| LNBITS_URL | https://demo.lnbits.com | ? | YES |
| LNBITS_API_KEY | Set | ? | YES |
| LNBITS_ADMIN_KEY | Set | ? | YES |
| LNBITS_WEBHOOK_SECRET | Set | ? | YES |

---

## Why It Worked in Docker

The containerized deployment uses:
1. `docker-compose.yml` which sets `DATABASE_URL` pointing to local PostgreSQL container
2. Internal Docker networking (`http://api:4000`) for API calls
3. Nginx proxy for frontend-to-backend communication
4. Redis container for session storage

None of these exist in the Vercel + Render deployment, hence the failures.

---

## Next Steps

1. [ ] Set `DATABASE_URL` in Render dashboard
2. [ ] Verify `FRONTEND_URL` in Render dashboard
3. [ ] Redeploy Render service
4. [ ] Test login flow
5. [ ] Test deposit flow
6. [ ] Check Render logs for errors
7. [ ] Consider adding Redis for session persistence
