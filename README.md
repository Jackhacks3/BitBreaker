# Brick Breaker Tournament

A web-based endless Brick Breaker game with daily Bitcoin Lightning tournaments. Players buy in with sats, compete for high scores, and top 3 winners split the prize pool.

## How It Works

1. **Daily Tournaments**: New tournament starts at midnight UTC
2. **Buy-in**: Pay Lightning invoice to enter (default: 10,000 sats)
3. **Play**: Endless mode - bricks regenerate, difficulty increases
4. **Win**: Top 3 players split 98% of prize pool (2% house fee)
   - 1st: 50%
   - 2nd: 30%
   - 3rd: 20%

## Tech Stack

- **Frontend**: React + Vite + HTML5 Canvas
- **Backend**: Node.js + Express + PostgreSQL
- **Payments**: Lightning Network via LNbits
- **Hosting**: Render.com (or any Docker host)

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- PostgreSQL (or Docker)
- LNbits account (optional for dev)

### 1. Clone and Install

```bash
git clone <repo>
cd brick-breaker

# Install backend
cd backend
npm install
cp .env.example .env

# Install frontend
cd ../frontend
npm install
```

### 2. Configure Environment

Edit `backend/.env`:

```env
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://user:pass@localhost:5432/brickbreaker

# Optional: LNbits for real payments
LNBITS_URL=https://legend.lnbits.com
LNBITS_API_KEY=your_key
LNBITS_ADMIN_KEY=your_admin_key

BUY_IN_SATS=10000
```

### 3. Start Database

With Docker:
```bash
docker-compose up postgres -d
```

Or use existing PostgreSQL.

### 4. Run Development Servers

Terminal 1 (Backend):
```bash
cd backend
npm run dev
```

Terminal 2 (Frontend):
```bash
cd frontend
npm run dev
```

Visit http://localhost:3000

## Docker Development

Run everything with Docker:

```bash
docker-compose up
```

## Production Deployment (Render.com)

1. Push code to GitHub
2. Connect repo to Render.com
3. It auto-detects `render.yaml` and creates services
4. Set environment variables in Render dashboard:
   - `LNBITS_URL`
   - `LNBITS_API_KEY`
   - `LNBITS_ADMIN_KEY`

## LNbits Setup

1. Create account at https://legend.lnbits.com (or self-host)
2. Create a new wallet
3. Get API keys from wallet settings:
   - **Invoice/read key**: For creating invoices
   - **Admin key**: For sending payouts
4. Add keys to environment variables

## Game Features

### Endless Mode Algorithm
- Bricks regenerate when rows cleared
- Ball speed increases every 500 points
- Paddle shrinks every 1000 points
- New rows drop from above periodically
- Game only ends when ball falls or bricks reach paddle

### Anti-Cheat
- Score rate validation
- Frame count verification
- Input logging for replay verification
- Server-side score validation

## API Endpoints

### Auth
- `POST /api/auth/register` - Register/login with Lightning address
- `GET /api/auth/me` - Get current user

### Tournaments
- `GET /api/tournaments/current` - Today's tournament
- `GET /api/tournaments/current/leaderboard` - Rankings
- `GET /api/tournaments/current/entry` - Check entry status

### Payments
- `POST /api/payments/buy-in` - Generate invoice
- `GET /api/payments/status/:hash` - Check payment

### Game
- `POST /api/game/submit` - Submit score

## Project Structure

```
brick-breaker/
├── backend/
│   ├── src/
│   │   ├── index.js              # Express server
│   │   ├── routes/
│   │   │   ├── auth.js           # User auth
│   │   │   ├── tournaments.js    # Tournament info
│   │   │   ├── payments.js       # Lightning payments
│   │   │   └── game.js           # Score submission
│   │   └── services/
│   │       ├── database.js       # PostgreSQL
│   │       ├── lightning.js      # LNbits integration
│   │       └── tournamentEngine.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Main app
│   │   ├── game/
│   │   │   └── BrickBreaker.js   # Game engine
│   │   └── components/
│   │       ├── Game/
│   │       ├── Tournament/
│   │       ├── Payment/
│   │       └── Auth/
│   └── package.json
├── docker-compose.yml
├── render.yaml
└── README.md
```

## Security Notes

- Never expose admin keys in frontend
- All scores validated server-side
- Rate limiting on all endpoints
- Payments verified via LNbits webhooks

## License

MIT
