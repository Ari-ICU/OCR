# 🚀 Server Deployment Guide (SSH `username@ip` + Password)

This guide walks you through deploying **KhmerPDF Vision OCR** to any remote Linux server (Ubuntu/Debian), such as a **school / university server, lab machine, dedicated physical server, or VPS**, when you are provided with an **IP, Username, and Password**.

---

## 📋 Architecture Overview

- **Host Reverse Proxy**: Nginx (Listens on port 80, forwards `/api/` to FastAPI and `/` to Next.js)
- **Frontend**: Next.js (Runs locally on `127.0.0.1:3000` via PM2)
- **Backend**: FastAPI + Uvicorn (Runs locally on `127.0.0.1:8000` with 2 workers via PM2)
- **Process Manager**: PM2 (Auto-restarts on crash, memory limits, and auto-starts on boot)

---

## 1️⃣ Connect to the Server (SSH)

Open your **Terminal** app on your computer (Mac / Linux / Windows PowerShell):

```bash
ssh YOUR_USER@YOUR_SERVER_IP
```
*Example: `ssh student@192.168.1.100` or `ssh root@103.120.45.10`*

1. When prompted: `Are you sure you want to continue connecting (yes/no)?` ➔ Type **`yes`** and press Enter.
2. When prompted for `password:` ➔ Type your server password and press Enter.
   > [!NOTE]
   > Linux terminals **do not display asterisks or dots** when you type your password for security. Simply type it accurately and press Enter.

---

## 2️⃣ Install Server Prerequisites

Once logged in to the server terminal, run this command to install Python 3, Node.js, npm, Nginx, and PM2:

```bash
# 1. Update package list
sudo apt update && sudo apt upgrade -y

# 2. Install Python 3, venv, Node.js, npm, Nginx, Git, build tools
sudo apt install -y python3 python3-venv python3-pip nodejs npm nginx git curl build-essential

# 3. Install PM2 process manager globally
sudo npm install -g pm2
```
*(Enter your password if prompted for `[sudo]`)*

---

## 3️⃣ Transfer Your Code to the Server

Choose either **Option A** (using Git) or **Option B** (direct transfer from your Mac):

### Option A: Using Git (Recommended)
Inside your server terminal:
```bash
git clone <your-git-repository-url> ~/khmer-ocr
cd ~/khmer-ocr
```

### Option B: Direct Copy from Your Mac (No Git needed)
Open a **new tab in your Mac terminal** (`Cmd + T`) and run `rsync` from your project folder:
```bash
rsync -avz --exclude '.venv' --exclude 'node_modules' --exclude '.next' --exclude '__pycache__' /Users/thoeurnratha/Desktop/pdf-text/ YOUR_USER@YOUR_SERVER_IP:~/khmer-ocr
```
*(Enter your server password when prompted. All project files will copy straight to `~/khmer-ocr`).*

---

## 4️⃣ Configure Environment Variables

Inside your server terminal:

```bash
cd ~/khmer-ocr
cp .env.example .env
cp .env.example backend/.env
nano backend/.env
```

Set your **Gemini API Key**:
```ini
GEMINI_API_KEY=AIzaSy...
NEXT_PUBLIC_API_URL=
```
> [!TIP]
> Leave `NEXT_PUBLIC_API_URL=` blank. The frontend automatically detects the server's IP address and routes all requests through Nginx without hardcoding.

Press `Ctrl + O` then `Enter` to save, and `Ctrl + X` to exit `nano`.

---

## 5️⃣ Run Automated Deployment

The [`deploy.sh`](file:///Users/thoeurnratha/Desktop/pdf-text/deploy.sh) script automatically sets up the Python virtual environment (`.venv`), installs all backend dependencies, builds the Next.js production bundle, and starts everything under PM2:

```bash
chmod +x deploy.sh
./deploy.sh
```

### Useful PM2 Management Commands:
```bash
# Check status of running backend and frontend services
pm2 status

# View live real-time logs (with timestamps)
pm2 logs

# Restart both services
pm2 restart all

# Ensure services automatically start on server reboot
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

---

## 7️⃣ Access Your Application! 🌐

Open your web browser (Chrome, Safari, Firefox, Edge) on your laptop or mobile phone:

👉 **`http://YOUR_SERVER_IP`**

*(Example: `http://192.168.1.100` or `http://103.120.45.10`)*

No port numbers are required in the URL! Nginx automatically routes web traffic on port 80 to Next.js and `/api/` to FastAPI.

---

## 8️⃣ Health Check & Verification

To verify that the system is operating normally from the server terminal:

```bash
# 1. Test backend health
curl http://127.0.0.1:8000/api/health

# 2. Test key pool status
curl http://127.0.0.1:8000/api/key-pool-status

# 3. Test frontend HTTP response
curl -I http://127.0.0.1:3000/

# 4. Test Nginx routing
curl -I http://localhost/api/health
```
Expected output: `{"status":"ok","active_models":...}`.

---

## ❓ Troubleshooting & FAQs

#### Q: What if my teacher's server already uses Port 80 for another website?
If Port 80 is occupied by an existing Apache/Nginx site on the server:
1. Edit `nginx.conf`: Change `listen 80;` to an unused port like `listen 8080;`.
2. Reload Nginx: `sudo systemctl reload nginx`.
3. You can now access your app at `http://YOUR_SERVER_IP:8080`.

#### Q: What if I don't have `sudo` permissions on the server?
If your teacher gave you a student account without `sudo` access:
1. You can run PM2 directly without Nginx!
2. In `ecosystem.config.js`, change `127.0.0.1` to `0.0.0.0`:
   - Backend: `--host 0.0.0.0 --port 8000`
   - Frontend: `-p 3000 -H 0.0.0.0`
3. In `backend/.env`, set `NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP:8000`.
4. Rebuild frontend: `cd frontend && npm run build && cd ..`.
5. Restart PM2: `pm2 restart all`.
6. Access your app directly at `http://YOUR_SERVER_IP:3000`.

#### Q: Where are the application logs located?
All service logs with timestamps are stored in:
- Backend: `~/khmer-ocr/logs/backend-out.log` and `~/khmer-ocr/logs/backend-error.log`
- Frontend: `~/khmer-ocr/logs/frontend-out.log` and `~/khmer-ocr/logs/frontend-error.log`
- Live viewer: `pm2 logs`
