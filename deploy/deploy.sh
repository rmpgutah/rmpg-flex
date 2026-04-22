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

# ─── Deploy Lock (Gotcha #43 — prevent parallel worktree clobbers) ──
# Holds /tmp/rmpg-deploy.lock on the VPS for the duration of this deploy.
# A stale lock older than 15 min is auto-cleared. Other deploys running
# concurrently fail fast instead of racing.
LOCK_FILE="/tmp/rmpg-deploy.lock"
LOCK_ID="$(hostname)-$$-$(date +%s)"
LOCK_MAX_AGE_SEC=900

echo ">>> Acquiring deploy lock..."
LOCK_RESULT=$(ssh "$VPS_USER@$VPS_IP" "bash -s" <<LOCKEOF
  set -e
  if [ -f "$LOCK_FILE" ]; then
    AGE=\$(( \$(date +%s) - \$(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0) ))
    if [ "\$AGE" -lt "$LOCK_MAX_AGE_SEC" ]; then
      HOLDER=\$(cat "$LOCK_FILE" 2>/dev/null || echo unknown)
      echo "BUSY: held by \$HOLDER (age \${AGE}s)"
      exit 1
    else
      echo "STALE: clearing lock (age \${AGE}s > ${LOCK_MAX_AGE_SEC}s)"
    fi
  fi
  echo "$LOCK_ID" > "$LOCK_FILE"
  echo "OK"
LOCKEOF
) || {
  echo ""
  echo "ERROR: Another deploy is in progress on the VPS."
  echo "       $LOCK_RESULT"
  echo ""
  echo "If you're sure no other deploy is running, clear the stale lock:"
  echo "  ssh $VPS_USER@$VPS_IP 'rm $LOCK_FILE'"
  echo ""
  exit 1
}
echo "    Lock acquired: $LOCK_ID"

# Release lock on exit regardless of success/failure
trap 'ssh "$VPS_USER@$VPS_IP" "[ \"\$(cat $LOCK_FILE 2>/dev/null)\" = \"$LOCK_ID\" ] && rm -f $LOCK_FILE" >/dev/null 2>&1 || true' EXIT

# ─── Pre-deploy Quality Gates ────────────────────────────
# Self-heal in worktrees: if node_modules is missing, install before gating
# so the gate fails on *code quality*, not on setup.
ensure_deps() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "    (installing $dir deps — worktree missing node_modules)"
    (cd "$dir" && npm install --silent --no-audit --no-fund) \
      || { echo "FAILED: npm install in $dir — fix before deploying"; exit 1; }
  fi
}

if [ "$UPLOAD_CODE" = true ]; then
  echo ""
  echo ">>> Running pre-deploy quality gates..."
  ensure_deps "$PROJECT_DIR/client"
  ensure_deps "$PROJECT_DIR/server"

  echo "    [1/4] Server typecheck..."
  (cd "$PROJECT_DIR/server" && npx tsc --noEmit) || { echo "FAILED: Server typecheck errors — fix before deploying"; exit 1; }
  echo "          ✓ Server types OK"

  echo "    [2/4] Client typecheck..."
  (cd "$PROJECT_DIR/client" && npx tsc --noEmit) || { echo "FAILED: Client typecheck errors — fix before deploying"; exit 1; }
  echo "          ✓ Client types OK"

  echo "    [3/4] Server tests (461 tests across 39 files)..."
  (cd "$PROJECT_DIR/server" && npm test --silent) || { echo "FAILED: Server tests — run 'cd server && npx vitest run' to see failures"; exit 1; }
  echo "          ✓ Server tests pass"

  echo "    [4/4] Client tests..."
  (cd "$PROJECT_DIR/client" && npm test --silent) || { echo "FAILED: Client tests — run 'cd client && npx vitest run' to see failures"; exit 1; }
  echo "          ✓ Client tests pass"

  echo ""
  echo "    All quality gates passed ✓"
fi

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

# ─── SSL Certificate Setup ──────────────────────────────
if [ "$SSL_SETUP" = true ]; then
  echo ""
  echo ">>> [SSL] Setting up Let's Encrypt certificates..."
  ssh "$VPS_USER@$VPS_IP" bash << 'SSLEOF'
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
ssh "$VPS_USER@$VPS_IP" "mkdir -p $APP_DIR/server/downloads"

# ─── Upload Code ──────────────────────────────────────────
if [ "$UPLOAD_CODE" = true ]; then
  echo ""
  echo ">>> Uploading RMPG Flex code..."
  rsync -avz --progress \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='server/data' \
    --exclude='server/certs' \
    --exclude='server/.env' \
    --exclude='server/uploads' \
    --exclude='client/.env' \
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

  # ── Detect SSL certificates ──
  HAS_SSL=false
  if [ -f "$APP_DIR/server/certs/fullchain.pem" ] && [ -f "$APP_DIR/server/certs/privkey.pem" ]; then
    HAS_SSL=true
  fi

  # ── Detect nginx reverse proxy ──
  HAS_NGINX=false
  if systemctl is-active --quiet nginx 2>/dev/null && \
     (nginx -T 2>/dev/null | grep -q "proxy_pass.*127.0.0.1:3001" || \
      nginx -T 2>/dev/null | grep -q "proxy_pass.*localhost:3001"); then
    HAS_NGINX=true
  fi

  # ── Create/update systemd service ──
  # Flex runs behind nginx on port 3001 (nginx handles SSL on 80/443)
  echo ">>> Configuring systemd service..."
  if [ "$HAS_NGINX" = true ]; then
    # Nginx proxy mode: nginx handles SSL on 443, Node listens on 3001
    cat > /etc/systemd/system/rmpg-flex.service << 'SVCEOF'
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
SVCEOF
    echo "    Service configured for nginx proxy mode (port 3001, SSL disabled)"
  elif [ "$HAS_SSL" = true ]; then
    # SSL mode: listen on 443, redirect HTTP 80→HTTPS
    cat > /etc/systemd/system/rmpg-flex.service << 'SVCEOF'
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
ExecStart=/usr/bin/npx tsx server/src/index.ts
Restart=always
RestartSec=1
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rmpg-flex

[Install]
WantedBy=multi-user.target
SVCEOF
    echo "    Service configured for HTTPS (port 443 + HTTP redirect on 80)"
  else
    # No SSL: listen on port 80
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
RestartSec=1
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
  cd server
  if [ -f package-lock.json ]; then
    # Production still boots via `npx tsx server/src/index.ts`, so keep tsx available.
    npm ci
  else
    npm install
  fi
  cd ..

  echo ">>> Installing client dependencies..."
  cd client
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
  cd ..

  echo ">>> Building client..."
  cd client && npx vite build && cd ..

  # ── Create .env if missing ──
  if [ ! -f server/.env ]; then
    echo ">>> Generating production .env..."
    JWT_SECRET=$(openssl rand -hex 64)
    TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)

    cat > server/.env << ENVEOF
JWT_SECRET=${JWT_SECRET}
TOTP_ENCRYPTION_KEY=${TOTP_ENCRYPTION_KEY}
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
NODE_ENV=production
PORT=3001
SSL_HTTP_REDIRECT=false
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
CORS_ORIGINS=https://${DOMAIN},https://www.${DOMAIN},https://crm.rmpgutah.us,http://localhost:5173,http://localhost:3001
UPDATE_SERVER_URL=https://${DOMAIN}
SERVER_TIMEZONE=America/Denver
ENVEOF
    echo "    Generated .env with port 3001 (behind nginx)"
  else
    echo ">>> .env already exists — keeping current config"
    # Ensure CORS includes CRM domain
    if ! grep -q "crm.rmpgutah.us" server/.env 2>/dev/null; then
      echo ">>> Adding crm.rmpgutah.us to CORS_ORIGINS..."
      sed -i "s|CORS_ORIGINS=\(.*\)|CORS_ORIGINS=\1,https://crm.rmpgutah.us|g" server/.env
    fi
    # Ensure port is 3001
    grep -q '^PORT=' server/.env && sed -i 's/^PORT=.*/PORT=3001/' server/.env || echo 'PORT=3001' >> server/.env
    grep -q '^SSL_HTTP_REDIRECT=' server/.env && sed -i 's/^SSL_HTTP_REDIRECT=.*/SSL_HTTP_REDIRECT=false/' server/.env || echo 'SSL_HTTP_REDIRECT=false' >> server/.env
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
