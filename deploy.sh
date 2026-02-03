#!/bin/bash

# Brick Breaker Tournament - Production Deployment Script

set -e

echo "=========================================="
echo "  Brick Breaker Tournament - Deployment"
echo "=========================================="

# Check if .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    exit 1
fi

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Parse command line arguments
COMMAND=${1:-"up"}

case $COMMAND in
    "up"|"start")
        echo "Starting production containers..."
        docker-compose -f docker-compose.prod.yml up -d --build
        echo ""
        echo "Services started!"
        echo "Frontend: http://localhost:${PORT:-80}"
        ;;
    "down"|"stop")
        echo "Stopping containers..."
        docker-compose -f docker-compose.prod.yml down
        ;;
    "logs")
        docker-compose -f docker-compose.prod.yml logs -f ${2:-""}
        ;;
    "rebuild")
        echo "Rebuilding and restarting..."
        docker-compose -f docker-compose.prod.yml down
        docker-compose -f docker-compose.prod.yml build --no-cache
        docker-compose -f docker-compose.prod.yml up -d
        ;;
    "status")
        docker-compose -f docker-compose.prod.yml ps
        ;;
    "migrate")
        echo "Running database migrations..."
        docker-compose -f docker-compose.prod.yml exec api npm run migrate
        ;;
    *)
        echo "Usage: ./deploy.sh [command]"
        echo ""
        echo "Commands:"
        echo "  up, start    - Start all services"
        echo "  down, stop   - Stop all services"
        echo "  logs [svc]   - View logs (optionally for specific service)"
        echo "  rebuild      - Rebuild and restart all services"
        echo "  status       - Show container status"
        echo "  migrate      - Run database migrations"
        ;;
esac
