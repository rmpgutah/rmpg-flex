#!/bin/bash
# ============================================================
# RMPG Flex — VPS Setup Script
# Run this on a fresh Ubuntu 22.04 VPS as root
# Sets up: Node.js, SSL, firewall, systemd service
# ============================================================

set -e  # Exit on any error

DOMAIN="rmpgutah.us"
APP_DIR="/opt/rmpg-flex"
APP_USER="rmpgflex"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     RMPG Flex — VPS Deployment Setup            ║"
echo "║     Domain: $DOMAIN                        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── 1. System Update ────────────────────────────────
echo ">>> [1/8] Updating system packages..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl wget git ufw software-properties-common build-essential

# ─── 2. Create App User ──────────────────────────────
echo ">>> [2/8] Creating application user..."
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
  echo "Created user: $APP_USER"
else
  echo "User $APP_USER already exists"
fi

# ─── 3. Install Node.js 22 LTS ───────────────────────
echo ">>> [3/8] Installing Node.js 22 LTS..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js $(node --version)"
echo "npm $(npm --version)"

# ─── 4. Firewall Setup ───────────────────────────────
echo ">>> [4/8] Configuring firewall..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "Firewall configured: SSH, HTTP, HTTPS allowed"

# ─── 5. Install Certbot (Let's Encrypt SSL) ──────────
echo ">>> [5/8] Installing Certbot for SSL..."
apt-get install -y certbot

# ─── 6. Create App Directory ─────────────────────────
echo ">>> [6/8] Setting up application directory..."
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"

# ─── 7. Create systemd Service ───────────────────────
echo ">>> [7/8] Creating systemd service..."
cat > /etc/systemd/system/rmpg-flex.service << 'SERVICEEOF'
[Unit]
Description=RMPG Flex CAD/RMS Server
After=network.target nginx.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/rmpg-flex
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DISABLE_SSL=true
ExecStart=/usr/bin/npx tsx server/src/index.ts
Restart=always
RestartSec=1
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rmpg-flex

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable rmpg-flex
echo "Service created and enabled"

# ─── 8. Install deploy helper script ──────────────────
echo ">>> [8/8] Installing deploy script..."
if [ -f "$APP_DIR/deploy/vps-deploy.sh" ]; then
  cp "$APP_DIR/deploy/vps-deploy.sh" /opt/deploy-rmpg.sh
  chmod +x /opt/deploy-rmpg.sh
  echo "Installed /opt/deploy-rmpg.sh from repo"
else
  echo "WARNING: $APP_DIR/deploy/vps-deploy.sh not found — deploy script not installed"
  echo "Upload code first, then re-run: cp $APP_DIR/deploy/vps-deploy.sh /opt/deploy-rmpg.sh && chmod +x /opt/deploy-rmpg.sh"
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     ✓ VPS SETUP COMPLETE                        ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  Next steps:                                     ║"
echo "║                                                  ║"
echo "║  1. Clone the repo to /opt/rmpg-flex:            ║"
echo "║     cd /opt && git clone <repo-url> rmpg-flex    ║"
echo "║                                                  ║"
echo "║  2. Get SSL certificate:                         ║"
echo "║     certbot certonly --standalone \               ║"
echo "║       -d rmpgutah.us -d www.rmpgutah.us          ║"
echo "║                                                  ║"
echo "║  3. Run the deploy script:                       ║"
echo "║     /opt/deploy-rmpg.sh                          ║"
echo "║                                                  ║"
echo "║  4. Set up webhook (optional):                   ║"
echo "║     openssl rand -hex 32 > /opt/rmpg-flex/.webhook-secret ║"
echo "║     cp /opt/rmpg-flex/deploy/rmpg-webhook.service \       ║"
echo "║        /etc/systemd/system/                      ║"
echo "║     systemctl enable --now rmpg-webhook          ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
