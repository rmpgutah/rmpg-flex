#!/bin/bash
# ============================================================
# RMPG Flex — Full Deploy Script (One Command)
# Uploads code to VPS, sets up services if needed, deploys.
#
# Usage:
#   bash deploy/deploy.sh           — Upload code + deploy
#   bash deploy/deploy.sh --all     — Upload code + installers + deploy
#   bash deploy/deploy.sh --setup   — Full VPS setup (first time only)
#   bash deploy/deploy.sh --ssl     — Install/renew SSL certificates
# ============================================================

set -e

VPS_IP="194.113.64.90"
VPS_USER="root"
APP_DIR="/opt/rmpg-flex"
DOMAIN="rmpgutah.us"
SSH_KEY="$HOME/.ssh/id_ed25519_deploy"

# Use deploy key for all SSH/rsync/scp commands
export GIT_SSH_COMMAND="ssh -i $SSH_KEY"
SSH_OPTS="-i $SSH_KEY"

# Get the project root (parent of deploy/)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

UPLOAD_CODE=true
UPLOAD_DOWNLOADS=false
FULL_SETUP=false
SSL_SETUP=false

case "${1:-}" in
  --all)
    UPLOAD_CODE=true
    UPLOAD_DOWNLOADS=true
    ;;
  --setup)
    UPLOAD_CODE=true
    UPLOAD_DOWNLOADS=true
    FULL_SETUP=true
    SSL_SETUP=true
    ;;
  --downloads)
    UPLOAD_CODE=false
    UPLOAD_DOWNLOADS=true
    ;;
  --ssl)
    UPLOAD_CODE=false
    SSL_SETUP=true
    ;;
esac

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║        RMPG Flex — Production Deploy            ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  VPS: $VPS_IP                          ║"
echo "║  Domain: $DOMAIN                       ║"
echo "║  Dir: $APP_DIR                         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Project: $PROJECT_DIR"
echo ""

# ─── Test SSH Connection ──────────────────────────────────
echo ">>> Testing SSH connection..."
if ! ssh $SSH_OPTS -o ConnectTimeout=5 -o BatchMode=yes "$VPS_USER@$VPS_IP" "echo ok" >/dev/null 2>&1; then
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
  ssh $SSH_OPTS "$VPS_USER@$VPS_IP" bash << 'SETUPEOF'
    set -e

    # Node.js 22 LTS
    if ! command -v node &>/dev/null; then
      echo ">>> Installing Node.js 22..."
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    fi

    # All system packages in one pass
    echo ">>> Installing packages..."
    apt-get install -y -qq nodejs ffmpeg fonts-dejavu-core ufw default-jre-headless unzip 2>&1 | tail -1
    echo "    Node $(node --version)  npm $(npm --version)"

    # Firewall
    echo ">>> Configuring firewall..."
    ufw allow OpenSSH >/dev/null 2>&1
    ufw allow 80/tcp  >/dev/null 2>&1
    ufw allow 443/tcp >/dev/null 2>&1
    ufw allow 5138/udp >/dev/null 2>&1   # Traccar XT2400 GPS
    ufw --force enable >/dev/null 2>&1

    # Traccar GPS Server
    if [ ! -f /opt/traccar/conf/traccar.xml ]; then
      echo ">>> Installing Traccar 6.5..."
      wget -q -P /tmp "https://github.com/traccar/traccar/releases/download/v6.5/traccar-linux-64-6.5.zip" -O /tmp/traccar.zip
      cd /tmp && unzip -o traccar.zip >/dev/null && chmod +x traccar.run && ./traccar.run >/dev/null
      rm -f traccar.zip traccar.run
      systemctl enable --now traccar
      echo "    Traccar 6.5 installed"
    else
      echo "    Traccar already installed"
      systemctl start traccar 2>/dev/null || true
    fi

    mkdir -p /opt/rmpg-flex
    echo ">>> Setup complete"
SETUPEOF
fi

# ─── SSL Certificate Setup ──────────────────────────────
if [ "$SSL_SETUP" = true ]; then
  echo ""
  echo ">>> [SSL] Setting up Let's Encrypt certificates..."
  ssh $SSH_OPTS "$VPS_USER@$VPS_IP" bash << 'SSLEOF'
    set -e
    DOMAIN="rmpgutah.us"
    APP_DIR="/opt/rmpg-flex"

    # Install certbot if not present
    if ! command -v certbot &>/dev/null; then
      echo ">>> Installing certbot..."
      apt-get update -qq
      apt-get install -y certbot
    fi
    echo "    certbot: $(certbot --version 2>&1)"

    # Check if certificate already exists
    if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
      echo ">>> Certificate already exists — attempting renewal..."
      certbot renew --quiet || true
    else
      echo ">>> Obtaining new certificate for $DOMAIN..."

      # Stop the service temporarily so certbot can bind port 80
      systemctl stop rmpg-flex 2>/dev/null || true

      # Request certificate (standalone verification on port 80)
      certbot certonly \
        --standalone \
        -d "$DOMAIN" \
        -d "www.$DOMAIN" \
        --non-interactive \
        --agree-tos \
        --email admin@rmpgutah.us

      echo ">>> Certificate obtained successfully"
    fi

    # Symlink certs to where the RMPG Flex server expects them
    mkdir -p "$APP_DIR/server/certs"
    ln -sf "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$APP_DIR/server/certs/fullchain.pem"
    ln -sf "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$APP_DIR/server/certs/privkey.pem"
    echo "    Certs symlinked to $APP_DIR/server/certs/"

    # Set up auto-renewal cron (runs daily at 3am, restarts server after renewal)
    CRON_LINE="0 3 * * * certbot renew --quiet --post-hook 'systemctl restart rmpg-flex'"
    if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
      (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
      echo "    Auto-renewal cron installed"
    else
      echo "    Auto-renewal cron already exists"
    fi

    # Verify certificates are readable
    if [ -f "$APP_DIR/server/certs/fullchain.pem" ] && [ -f "$APP_DIR/server/certs/privkey.pem" ]; then
      echo ""
      echo "    ✅ SSL certificates ready"
      openssl x509 -in "$APP_DIR/server/certs/fullchain.pem" -noout -dates 2>/dev/null || true
    else
      echo "    ❌ Certificate files not found — SSL may not work"
    fi
SSLEOF
fi

# ─── Ensure remote directory exists ──────────────────────
ssh $SSH_OPTS "$VPS_USER@$VPS_IP" "mkdir -p $APP_DIR/server/downloads"

# ─── Upload Code ──────────────────────────────────────────
if [ "$UPLOAD_CODE" = true ]; then
  echo ""
  echo ">>> Uploading RMPG Flex code..."
  rsync -avz --progress -e "ssh $SSH_OPTS" \
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
  rsync -avz --progress -e "ssh $SSH_OPTS" \
    "$PROJECT_DIR/server/downloads/" "$VPS_USER@$VPS_IP:$APP_DIR/server/downloads/"
  echo ""
  echo ">>> Installer upload complete!"
fi

# ─── Create deploy script + systemd service + run deploy ──
echo ""
echo ">>> Setting up and deploying on VPS..."
ssh $SSH_OPTS "$VPS_USER@$VPS_IP" bash << 'REMOTEEOF'
  set -e
  APP_DIR="/opt/rmpg-flex"
  DOMAIN="rmpgutah.us"

  # ── Detect SSL certificates ──
  HAS_SSL=false
  if [ -f "$APP_DIR/server/certs/fullchain.pem" ] && [ -f "$APP_DIR/server/certs/privkey.pem" ]; then
    HAS_SSL=true
  fi

  # ── Create/update systemd service ──
  echo ">>> Configuring systemd service..."
  if [ "$HAS_SSL" = true ]; then
    # SSL mode: listen on 443, redirect HTTP 80→HTTPS
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
Environment=PORT=443
Environment=SSL_HTTP_REDIRECT=true
Environment=SSL_HTTP_REDIRECT_PORT=80
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
    echo "    Service configured for HTTPS (port 443 + HTTP redirect on 80)"
  else
    # No SSL: listen on port 3001 behind nginx
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
Environment=PORT=3001
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
    echo "    Service configured for HTTP (port 80)"
  fi
  systemctl daemon-reload
  systemctl enable rmpg-flex

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

    if [ "$HAS_SSL" = true ]; then
      PROTOCOL="https"
    else
      PROTOCOL="http"
    fi

    cat > server/.env << ENVEOF
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
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
CORS_ORIGINS=${PROTOCOL}://${DOMAIN},${PROTOCOL}://www.${DOMAIN},http://localhost:5173,http://localhost:3001
UPDATE_SERVER_URL=${PROTOCOL}://${DOMAIN}
SERVER_TIMEZONE=America/Denver
ENVEOF
    echo "    Generated .env (protocol: $PROTOCOL)"
  else
    echo ">>> .env already exists — keeping current config"
    # Update UPDATE_SERVER_URL and CORS_ORIGINS if SSL was just enabled
    if [ "$HAS_SSL" = true ]; then
      if grep -q "http://194.113.64.90" server/.env 2>/dev/null; then
        echo ">>> Updating .env URLs to HTTPS..."
        sed -i "s|UPDATE_SERVER_URL=http://194.113.64.90|UPDATE_SERVER_URL=https://${DOMAIN}|g" server/.env
        sed -i "s|CORS_ORIGINS=http://${DOMAIN},http://194.113.64.90|CORS_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}|g" server/.env
        echo "    Updated .env URLs to HTTPS"
      fi
    fi
  fi

  # ── Restart service ──
  echo ">>> Restarting RMPG Flex..."
  systemctl restart rmpg-flex

  echo ""
  echo ">>> Waiting for server to start..."
  sleep 3

  # ── Verify ──
  if systemctl is-active --quiet rmpg-flex; then
    if [ "$HAS_SSL" = true ]; then
      echo ""
      echo "╔══════════════════════════════════════════════════╗"
      echo "║     ✓ DEPLOY SUCCESSFUL (HTTPS)                 ║"
      echo "╠══════════════════════════════════════════════════╣"
      echo "║  Server:  https://${DOMAIN}                ║"
      echo "║  Status:  RUNNING (SSL enabled)                 ║"
      echo "║  Logs:    journalctl -u rmpg-flex -f            ║"
      echo "╚══════════════════════════════════════════════════╝"
    else
      echo ""
      echo "╔══════════════════════════════════════════════════╗"
      echo "║     ✓ DEPLOY SUCCESSFUL                         ║"
      echo "╠══════════════════════════════════════════════════╣"
      echo "║  Server:  http://194.113.64.90                  ║"
      echo "║  Status:  RUNNING                               ║"
      echo "║  Logs:    journalctl -u rmpg-flex -f            ║"
      echo "╚══════════════════════════════════════════════════╝"
    fi
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

# Quick verification — try HTTPS first, fall back to HTTP
sleep 2
DL_INFO=$(curl -sf "https://$DOMAIN/api/downloads/info" 2>/dev/null || curl -sf "http://$VPS_IP/api/downloads/info" 2>/dev/null || echo "")

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
echo ">>> All done! Server is live at https://$DOMAIN"
echo "    Download page: https://$DOMAIN/download"
echo ""
