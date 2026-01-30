# Render Environment Setup Guide

## Required Environment Variables

Copy these values to **Render Dashboard > Your Service > Environment > Add Environment Variable**:

### Critical Variables (Login/Database)

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://neondb_owner:npg_87sauHxUcTnr@ep-floral-bonus-ahnsyf45-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require` |
| `FRONTEND_URL` | `https://bit-breaker-psi.vercel.app` |
| `REDIS_URL` | `redis://default:2guvtYhIAaa36f6EFZCpdsL1bbqpxFT8@redis-11787.c17.us-east-1-4.ec2.cloud.redislabs.com:11787` |

### Lightning Payment Variables

| Key | Value |
|-----|-------|
| `LNBITS_URL` | `https://demo.lnbits.com` |
| `LNBITS_API_KEY` | `38ef31f4a6dd47ad8b713ba89645aa21` |
| `LNBITS_ADMIN_KEY` | `d3422d9c267744eaae36ba2e9ae151ee` |
| `LNBITS_WEBHOOK_SECRET` | `3f2ff8c0cbf153df18f8948c184979ef8b5156fea9864cdf970e291d98c86ddb` |

---

## Step-by-Step Setup

### 1. Go to Render Dashboard
https://dashboard.render.com/

### 2. Select Your Service
Click on `bitbreaker` (or your service name)

### 3. Go to Environment Tab
Click "Environment" in the left sidebar

### 4. Add Each Variable
Click "Add Environment Variable" and add each variable from the tables above.

### 5. Save and Deploy
Click "Save Changes" - Render will automatically redeploy

---

## Verification Checklist

After deployment, verify:

- [ ] Health check passes: `curl https://bitbreaker.onrender.com/api/health`
- [ ] Response shows `"sessionStore": "redis"` (not "memory")
- [ ] Login works on frontend
- [ ] Deposit invoice generates correctly

---

## Expected Health Response

```json
{
  "status": "ok",
  "timestamp": "2025-01-30T...",
  "uptime": 123.456,
  "sessionStore": "redis"
}
```

If you see `"sessionStore": "memory"`, the `REDIS_URL` is not set correctly.

---

## Troubleshooting

### "Using in-memory mock database" in logs
- `DATABASE_URL` is not set or incorrect
- Check for typos in the connection string

### CORS errors in browser console
- `FRONTEND_URL` is not set or doesn't match Vercel URL
- Must be exactly: `https://bit-breaker-psi.vercel.app`

### Login works but user disappears
- `DATABASE_URL` missing - using mock database
- Add the DATABASE_URL variable and redeploy

### Sessions lost after Render restart
- `REDIS_URL` not configured
- Add Redis URL and redeploy
