# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web-based Brick Breaker tournament platform with Bitcoin Lightning payment integration. Players buy in with sats, compete for daily high scores, and top 3 winners split the prize pool.

## Build and Run Commands

### Development

```bash
# Backend (Terminal 1)
cd backend
npm install
cp .env.example .env  # Configure environment
npm run dev           # Starts on port 4000

# Frontend (Terminal 2)
cd frontend
npm install
npm run dev           # Starts on port 5173
```

### Docker (Full Stack)

```bash
docker-compose up                # All services
docker-compose up postgres -d    # Database only
```

### Production Build

```bash
cd frontend && npm run build    # Creates dist/
cd backend && npm start         # Production server
```

## Architecture

### Backend (`backend/src/`) - Express.js API

- `index.js` - Server setup with security middleware (helmet, rate limiting, CORS, CSRF)
- `routes/auth.js` - User registration/login with Lightning address
- `routes/tournaments.js` - Tournament info and leaderboard
- `routes/payments.js` - Lightning invoice generation and webhooks
- `routes/game.js` - Score submission with anti-cheat validation
- `routes/lnurl-auth.js` - LNURL-auth flow for wallet login
- `routes/wallet.js` - User balance management
- `services/database.js` - PostgreSQL with in-memory mock fallback
- `services/tournamentEngine.js` - Daily tournament lifecycle (midnight UTC create, 23:59 close)
- `services/lightning.js` - LNbits integration

### Frontend (`frontend/src/`) - React + Vite

- `App.jsx` - Main application with routing
- `game/BrickBreaker.js` - HTML5 Canvas game engine with anti-cheat input logging
- `components/Game/GameCanvas.jsx` - Game wrapper component
- `components/Tournament/` - Leaderboard, PrizePool components
- `components/Payment/BuyInModal.jsx` - Lightning payment UI
- `components/Auth/Login.jsx` - Authentication forms

### Database Schema

Tables: `users`, `tournaments`, `tournament_entries`, `game_sessions`, `payouts`, `user_wallets`, `transactions`, `whitelist`, `lnurl_challenges`

Supports dual-mode: PostgreSQL (production) or in-memory mock (development when DATABASE_URL not set).

## Tournament Flow

1. Daily tournament created at midnight UTC
2. Users buy in via Lightning invoice (default: 10,000 sats)
3. Unlimited game attempts, best score tracked
4. Tournament closes at 23:59 UTC
5. Top 3 split 98% of prize pool (50%/30%/20%), 2% house fee

## Environment Variables

Backend requires `backend/.env`:

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/brickbreaker
LNBITS_URL=https://legend.lnbits.com
LNBITS_API_KEY=your_invoice_key
LNBITS_ADMIN_KEY=your_admin_key
LNBITS_WEBHOOK_SECRET=your_secret  # Required in production
BUY_IN_SATS=10000
REDIS_URL=redis://localhost:6379   # Optional, uses memory store in dev
FRONTEND_URL=http://localhost:3000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register with Lightning address |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/tournaments/current` | Current tournament info |
| GET | `/api/tournaments/current/leaderboard` | Rankings |
| POST | `/api/payments/buy-in` | Generate Lightning invoice |
| GET | `/api/payments/status/:hash` | Check payment status |
| POST | `/api/game/submit` | Submit score (CSRF protected) |

## Game Engine

Canvas: 700x600, Paddle: 100x8 @ y=550, Ball: 20x20

Endless mode features:
- Bricks regenerate when rows cleared
- Ball speed increases every 1000 points
- Paddle shrinks every 1000 points
- New rows drop periodically

Anti-cheat: Input logging with frame timestamps, score rate validation, server-side verification.
