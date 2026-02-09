# Navicat Connection Guide for BitBreaker Database

**Current config:** BitBreaker uses **Docker PostgreSQL** (see `.env` → `DATABASE_URL`).

---

## Connect to Docker PostgreSQL from Navicat

### Same machine (Navicat and Docker on the same computer)

Use **localhost** and port **5434**:

| Field | Value |
|-------|--------|
| **Connection Name** | BitBreaker Docker (e.g.) |
| **Host** | `localhost` or `127.0.0.1` |
| **Port** | `5434` |
| **Database** | `brickbreaker` |
| **Username** | `brickbreaker` |
| **Password** | `brickbreaker` |
| **SSL** | Disable / None |

### Different machine (Navicat on your laptop, Docker on a server)

Use the **server’s IP or hostname** and port **5434**:

| Field | Value |
|-------|--------|
| **Host** | `<server-ip>` or `<server-hostname>` (e.g. `54.123.45.67` or `my-server.example.com`) |
| **Port** | `5434` |
| **Database** | `brickbreaker` |
| **Username** | `brickbreaker` |
| **Password** | `brickbreaker` |
| **SSL** | Disable / None |

**Required on the server:**
1. **Firewall / security group** must allow **inbound TCP port 5434** from your IP (or from anywhere if you accept the risk).
2. Postgres container must be running and publishing port 5434:
   ```bash
   docker ps   # check postgres container is Up
   docker port $(docker ps -qf name=postgres)  # should show 0.0.0.0:5434->5432/tcp
   ```

---

## Option 1: Local Docker PostgreSQL (Development) — in use

If you're running the database via Docker Compose on the same machine as Navicat:

### Connection Settings:
- **Connection Name:** BitBreaker Local
- **Host:** `localhost` (or `127.0.0.1`)
- **Port:** `5434` (Docker maps container 5432 → host 5434)
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

### Can't connect to Docker database?
1. **Same machine:** Use host `localhost` and port `5434`.
2. **Different machine:** Use the server’s IP/hostname and port `5434`; open TCP 5434 in the server firewall/security group.
3. Check Postgres container is running and port is published:
   ```bash
   cd /path/to/BitBreaker && docker-compose ps postgres
   docker port $(docker ps -qf name=postgres)   # expect 5434->5432
   ```
4. Test from the server: `nc -zv localhost 5434` or `telnet localhost 5434`.

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
