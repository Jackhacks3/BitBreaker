# Navicat Connection Guide for BitBreaker Database

**Current config:** BitBreaker uses **local Docker PostgreSQL** (see `.env` → `DATABASE_URL`).

## Option 1: Local Docker PostgreSQL (Development) — in use

If you're running the database locally via Docker Compose:

### Connection Settings:
- **Connection Name:** BitBreaker Local
- **Host:** `localhost` (or `127.0.0.1`)
- **Port:** `5434` (Note: Docker maps container port 5432 to host port 5434)
- **Database Name:** `brickbreaker`
- **Username:** `brickbreaker`
- **Password:** `brickbreaker`
- **SSL Mode:** Disable (or None)

### Steps in Navicat:
1. Open Navicat
2. Click **New Connection** → **PostgreSQL**
3. Enter the connection details above
4. Click **Test Connection** to verify
5. Click **OK** to save

---

## Option 2: Remote Neon Database (Production)

Based on your `.env` file, you have a Neon PostgreSQL database configured:

### Connection Settings:
- **Connection Name:** BitBreaker Neon (Production)
- **Host:** `ep-floral-bonus-ahnsyf45-pooler.c-3.us-east-1.aws.neon.tech`
- **Port:** `5432` (default PostgreSQL port)
- **Database Name:** `neondb`
- **Username:** `neondb_owner`
- **Password:** `npg_87sauHxUcTnr`
- **SSL Mode:** **Require** (Important: Neon requires SSL)

### Steps in Navicat:
1. Open Navicat
2. Click **New Connection** → **PostgreSQL**
3. Enter the connection details above
4. Go to **SSL** tab:
   - Enable **Use SSL**
   - SSL Mode: **Require**
5. Click **Test Connection** to verify
6. Click **OK** to save

---

## Quick Connection String Reference

### Local Docker:
```
postgresql://brickbreaker:brickbreaker@localhost:5434/brickbreaker
```

### Neon (Production):
```
postgresql://neondb_owner:npg_87sauHxUcTnr@ep-floral-bonus-ahnsyf45-pooler.c-3.us-east-1.aws.neon.tech:5432/neondb?sslmode=require
```

---

## Troubleshooting

### Can't connect to local Docker database?
1. Check if Docker container is running:
   ```bash
   docker ps | grep postgres
   ```
2. Verify port mapping:
   ```bash
   docker port bitbreaker_postgres_1
   ```
3. Try connecting to port `5432` instead of `5434` if Docker isn't mapping ports

### Can't connect to Neon database?
1. Verify SSL is enabled (required for Neon)
2. Check if your IP is whitelisted (some Neon instances require IP allowlisting)
3. Verify credentials in Neon dashboard
4. Try using the **pooler** endpoint (which you're already using)

---

## Security Note

⚠️ **Important:** The credentials shown above are from your `.env` file. 
- Never commit `.env` files to version control
- Change production passwords regularly
- Use different credentials for development vs production
