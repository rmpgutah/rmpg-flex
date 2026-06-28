# RMPG Flex — On-Premise Migration Guide

## Architecture

```
Internet ──→ rmpgutah.us ──→ Cloudflare Edge ──→ Cloudflare Tunnel ──→ cloudflared ──→ localhost:3001
(Cloudflare DNS)               (SSL termination)                       (on-prem server)   (Express)
```

**Key points:**
- Cloudflare handles DNS, SSL, DDoS protection, caching
- `cloudflared` makes an outbound-only connection to Cloudflare (no open inbound ports)
- Express listens on port 3001 behind Cloudflare
- Local LAN users access `http://<server-ip>:3001` directly

---

## Phase 1: Server Hardware & OS

### Recommended Hardware
| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16-32 GB |
| Storage | 256 GB SSD | 512 GB+ NVMe |
| Network | 1 Gbps | 1 Gbps |
| UPS | Required | Required |

### Install Ubuntu Server 24.04 LTS
1. Download from [ubuntu.com/download/server](https://ubuntu.com/download/server)
2. Create bootable USB with Balena Etcher or Rufus
3. Install with:
   - **Username**: `rmpg` (or your choice)
   - **Hostname**: `flex-server` (or your choice)
   - **SSH server**: Enable during install
   - **Minimal install** recommended

### Initial Configuration
```bash
# Set static IP (edit /etc/netplan/01-netcfg.yaml or similar)
sudo nano /etc/netplan/01-netcfg.yaml
# Example:
# network:
#   version: 2
#   renderer: networkd
#   ethernets:
#     eno1:
#       addresses:
#         - 192.168.1.100/24
#       routes:
#         - to: default
#           via: 192.168.1.1
#       nameservers:
#         addresses: [1.1.1.1, 8.8.8.8]

sudo netplan apply

# Update system
sudo apt update && sudo apt upgrade -y

# Install basic tools
sudo apt install -y git curl wget unzip ufw
```

---

## Phase 2: Cloudflare Setup

### Step 1: Add Domain to Cloudflare
1. Sign up at [cloudflare.com](https://cloudflare.com) (or log in)
2. Click **Add a Site** → enter `rmpgutah.us`
3. Select **Free** plan
4. Cloudflare will scan existing DNS records
5. Note the nameservers Cloudflare gives you (e.g., `dns1.p06.nsone.net`, etc.)

### Step 2: Change Nameservers at Registrar
1. Go to your domain registrar where `rmpgutah.us` was purchased
2. Find DNS/Nameserver settings
3. Replace current nameservers with the Cloudflare nameservers
4. **Propagation takes 1-48 hours** but usually ~15 minutes

### Step 3: Configure DNS Records in Cloudflare
After nameservers propagate, add these DNS records in Cloudflare Dashboard:

| Type | Name | Content | Proxy Status |
|------|------|---------|--------------|
| CNAME | `@` | `<tunnel-id>.cfargotunnel.com` | Proxied (orange cloud) |
| CNAME | `www` | `rmpgutah.us` | Proxied (orange cloud) |

> Set `@` root record after creating the tunnel in Step 5 below.

### Step 4: Install cloudflared on the Server
```bash
# Download and install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb

# Verify
cloudflared --version
```

### Step 5: Authenticate and Create Tunnel
```bash
# Authenticate cloudflared with your Cloudflare account
cloudflared tunnel login
# This opens a browser — log in to Cloudflare and authorize

# Create a named tunnel
cloudflared tunnel create rmpg-flex
# This creates a credentials file at ~/.cloudflared/<tunnel-id>.json

# Verify
cloudflared tunnel list
```

### Step 6: Configure Tunnel
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: rmpg-flex
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: rmpgutah.us
    service: http://localhost:3001
  - hostname: www.rmpgutah.us
    service: http://localhost:3001
  - service: http_status:404
```

### Step 7: Create DNS Records for Tunnel
```bash
# Point rmpgutah.us and www.rmpgutah.us to the tunnel
cloudflared tunnel route dns rmpg-flex rmpgutah.us
cloudflared tunnel route dns rmpg-flex www.rmpgutah.us
```

### Step 8: Run Tunnel as System Service
```bash
# Install as a systemd service
cloudflared --config /root/.cloudflared/config.yml service install

# Start and enable
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
sudo systemctl status cloudflared

# (Optional) Verify with the webhook receiver if using it:
# cloudflared tunnel route dns rmpg-flex webhook.rmpgutah.us
```

### Step 9: Configure Cloudflare SSL/TLS Settings
In Cloudflare Dashboard → SSL/TLS:
- **Full (strict)** recommended (encrypted all the way)
- Enable **Always Use HTTPS**
- Enable **Automatic HTTPS Rewrites**

Since our server has no SSL certs (`DISABLE_SSL=true`), use **Full** (not Full strict) unless you also set up a Cloudflare origin certificate on the server.

---

## Phase 3: Server Dependencies

### Node.js 22
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
node --version  # Should be v22.x
npm --version
```

### System Packages
```bash
# Build tools
sudo apt install -y build-essential python3 python3-pip

# PDF processing
sudo apt install -y qpdf
sudo apt install -y ocrmypdf tesseract-ocr
sudo apt install -y poppler-utils  # provides pdftotext

# Verify
qpdf --version
pdftotext --version
tesseract --version
```

### (Optional) nginx for Local LAN Access
Not strictly needed since users will access via Cloudflare Tunnel, but nice for local-access polish:

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

Create `/etc/nginx/sites-available/rmpg-flex`:
```nginx
server {
    listen 80;
    server_name localhost 192.168.1.100;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M;
    }
}
```

Enable: `sudo ln -sf /etc/nginx/sites-available/rmpg-flex /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx`

---

## Phase 4: Application Setup

### Clone Repository
```bash
cd /opt
sudo git clone https://github.com/Rocky-Mountain-Protective-Group-LLC/rmpg-flex.git
sudo chown -R rmpg:rmpg /opt/rmpg-flex
```

### Create .env File
```bash
cd /opt/rmpg-flex/server
cp .env.production .env
```

Generate secrets and edit `.env`:
```bash
# Generate JWT secret
openssl rand -hex 64
```

Edit `/opt/rmpg-flex/server/.env`:
```ini
JWT_SECRET=<paste-generated-secret>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
NODE_ENV=production
PORT=3001
DISABLE_SSL=true
PRIMARY_DOMAIN=rmpgutah.us
SSL_HTTP_REDIRECT=false
CORS_ORIGINS=https://rmpgutah.us,https://www.rmpgutah.us,http://localhost:5173,http://localhost:3001
UPDATE_SERVER_URL=https://rmpgutah.us
SERVER_TIMEZONE=America/Denver
```

### Install Dependencies & Build
```bash
cd /opt/rmpg-flex

# Server
cd server && npm ci --legacy-peer-deps && cd ..

# Client
cd client && npm ci && cd ..

# Build client
cd client && npx vite build && cd ..
```

### Create systemd Service
```bash
sudo nano /etc/systemd/system/rmpg-flex.service
```

```ini
[Unit]
Description=RMPG Flex CAD/RMS Server
After=network.target cloudflared.service
Wants=network-online.target

[Service]
Type=simple
User=rmpg
WorkingDirectory=/opt/rmpg-flex
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DISABLE_SSL=true
Environment=HOME=/root
ExecStart=/usr/bin/npx tsx server/src/index.ts
Restart=always
RestartSec=1
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rmpg-flex

[Install]
WantedBy=multi-target.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable rmpg-flex
sudo systemctl start rmpg-flex
sudo systemctl status rmpg-flex

# Verify
curl http://localhost:3001/api/health
```

---

## Phase 5: Firewall Configuration

```bash
# Allow SSH, cloudflared outbound (no inbound ports needed for web)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh

# If using nginx for LAN access:
sudo ufw allow 80/tcp
# Direct Express access for LAN:
sudo ufw allow 3001/tcp

# Enable
sudo ufw --force enable
sudo ufw status verbose
```

---

## Phase 6: Data Migration (if VPS comes back online)

If the old VPS becomes accessible, copy critical data:

```bash
# Database
scp root@194.113.64.90:/opt/rmpg-flex/server/data/rmpg-flex.db /opt/rmpg-flex/server/data/

# Uploads
rsync -az root@194.113.64.90:/opt/rmpg-flex/server/uploads/ /opt/rmpg-flex/server/uploads/

# .env secrets (for JWT_SECRET continuity — prevents TOTP re-enrollment):
scp root@194.113.64.90:/opt/rmpg-flex/server/.env /opt/rmpg-flex/server/.env.bak

# Desktop installers
rsync -az root@194.113.64.90:/opt/rmpg-flex/server/downloads/ /opt/rmpg-flex/server/downloads/
```

Then restart: `sudo systemctl restart rmpg-flex`

If the VPS never comes back:
- The SQLite database is lost unless you have backups
- A fresh database (`server/data/rmpg-flex.db`) will be auto-created on first start
- Users will need new accounts and TOTP re-enrollment
- Uploaded files are lost

---

## Phase 7: Updating the Deployment Pipeline

### Option A: GitHub Actions (Recommended)
Create `.github/workflows/deploy-onprem.yml`:

```yaml
name: Deploy to On-Prem Server
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SERVER_IP }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/rmpg-flex
            git fetch origin main
            git reset --hard origin/main
            cd server && npm ci --legacy-peer-deps && cd ..
            cd client && npm ci && npx vite build && cd ..
            sudo systemctl restart rmpg-flex
            sleep 2
            curl -sf http://localhost:3001/api/health
```

Add repository secrets in GitHub:
- `SERVER_IP` — local IP of on-prem server (e.g., `192.168.1.100`)
- `SERVER_USER` — SSH username (e.g., `rmpg`)
- `SSH_PRIVATE_KEY` — private SSH key for login

### Option B: Update deploy.sh
Edit `deploy/deploy.sh`:
- Change `VPS_IP` to your server's LAN IP
- SSH will only work from within the local network
- Remote deploys require VPN connection

---

## Phase 8: Local Network Access

### Option A: Direct IP Access
Users on the LAN access: `http://192.168.1.100:3001`

### Option B: Local DNS (pfsense/UniFi/pi-hole)
Create a local DNS override:
- `rmpgutah.us` → `192.168.1.100`
- This bypasses Cloudflare for local users (faster, no internet dependency)

### Option C: nginx Reverse Proxy (if installed)
Users access: `http://192.168.1.100` (port 80)

---

## Phase 9: Verification Checklist

After setup, verify everything:

```bash
# 1. Server running
sudo systemctl status rmpg-flex --no-pager -l

# 2. Health endpoint (local)
curl http://localhost:3001/api/health

# 3. cloudflared running
sudo systemctl status cloudflared --no-pager -l

# 4. Tunnel connected
cloudflared tunnel list

# 5. Remote access (from outside network)
curl https://rmpgutah.us/api/health

# 6. WebSocket (used by dispatch console)
# Open browser to https://rmpgutah.us — should load and show login page
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `ERR_EMPTY_RESPONSE` | Express not running | `sudo systemctl restart rmpg-flex && journalctl -u rmpg-flex -n 50` |
| Tunnel shows `Status: DOWN` | cloudflared not running | `sudo systemctl restart cloudflared && journalctl -u cloudflared -n 50` |
| can't reach site over internet | DNS not propagated | `dig +short rmpgutah.us` — should show Cloudflare IPs |
| LAN users can't connect | Firewall blocking | `sudo ufw allow 3001/tcp` |
| WebSocket disconnects | Cloudflare not proxying WS | In Cloudflare Dashboard → Network → enable WebSockets |
| Slow first load | Cloudflare caching cold | First request is slow; subsequent requests are fast |
| Old VPS IP still resolving | DNS cache | Wait for propagation or flush: `sudo systemd-resolve --flush-caches` |
| TOTP/2FA not working after restore | JWT_SECRET changed | Use the original JWT_SECRET from old `.env`. If lost, users re-enroll TOTP |
