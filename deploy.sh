#!/usr/bin/env bash
set -e

echo "=========================================="
echo "  🚀 Khmer PDF & Vision OCR Production Deploy"
echo "=========================================="

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# 0. Ensure directories exist
mkdir -p logs scratch

# 1. Check Python & Virtual Environment
echo "📦 Setting up Python Virtual Environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt

# 2. Check & Build Frontend
echo "⚛️  Building Next.js Production Bundle..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm ci
fi
npm run build
cd "$PROJECT_DIR"

# 3. Handle Environment file
if [ ! -f "backend/.env" ]; then
    if [ -f ".env" ]; then
        cp .env backend/.env
    elif [ -f ".env.example" ]; then
        cp .env.example backend/.env
        echo "⚠️  Created backend/.env from .env.example. Please update your API keys!"
    fi
fi

# 4. Check PM2 or Systemd
if command -v pm2 &> /dev/null; then
    echo "🔄 Reloading services via PM2..."
    pm2 startOrReload ecosystem.config.js
    pm2 save
    echo "✅ PM2 services active! Run 'pm2 status' or 'pm2 logs' to monitor."
else
    echo "⚠️  PM2 not found. Install PM2 for automated background process management:"
    echo "   sudo npm install -g pm2"
    echo "   pm2 startOrReload ecosystem.config.js"
    echo ""
    echo "💡 Or run manually in the background:"
    echo "   ./.venv/bin/uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 &"
    echo "   npm start --prefix frontend -- -p 3000 -H 127.0.0.1 &"
fi

echo "=========================================="
echo "🎉 Deployment completed successfully!"
echo "=========================================="
