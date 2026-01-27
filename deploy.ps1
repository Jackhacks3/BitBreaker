# Brick Breaker Tournament - Production Deployment Script (PowerShell)

param(
    [Parameter(Position=0)]
    [string]$Command = "up",
    [Parameter(Position=1)]
    [string]$Service = ""
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Brick Breaker Tournament - Deployment" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "Error: .env file not found!" -ForegroundColor Red
    Write-Host "Copy .env.example to .env and configure it:"
    Write-Host "  Copy-Item .env.example .env"
    exit 1
}

switch ($Command) {
    { $_ -in "up", "start" } {
        Write-Host "Starting production containers..." -ForegroundColor Yellow
        docker-compose -f docker-compose.prod.yml up -d --build
        Write-Host ""
        Write-Host "Services started!" -ForegroundColor Green
        Write-Host "Frontend: http://localhost" -ForegroundColor Cyan
    }
    { $_ -in "down", "stop" } {
        Write-Host "Stopping containers..." -ForegroundColor Yellow
        docker-compose -f docker-compose.prod.yml down
    }
    "logs" {
        if ($Service) {
            docker-compose -f docker-compose.prod.yml logs -f $Service
        } else {
            docker-compose -f docker-compose.prod.yml logs -f
        }
    }
    "rebuild" {
        Write-Host "Rebuilding and restarting..." -ForegroundColor Yellow
        docker-compose -f docker-compose.prod.yml down
        docker-compose -f docker-compose.prod.yml build --no-cache
        docker-compose -f docker-compose.prod.yml up -d
    }
    "status" {
        docker-compose -f docker-compose.prod.yml ps
    }
    "migrate" {
        Write-Host "Running database migrations..." -ForegroundColor Yellow
        docker-compose -f docker-compose.prod.yml exec api npm run migrate
    }
    default {
        Write-Host "Usage: .\deploy.ps1 [command]" -ForegroundColor White
        Write-Host ""
        Write-Host "Commands:" -ForegroundColor Yellow
        Write-Host "  up, start    - Start all services"
        Write-Host "  down, stop   - Stop all services"
        Write-Host "  logs [svc]   - View logs (optionally for specific service)"
        Write-Host "  rebuild      - Rebuild and restart all services"
        Write-Host "  status       - Show container status"
        Write-Host "  migrate      - Run database migrations"
    }
}
