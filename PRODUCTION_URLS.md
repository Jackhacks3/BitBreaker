# Production URLs – Test vs Production

This document lists **demo/test** URLs in the project and what must be replaced for production.

---

## Demo / test URLs (must not be used in production)

### 1. LNbits (Lightning payments)

| Variable | Current (demo) | Production action |
|----------|----------------|-------------------|
| `LNBITS_URL` | `https://demo.lnbits.com` | **Replace** with your production LNbits URL (e.g. your own LNbits instance or a production wallet URL). Never use `demo.lnbits.com` for real money. |
| `LNBITS_API_KEY` | (demo wallet invoice key) | **Replace** with the **invoice/read** key from your **production** LNbits wallet. |
| `LNBITS_ADMIN_KEY` | (demo wallet admin key) | **Replace** with the **admin** key from your **production** LNbits wallet. Keep secret. |
| `LNBITS_WEBHOOK_SECRET` | (demo webhook secret) | **Generate new** with `openssl rand -hex 32` and set the same value in your LNbits wallet webhook config. |

**Where they are set**

- **Backend:** `backend/.env` or environment on the host (Render/server). Backend code uses `process.env.LNBITS_URL` (see `backend/src/services/lightning.js`).
- **Root:** Project root `.env` is used when running or building from repo root; ensure production env (e.g. on Render) uses production values, not the repo’s `.env` if it still has demo.

**Why replace**

- `https://demo.lnbits.com` is for testing only: rate limits, no guarantees, may reset.
- Demo keys are not for real funds; production must use keys from a wallet you control for production.

---

### 2. Backend fallback (code)

| File | What | Production |
|------|------|------------|
| `backend/src/services/lightning.js` | `process.env.LNBITS_URL \|\| 'https://legend.lnbits.com'` | Ensure `LNBITS_URL` is **always set** in production so this fallback is never used for real payments. |
| `backend/src/index.js` (CSP) | `process.env.LNBITS_URL \|\| 'https://legend.lnbits.com'` | Same: set `LNBITS_URL` in production. |

No other **demo** or **test** API URLs are hardcoded for payments or DB; the rest is either env-driven or already production (see below).

---

## Already production (no change needed)

| What | Where | Value / note |
|------|--------|--------------|
| Frontend URL (CORS) | `backend` env | `FRONTEND_URL=https://bit-breaker-psi.vercel.app` (or your production frontend). |
| API URL (frontend) | `frontend` env / Vite | `VITE_API_URL=https://bitbreakerbackend.optaimum.com/api` – frontend calls this. |
| API proxy | `frontend/vercel.json` | Rewrites `/api/*` to `https://bitbreakerbackend.optaimum.com/api/*` – production backend. |
| Database | Env | Set via `DATABASE_URL` (e.g. Neon or your Postgres). Local Docker Postgres is for dev only. |
| Redis | Env | Set via `REDIS_URL` for production session/cache. |

So: **API base URL**, **database**, and **Redis** are not “demo URLs” in code; they’re driven by env. Only **LNbits** is explicitly demo in the repo (demo.lnbits.com and demo keys).

---

## Checklist: move from test to production

1. **LNbits**
   - [ ] Set `LNBITS_URL` to your **production** LNbits URL (not `https://demo.lnbits.com`).
   - [ ] Set `LNBITS_API_KEY` to the **invoice/read** key from your production wallet.
   - [ ] Set `LNBITS_ADMIN_KEY` to the **admin** key from your production wallet.
   - [ ] Generate a new `LNBITS_WEBHOOK_SECRET` and set it in both backend env and LNbits webhook config.

2. **Backend**
   - [ ] Ensure backend env (e.g. Render) has the production LNbits variables above (and no demo keys).
   - [ ] Ensure `FRONTEND_URL` and `DATABASE_URL` (and `REDIS_URL` if used) are production.

3. **Frontend**
   - [ ] `VITE_API_URL` (or Vercel env) points to production API (`https://bitbreakerbackend.optaimum.com/api` or your API domain). No change needed if it already does.

4. **Wallet / deposits**
   - [ ] All invoice and payout calls use the production LNbits URL and keys above (they will, once env is set).
   - [ ] Webhook URL in LNbits points to your production backend (e.g. `https://bitbreakerbackend.optaimum.com/api/payments/webhook`).

---

## Summary

- **Demo/test in the project:** LNbits only – `LNBITS_URL=https://demo.lnbits.com` and the demo wallet keys in `.env` (or in docs).
- **What to do:** Replace LNbits URL and keys with your **production** LNbits instance and wallet keys; generate a new webhook secret and set it in backend + LNbits. Everything else (API URL, DB, Redis, frontend URL) is already production-oriented and controlled by env.
