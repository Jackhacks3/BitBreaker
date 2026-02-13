# BitBreaker Docker Boot Persistence Fix

**Issue**: BitBreaker Docker containers were stopping when the VPS rebooted because there was no mechanism to automatically restart them.

## Root Causes Identified and Fixed

### 1. **Missing Systemd Service**
   - No systemd service existed to manage Docker containers on VPS reboot
   - Docker containers need a service to orchestrate their startup

### 2. **Deprecated npm Flags in Dockerfiles**
   - `npm ci --only=production` → deprecated in npm v10+, should be `--omit=dev`
   - `npm ci --only=production=false` → non-existent flag, should just be `npm install`
   - These caused Docker builds to fail

### 3. **Package Lock File Mismatches**
   - package-lock.json was out of sync with package.json
   - `npm ci` requires strict synchronization; `npm install` is more flexible
   - Added `--legacy-peer-deps` flag to handle peer dependency resolution

## Solutions Implemented

### 1. **Created Systemd Service** (`/etc/systemd/system/bitbreaker.service`)
```
[Unit]
Description=BitBreaker Docker Compose Service
After=docker.service network-online.target
Wants=network-online.target
StartLimitIntervalSec=30
StartLimitBurst=5

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/BitBreaker
EnvironmentFile=/home/ubuntu/BitBreaker/.env

ExecStartPre=/bin/sleep 5
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up --no-log-prefix
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bitbreaker

[Install]
WantedBy=multi-user.target
```

**Key Features:**
- Automatically starts BitBreaker on VPS reboot
- Waits 5 seconds for Docker daemon to be ready
- Restarts containers if they crash (with 10s delay between retries)
- Limits restart attempts to prevent resource exhaustion
- Logs to systemd journal for easy monitoring

### 2. **Fixed Dockerfiles**

#### Backend (`backend/Dockerfile.prod`)
- Changed: `npm ci --only=production` 
- To: `npm install --omit=dev --legacy-peer-deps`

#### Frontend (`frontend/Dockerfile.prod`)
- Changed: `npm ci --only=production=false`
- To: `npm install --legacy-peer-deps`

### 3. **Updated Docker Compose**
- Using Docker Compose V2+ (`docker compose` instead of `docker-compose`)
- Production config already had `restart: unless-stopped` policies
- Service definitions ensure containers restart automatically if they crash

## Current Status

### Service Status
```bash
$ sudo systemctl status bitbreaker.service
● bitbreaker.service - BitBreaker Docker Compose Service
     Loaded: loaded (/etc/systemd/system/bitbreaker.service; enabled; preset: enabled)
     Active: active (running)
```

### Container Status
- ✓ **bitbreaker-api**: Up 5 minutes (healthy)
- ✓ **bitbreaker-postgres**: Up 6 minutes (healthy)
- ✓ **bitbreaker-redis**: Up 6 minutes (healthy)
- ⚠️ **bitbreaker-frontend**: Up 5 minutes (needs health check review)

## Verification

To verify the fix works after a reboot:
```bash
# Check if service is enabled for auto-start
sudo systemctl is-enabled bitbreaker.service

# View service status
sudo systemctl status bitbreaker.service

# View logs
journalctl -u bitbreaker.service -f
sudo systemctl logs bitbreaker.service

# Check running containers
docker compose -f /home/ubuntu/BitBreaker/docker-compose.prod.yml ps
```

## Management Commands

### Start BitBreaker
```bash
sudo systemctl start bitbreaker.service
```

### Stop BitBreaker
```bash
sudo systemctl stop bitbreaker.service
```

### Restart BitBreaker
```bash
sudo systemctl restart bitbreaker.service
```

### View Live Logs
```bash
journalctl -u bitbreaker.service -f
sudo systemctl logs bitbreaker.service
```

### Disable Auto-Start (if needed)
```bash
sudo systemctl disable bitbreaker.service
```

## Files Modified

1. **Created**: `/etc/systemd/system/bitbreaker.service` - Systemd service configuration
2. **Updated**: `/home/ubuntu/BitBreaker/backend/Dockerfile.prod` - Fixed npm install
3. **Updated**: `/home/ubuntu/BitBreaker/frontend/Dockerfile.prod` - Fixed npm install

## Next Steps (Optional)

1. **Frontend Health Check**: The frontend health check currently returns unhealthy. Consider:
   - Adding a proper `/health` endpoint to nginx config
   - Or adjusting the health check command

2. **Update docker-compose.prod.yml**: Remove deprecated `version: '3.8'` attribute (Docker Compose V2+ ignores it)

3. **Monitor Logs**: Watch `/var/log/journal` for any issues after VPS reboot

## Notes

- The `--legacy-peer-deps` flag bypasses strict peer dependency resolution. Consider running `npm audit` periodically to check for vulnerabilities
- The systemd service uses `Type=simple` with `Restart=on-failure` for reliability
- If Docker itself fails to start, the BitBreaker service will retry automatically
- Environment variables are loaded from `.env` file via `EnvironmentFile` directive

---
**Date**: February 13, 2026
**Fixed By**: GitHub Copilot
