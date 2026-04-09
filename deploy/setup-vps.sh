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
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=rmpgflex
Group=rmpgflex
WorkingDirectory=/opt/rmpg-flex
Environment=NODE_ENV=production
Environment=PORT=3001
ExecStart=/usr/bin/npx tsx server/src/index.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rmpg-flex

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/rmpg-flex

# Allow binding to privileged ports (80, 443)
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable rmpg-flex
echo "Service created and enabled"

# ─── 8. Create deploy helper script ──────────────────
echo ">>> [8/8] Creating deploy helper script..."
cat > /opt/deploy-rmpg.sh << 'DEPLOYEOF'
#!/bin/bash
# Run this script after uploading new code to /opt/rmpg-flex
set -e
APP_DIR="/opt/rmpg-flex"
DOMAIN="rmpgutah.us"

echo ">>> Deploying RMPG Flex..."

cd "$APP_DIR"

# Install dependencies
echo "Installing server dependencies..."
cd server && npm install --production && cd ..
echo "Installing client dependencies..."
cd client && npm install && cd ..

# Build client
echo "Building client..."
cd client && npx vite build && cd ..

# Set up production .env if it doesn't exist
if [ ! -f server/.env ]; then
  echo "Creating production .env..."
  JWT_SECRET=$(openssl rand -hex 64)
  cat > server/.env << ENVEOF
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
PORT=3001
NODE_ENV=production
PRIMARY_DOMAIN=${DOMAIN}
SSL_CERT_PATH=/etc/letsencrypt/live/${DOMAIN}/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/${DOMAIN}/privkey.pem
HTTPS_PORT=443
SSL_HTTP_REDIRECT=true
SSL_HTTP_REDIRECT_PORT=80
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=15
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=1000
PASSWORD_MIN_LENGTH=8
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_LOWERCASE=true
PASSWORD_REQUIRE_NUMBER=true
PASSWORD_REQUIRE_SPECIAL=false
SESSION_MAX_PER_USER=5
CORS_ORIGINS=https://${DOMAIN},http://${DOMAIN},https://www.${DOMAIN},http://localhost:5173,http://localhost:3001
UPDATE_SERVER_URL=https://${DOMAIN}
SERVER_TIMEZONE=America/Denver
ENVEOF
  echo "Generated .env with new JWT_SECRET"
else
  echo ".env already exists — keeping current config"
fi

# Fix ownership
chown -R rmpgflex:rmpgflex "$APP_DIR"

# Restart service
echo "Restarting RMPG Flex service..."
systemctl restart rmpg-flex

echo ""
echo ">>> Deploy complete! Checking service status..."
sleep 2
systemctl status rmpg-flex --no-pager -l
echo ""
echo "View logs: journalctl -u rmpg-flex -f"
DEPLOYEOF

chmod +x /opt/deploy-rmpg.sh

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     ✓ VPS SETUP COMPLETE                        ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  Next steps:                                     ║"
echo "║                                                  ║"
echo "║  1. Upload your code to /opt/rmpg-flex           ║"
echo "║     (from your Mac, run the scp command below)   ║"
echo "║                                                  ║"
echo "║  2. Get SSL certificate:                         ║"
echo "║     certbot certonly --standalone \               ║"
echo "║       -d rmpgutah.us -d www.rmpgutah.us          ║"
echo "║                                                  ║"
echo "║  3. Run the deploy script:                       ║"
echo "║     /opt/deploy-rmpg.sh                          ║"
echo "║                                                  ║"
echo "║  4. Update DNS A record to: $(curl -s ifconfig.me) ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
