#!/bin/bash
# ============================================================
# RMPG Flex — Full Deploy Script (One Command)
# Uploads code to VPS, sets up services if needed, deploys.
#
# Usage:
#   bash deploy/deploy.sh           — Upload code + deploy
#   bash deploy/deploy.sh --all     — Upload code + installers + deploy
#   bash deploy/deploy.sh --setup   — Full VPS setup (first time only)
# ============================================================

set -e

VPS_IP="194.113.64.90"
VPS_USER="root"
APP_DIR="/opt/rmpg-flex"
DOMAIN="rmpgutah.us"

# Get the project root (parent of deploy/)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

UPLOAD_CODE=true
UPLOAD_DOWNLOADS=false
FULL_SETUP=false

case "${1:-}" in
  --all)
    UPLOAD_CODE=true
    UPLOAD_DOWNLOADS=true
    ;;
  --setup)
    UPLOAD_CODE=true
    UPLOAD_DOWNLOADS=true
    FULL_SETUP=true
    ;;
  --downloads)
    UPLOAD_CODE=false
    UPLOAD_DOWNLOADS=true
    ;;
esac

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║        RMPG Flex — Production Deploy            ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  VPS: $VPS_IP                          ║"
echo "║  Dir: $APP_DIR                         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Project: $PROJECT_DIR"
echo ""

# ─── Test SSH Connection ──────────────────────────────────
echo ">>> Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$VPS_USER@$VPS_IP" "echo ok" >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Cannot connect to $VPS_USER@$VPS_IP"
  echo ""
  echo "Fix SSH access first. Options:"
  echo "  1. Copy your SSH key:  ssh-copy-id $VPS_USER@$VPS_IP"
  echo "  2. Or use password:    ssh $VPS_USER@$VPS_IP"
  echo ""
  exit 1
fi
echo "    SSH connection OK"

# ─── Full VPS Setup (first time) ─────────────────────────
if [ "$FULL_SETUP" = true ]; then
  echo ""
  echo ">>> [SETUP] Running first-time VPS setup..."
  ssh "$VPS_USER@$VPS_IP" bash << 'SETUPEOF'
    set -e
    echo ">>> Installing Node.js 22 LTS..."
    if ! command -v node &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y nodejs
    fi
    echo "Node: $(node --version), npm: $(npm --version)"

    echo ">>> Configuring firewall..."
    apt-get install -y ufw >/dev/null 2>&1 || true
    ufw allow OpenSSH >/dev/null 2>&1 || true
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
    ufw --force enable >/dev/null 2>&1 || true

    echo ">>> Creating app directory..."
    mkdir -p /opt/rmpg-flex
    echo ">>> First-time setup complete"
SETUPEOF
fi

# ─── Ensure remote directory exists ──────────────────────
ssh "$VPS_USER@$VPS_IP" "mkdir -p $APP_DIR/server/downloads"

# ─── Upload Code ──────────────────────────────────────────
if [ "$UPLOAD_CODE" = true ]; then
  echo ""
  echo ">>> Uploading RMPG Flex code..."
  rsync -avz --progress \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='server/data/*.db' \
    --exclude='server/data/*.db-wal' \
    --exclude='server/data/*.db-shm' \
    --exclude='server/.env' \
    --exclude='desktop' \
    --exclude='.DS_Store' \
    --exclude='.claude' \
    --exclude='client/android' \
    "$PROJECT_DIR/" "$VPS_USER@$VPS_IP:$APP_DIR/"
  echo ""
  echo ">>> Code upload complete!"
fi

# ─── Upload Installers ────────────────────────────────────
if [ "$UPLOAD_DOWNLOADS" = true ]; then
  echo ""
  echo ">>> Uploading installers (.exe, .dmg, .apk)..."
  rsync -avz --progress \
    "$PROJECT_DIR/server/downloads/" "$VPS_USER@$VPS_IP:$APP_DIR/server/downloads/"
  echo ""
  echo ">>> Installer upload complete!"
fi

# ─── Create deploy script + systemd service + run deploy ──
echo ""
echo ">>> Setting up and deploying on VPS..."
ssh "$VPS_USER@$VPS_IP" bash << 'REMOTEEOF'
  set -e
  APP_DIR="/opt/rmpg-flex"
  DOMAIN="rmpgutah.us"

  # ── Create systemd service if it doesn't exist ──
  if [ ! -f /etc/systemd/system/rmpg-flex.service ]; then
    echo ">>> Creating systemd service..."
    cat > /etc/systemd/system/rmpg-flex.service << 'SVCEOF'
[Unit]
Description=RMPG Flex CAD/RMS Server
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/rmpg-flex
Environment=NODE_ENV=production
Environment=PORT=80
ExecStart=/usr/bin/npx tsx server/src/index.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rmpg-flex

# Allow binding to privileged ports (80, 443)
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
SVCEOF
    systemctl daemon-reload
    systemctl enable rmpg-flex
    echo "    Service created and enabled"
  else
    echo ">>> Systemd service already exists"
  fi

  # ── Deploy ──
  echo ">>> Deploying RMPG Flex..."
  cd "$APP_DIR"

  echo ">>> Installing server dependencies..."
  cd server && npm install --production 2>&1 | tail -3 && cd ..

  echo ">>> Installing client dependencies..."
  cd client && npm install 2>&1 | tail -3 && cd ..

  echo ">>> Building client..."
  cd client && npx vite build 2>&1 | tail -5 && cd ..

  # ── Create .env if missing ──
  if [ ! -f server/.env ]; then
    echo ">>> Generating production .env..."
    JWT_SECRET=$(openssl rand -hex 64)
    cat > server/.env << ENVEOF
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
PORT=80
NODE_ENV=production
PRIMARY_DOMAIN=${DOMAIN}
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
CORS_ORIGINS=http://${DOMAIN},http://194.113.64.90,http://localhost:5173,http://localhost:3001
UPDATE_SERVER_URL=http://194.113.64.90
SERVER_TIMEZONE=America/Denver
ENVEOF
    echo "    Generated .env with new JWT_SECRET"
  else
    echo ">>> .env already exists — keeping current config"
  fi

  # ── Restart service ──
  echo ">>> Restarting RMPG Flex..."
  systemctl restart rmpg-flex

  echo ""
  echo ">>> Waiting for server to start..."
  sleep 3

  # ── Verify ──
  if systemctl is-active --quiet rmpg-flex; then
    echo ""
    echo "╔══════════════════════════════════════════════════╗"
    echo "║     ✓ DEPLOY SUCCESSFUL                         ║"
    echo "╠══════════════════════════════════════════════════╣"
    echo "║  Server:  http://194.113.64.90                  ║"
    echo "║  Status:  RUNNING                               ║"
    echo "║  Logs:    journalctl -u rmpg-flex -f            ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""
    systemctl status rmpg-flex --no-pager -l | head -15
  else
    echo ""
    echo "╔══════════════════════════════════════════════════╗"
    echo "║     ✗ SERVICE FAILED TO START                   ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""
    echo "Recent logs:"
    journalctl -u rmpg-flex --no-pager -n 30
    exit 1
  fi
REMOTEEOF

echo ""
echo ">>> Verifying download endpoints..."

# Quick verification of download API and file serving
sleep 2
DL_INFO=$(curl -sf "http://$VPS_IP/api/downloads/info" 2>/dev/null || echo "")

if [ -n "$DL_INFO" ]; then
  WIN_VER=$(echo "$DL_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('win',{}).get('version','—'))" 2>/dev/null || echo "—")
  MAC_VER=$(echo "$DL_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('mac',{}).get('version','—'))" 2>/dev/null || echo "—")
  APK_VER=$(echo "$DL_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('android',{}).get('version','—'))" 2>/dev/null || echo "—")
  echo "    Windows:  v$WIN_VER"
  echo "    macOS:    v$MAC_VER"
  echo "    Android:  v$APK_VER"
else
  echo "    Warning: Could not reach /api/downloads/info (server may still be starting)"
fi

echo ""
echo ">>> All done! Server is live at http://$VPS_IP"
echo "    Download page: http://$VPS_IP/download"
echo ""
