# 🚀 Production Server Deployment Guide (SSH `name@ip`)

This guide walks you through deploying **KhmerPDF Vision OCR** to a remote Linux server (Ubuntu/Debian) using SSH.

---

## 📋 Overview of Deployment Methods

| Method | Recommended For | Commands Required |
| :--- | :--- | :--- |
| **Method 1: Docker Compose** *(Recommended)* | Cleanest, fully containerized, isolated dependencies | `docker compose up -d --build` |
| **Method 2: PM2 / Systemd + Nginx** | Bare-metal VPS, direct system performance | `./deploy.sh` |

---

## 1️⃣ Connect to Your Server

From your local machine terminal:

```bash
ssh username@your_server_ip
```
*(Replace `username` with your server user, e.g. `root` or `ubuntu`, and `your_server_ip` with your server IP address)*

---

## 2️⃣ Transfer or Clone Code to the Server

### Option A: Using Git (Easiest)
```bash
git clone <your-git-repo-url> /var/www/khmer-ocr
cd /var/www/khmer-ocr
```

### Option B: Using `rsync` from your local machine
Run this from your **local machine** terminal (not inside the SSH session):
```bash
rsync -avz --exclude '.venv' --exclude 'node_modules' --exclude '.next' /Users/thoeurnratha/Desktop/pdf-text/ username@your_server_ip:/var/www/khmer-ocr
```

---

## 3️⃣ Set Up Environment Variables

On the remote server, copy the environment template:
```bash
cd /var/www/khmer-ocr
cp .env.example .env
cp .env.example backend/.env
nano backend/.env
```
Add your **Gemini API Key** (or multiple keys separated by commas):
```ini
GEMINI_API_KEY=AIzaSy...
NEXT_PUBLIC_API_URL=
```
*(Tip: Leaving `NEXT_PUBLIC_API_URL=` blank allows the frontend to automatically detect your server's IP address or Nginx domain without hardcoding).*

---

## 4️⃣ Deployment Method 1: Docker Compose (Recommended)

### Step 1: Install Docker & Docker Compose (if not already installed)
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### Step 2: Launch the Application
```bash
cd /var/www/khmer-ocr
docker compose up -d --build
```

### Step 3: Check Status & Logs
```bash
# Check running containers
docker compose ps

# View live backend and frontend logs
docker compose logs -f
```

Your app is now live at:
- **Web App**: `http://your_server_ip` (Port 80 via Nginx)
- **Direct Frontend**: `http://your_server_ip:3000`
- **Backend API**: `http://your_server_ip:8000/docs`

---

## 5️⃣ Deployment Method 2: Native Node.js & Python with PM2

If you prefer running services directly on the host without Docker:

### Step 1: Install System Prerequisites
```bash
sudo apt update && sudo apt install -y python3-venv python3-pip nodejs npm nginx curl build-essential
sudo npm install -g pm2
```

### Step 2: Run the Deployment Script
```bash
cd /var/www/khmer-ocr
chmod +x deploy.sh
./deploy.sh
```

### Step 3: Configure Host Nginx
```bash
# Copy nginx site config
sudo cp nginx-host.conf /etc/nginx/sites-available/khmer-ocr
sudo ln -s /etc/nginx/sites-available/khmer-ocr /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload Nginx
sudo nginx -t
sudo systemctl reload nginx
```

### Step 4: Manage Services with PM2
```bash
pm2 status
pm2 logs
pm2 restart all
pm2 startup
pm2 save
```

---

## 6️⃣ Firewall Configuration (UFW)

Make sure the essential ports are open:
```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

---

## 7️⃣ Free SSL / HTTPS (Let's Encrypt Certbot)

Once you point your domain (e.g. `ocr.yourdomain.com`) to `your_server_ip`:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ocr.yourdomain.com
```
Certbot will automatically configure HTTPS, HTTP-to-HTTPS redirect, and automated certificate renewals!

---

## 8️⃣ Health Check Verification

Test that everything is operating normally:
```bash
# Backend health
curl http://localhost:8000/api/health

# Key pool status
curl http://localhost:8000/api/key-pool-status
```
You should see `{"status":"ok","active_models":...}`.

---

## 🛡️ Built-in Production Security Protections

Your deployment is hardened with the following defenses:

1. **SSRF (Server-Side Request Forgery) Defense:**
   - Remote URL fetcher blocks loopback, RFC 1918 private subnets, link-local addresses, and cloud provider metadata IPs (`169.254.169.254`).
2. **File Upload Security & Magic Byte Inspection:**
   - Validates file headers/signatures (`%PDF`, JPEG, PNG, WebP) to prevent disguised executable uploads.
   - Enforces a 100MB upload cap (`MAX_UPLOAD_SIZE_MB`) against memory exhaustion (DoS).
   - Filename sanitization against Path Traversal (`../../`).
3. **Network Isolation (Docker):**
   - Port 8000 (FastAPI) and Port 3000 (Next.js) are bound strictly to `127.0.0.1` so external traffic cannot bypass Nginx. Only ports `80` and `443` are exposed publicly.
4. **Non-Root Containers:**
   - Frontend runs under unprivileged `node` user.
   - Backend runs under unprivileged `appuser` (UID 1000).
5. **Rate Limiting:**
   - Sliding-window in-memory IP rate limiter to protect against spam and quota exhaustion.
6. **HTTP Security Headers:**
   - `X-Frame-Options: SAMEORIGIN` (prevents Clickjacking).
   - `X-Content-Type-Options: nosniff` (prevents MIME-type sniffing).
   - `X-XSS-Protection: 1; mode=block`.
   - `server_tokens off;` (hides Nginx version).
   - `Referrer-Policy: strict-origin-when-cross-origin`.
7. **Credentials & Secrets Protection:**
   - `.env` files are git-ignored.
   - Keys displayed in UI are masked (e.g. `AIza...eEwW`).

