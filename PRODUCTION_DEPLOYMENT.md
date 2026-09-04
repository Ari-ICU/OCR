# 🚀 Production Server Deployment Guide (SSH `name@ip`)

This guide walks you through deploying **KhmerPDF Vision OCR** natively on your remote Linux server (Ubuntu/Debian) using **PM2 & Nginx**.

---

## 📋 Architecture Overview

- **Host Reverse Proxy**: Nginx (Listens on port 80/443, handles SSL, routes `/api/` to FastAPI and `/` to Next.js)
- **Frontend**: Next.js (Runs locally on `127.0.0.1:3000` via PM2)
- **Backend**: FastAPI + Uvicorn (Runs locally on `127.0.0.1:8000` with 2 workers via PM2)
- **Process Manager**: PM2 (Auto-restarts on crash, memory limits, and starts on system boot)

---

## 1️⃣ Connect to Your Server

From your local machine terminal:

```bash
ssh username@your_server_ip
```
*(Replace `username` with your server user, e.g. `root` or `ubuntu`, and `your_server_ip` with your server IP address)*

---

## 2️⃣ Install Server Prerequisites

Run the following commands on your server to install Python, Node.js, Nginx, and PM2:

```bash
# Update package index
sudo apt update && sudo apt upgrade -y

# Install Python 3, venv, Node.js, npm, Nginx, Git, build tools
sudo apt install -y python3 python3-venv python3-pip nodejs npm nginx git curl build-essential

# Install PM2 globally
sudo npm install -g pm2
```

---

## 3️⃣ Transfer or Clone Code to the Server

### Option A: Using Git (Recommended)
```bash
git clone <your-git-repo-url> /var/www/khmer-ocr
cd /var/www/khmer-ocr
```

### Option B: Using `rsync` from your local machine
Run this from your **local machine** terminal:
```bash
rsync -avz --exclude '.venv' --exclude 'node_modules' --exclude '.next' /Users/thoeurnratha/Desktop/pdf-text/ username@your_server_ip:/var/www/khmer-ocr
```

---

## 4️⃣ Configure Environment Variables

```bash
cd /var/www/khmer-ocr
cp .env.example .env
cp .env.example backend/.env
nano backend/.env
```

Set your Gemini API key:
```ini
GEMINI_API_KEY=AIzaSy...
NEXT_PUBLIC_API_URL=
```
*(Tip: Leaving `NEXT_PUBLIC_API_URL=` blank allows the frontend to automatically communicate with `/api/` through Nginx without CORS or IP hardcoding).*

---

## 5️⃣ Run Automated Deployment Script

The included [`deploy.sh`](file:///Users/thoeurnratha/Desktop/pdf-text/deploy.sh) script automatically sets up the Python virtual environment, installs backend dependencies, builds the Next.js frontend production bundle, and launches everything via PM2:

```bash
chmod +x deploy.sh
./deploy.sh
```

### PM2 Process Commands:
```bash
# Check status of running backend and frontend services
pm2 status

# View live real-time logs
pm2 logs

# Restart services
pm2 restart all

# Ensure services automatically restart on server reboot
pm2 startup
pm2 save
```

---

## 6️⃣ Configure Nginx Reverse Proxy

Copy the preconfigured [`nginx.conf`](file:///Users/thoeurnratha/Desktop/pdf-text/nginx.conf) to your Nginx sites directory:

```bash
# Copy site configuration
sudo cp nginx.conf /etc/nginx/sites-available/khmer-ocr

# Enable site by creating a symlink
sudo ln -s /etc/nginx/sites-available/khmer-ocr /etc/nginx/sites-enabled/

# Remove default site if present
sudo rm -f /etc/nginx/sites-enabled/default

# Test configuration for syntax errors
sudo nginx -t

# Reload Nginx to apply changes
sudo systemctl reload nginx
```

Your app is now live at `http://your_server_ip`!

---

## 7️⃣ Configure Firewall (UFW)

Make sure essential ports are permitted:
```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

---

## 8️⃣ Free SSL / HTTPS (Let's Encrypt Certbot)

Once you point your domain (e.g. `ocr.yourdomain.com`) to `your_server_ip`:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ocr.yourdomain.com
```

Certbot will automatically install SSL certificates, configure HTTPS, redirect HTTP to HTTPS, and schedule automated renewal cron jobs.

---

## 9️⃣ Verification & Health Check

Test that all components are responding:

```bash
# Verify backend API health
curl http://127.0.0.1:8000/api/health

# Verify key pool status
curl http://127.0.0.1:8000/api/key-pool-status

# Verify frontend response
curl -I http://127.0.0.1:3000/

# Verify Nginx proxying
curl -I http://localhost/api/health
```

Expected output includes `{"status":"ok","active_models":...}`.

---

## 🛡️ Built-in Production Hardening

1. **SSRF Defense:** Remote URL fetcher blocks loopback, private subnets, link-local addresses, and cloud provider metadata IPs (`169.254.169.254`).
2. **File Upload Security:** Magic byte header inspection (`%PDF`, JPEG, PNG, WebP) and a 100MB upload cap with path traversal sanitization.
3. **Localhost Binding:** Backend (`127.0.0.1:8000`) and frontend (`127.0.0.1:3000`) only listen locally. All public access goes strictly through Nginx.
4. **Rate Limiting:** Sliding-window in-memory IP rate limiter to protect against abuse and quota exhaustion.
5. **Security Headers:** `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 1; mode=block`, and `Referrer-Policy: strict-origin-when-cross-origin`.
