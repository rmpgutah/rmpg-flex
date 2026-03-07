#!/bin/bash
# ============================================================
# RMPG Flex — Full Release Deploy (All Platforms)
#
# Builds desktop (Mac/Win), Android, and web client,
# stages all installers, deploys everything to VPS,
# and verifies all download links work.
#
# Usage:
#   bash deploy/deploy-all.sh                    # Build all + deploy
#   bash deploy/deploy-all.sh --bump patch       # Version bump first
#   bash deploy/deploy-all.sh --bump minor       # Minor version bump
#   bash deploy/deploy-all.sh --bump major       # Major version bump
#   bash deploy/deploy-all.sh --skip-desktop     # Skip Mac/Win builds
#   bash deploy/deploy-all.sh --skip-android     # Skip Android build
#   bash deploy/deploy-all.sh --skip-build       # Deploy existing builds
# ============================================================

set -e

VPS_IP="194.113.64.90"
VPS_USER="root"
APP_DIR="/opt/rmpg-flex"

# Get project root (parent of deploy/)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ─── Parse Arguments ────────────────────────────────────
BUMP_TYPE=""
SKIP_DESKTOP=false
SKIP_ANDROID=false
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)
      BUMP_TYPE="$2"
      shift 2
      ;;
    --skip-desktop)
      SKIP_DESKTOP=true
      shift
      ;;
    --skip-android)
      SKIP_ANDROID=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo ""
      echo "Usage:"
      echo "  bash deploy/deploy-all.sh                    # Build all + deploy"
      echo "  bash deploy/deploy-all.sh --bump patch       # Version bump first"
      echo "  bash deploy/deploy-all.sh --skip-desktop     # Skip Mac/Win builds"
      echo "  bash deploy/deploy-all.sh --skip-android     # Skip Android build"
      echo "  bash deploy/deploy-all.sh --skip-build       # Deploy existing builds only"
      exit 1
      ;;
  esac
done

# ─── Read current version ────────────────────────────────
VERSION=$(node -p "require('./package.json').version")

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     RMPG Flex — Full Release Deploy                 ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Current Version: v$VERSION                          "
echo "║  VPS: $VPS_IP                                        "
echo "║  Skip Desktop: $SKIP_DESKTOP                         "
echo "║  Skip Android: $SKIP_ANDROID                         "
echo "║  Skip Build:   $SKIP_BUILD                           "
if [ -n "$BUMP_TYPE" ]; then
echo "║  Version Bump:  $BUMP_TYPE                           "
fi
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ─── Step 1: Test SSH Connection ────────────────────────
echo ">>> [1/9] Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$VPS_USER@$VPS_IP" "echo ok" >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Cannot connect to $VPS_USER@$VPS_IP"
  echo "Fix SSH access first: ssh-copy-id $VPS_USER@$VPS_IP"
  exit 1
fi
echo "    SSH connection OK"

# ─── Pre-deploy Quality Gates ────────────────────────────
echo ""
echo ">>> Running pre-deploy quality gates..."

echo "    [1/3] Client typecheck..."
(cd "$PROJECT_DIR/client" && npx tsc --noEmit) || { echo "FAILED: Client typecheck errors — fix before deploying"; exit 1; }
echo "          ✓ Client types OK"

echo "    [2/3] Server tests..."
(cd "$PROJECT_DIR/server" && npm test --silent) || { echo "FAILED: Server tests — fix before deploying"; exit 1; }
echo "          ✓ Server tests pass"

echo "    [3/3] Client tests..."
(cd "$PROJECT_DIR/client" && npm test --silent) || { echo "FAILED: Client tests — fix before deploying"; exit 1; }
echo "          ✓ Client tests pass"

echo ""
echo "    All quality gates passed ✓"

# ─── Step 2: Version Bump (optional) ────────────────────
if [ -n "$BUMP_TYPE" ]; then
  echo ""
  echo ">>> [2/9] Bumping version ($BUMP_TYPE)..."
  node scripts/bump-version.cjs "$BUMP_TYPE" "Release $BUMP_TYPE update"
  VERSION=$(node -p "require('./package.json').version")
  echo "    New version: v$VERSION"
else
  echo ""
  echo ">>> [2/9] Skipping version bump (use --bump patch|minor|major)"
fi

# ─── Step 3: Sync Versions ──────────────────────────────
echo ""
echo ">>> [3/9] Syncing versions across packages..."
node desktop/scripts/syncVersion.cjs
echo "    All packages synced to v$VERSION"

# ─── Step 4: Build Client ───────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo ">>> [4/9] Building client (Vite)..."
  cd client && npx vite build 2>&1 | tail -5 && cd ..
  echo "    Client build complete"
else
  echo ""
  echo ">>> [4/9] Skipping client build (--skip-build)"
fi

# ─── Step 5: Build Desktop (Mac + Windows) ──────────────
if [ "$SKIP_BUILD" = false ] && [ "$SKIP_DESKTOP" = false ]; then
  echo ""
  echo ">>> [5/9] Building desktop installers..."

  echo "    Building macOS DMG..."
  cd desktop && npx electron-builder --mac 2>&1 | grep -E "building|skipped|completed|error" | head -10 && cd ..

  echo "    Building Windows EXE..."
  cd desktop && npx electron-builder --win 2>&1 | grep -E "building|skipped|completed|error" | head -10 && cd ..

  echo "    Copying installers to server/downloads/..."
  node desktop/scripts/copyToDownloads.cjs 2>&1 | grep -E "Copied|Removed|Done"
  echo "    Desktop installers ready"
else
  echo ""
  echo ">>> [5/9] Skipping desktop build"
fi

# ─── Step 6: Build Android ──────────────────────────────
if [ "$SKIP_BUILD" = false ] && [ "$SKIP_ANDROID" = false ]; then
  echo ""
  echo ">>> [6/9] Building Android APK..."

  echo "    Syncing Capacitor..."
  cd client && npx cap sync android 2>&1 | tail -3 && cd ..

  # Check if Java/Gradle is available
  if java -version >/dev/null 2>&1; then
    echo "    Building APK (Gradle)..."
    cd client/android && ./gradlew assembleDebug 2>&1 | tail -5 && cd ../..
    echo "    Copying APK to server/downloads/..."
    node desktop/scripts/copyAndroidToDownloads.cjs 2>&1 | grep -E "Copying|Done|Removing"
    echo "    Android APK ready"
  else
    echo "    WARNING: Java not found — skipping APK build"
    echo "    Existing APK in server/downloads/ will be deployed"
    # Still copy if there's a pre-built APK
    if ls client/android/app/build/outputs/apk/*/app-*.apk >/dev/null 2>&1; then
      node desktop/scripts/copyAndroidToDownloads.cjs 2>&1 | grep -E "Copying|Done|Removing" || true
    fi
  fi
else
  echo ""
  echo ">>> [6/9] Skipping Android build"
fi

# ─── Step 7: Show what we're deploying ──────────────────
echo ""
echo ">>> [7/9] Installer inventory:"
echo "    ──────────────────────────────────────"
for f in server/downloads/*.exe server/downloads/*.dmg server/downloads/*.apk; do
  if [ -f "$f" ]; then
    SIZE=$(du -sh "$f" | cut -f1)
    echo "    $(basename "$f")  ($SIZE)"
  fi
done
echo "    ──────────────────────────────────────"

# ─── Step 8: Deploy to VPS ──────────────────────────────
echo ""
echo ">>> [8/9] Deploying to VPS ($VPS_IP)..."

# Ensure remote directory exists
ssh "$VPS_USER@$VPS_IP" "mkdir -p $APP_DIR/server/downloads"

echo "    Uploading code..."
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='server/data' \
  --exclude='server/certs' \
  --exclude='server/.env' \
  --exclude='server/uploads' \
  --exclude='desktop' \
  --exclude='.DS_Store' \
  --exclude='.claude' \
  --exclude='client/android' \
  "$PROJECT_DIR/" "$VPS_USER@$VPS_IP:$APP_DIR/"
echo "    Code uploaded"

echo "    Uploading installers..."
rsync -az --delete \
  --exclude='downloads' \
  "$PROJECT_DIR/server/downloads/" "$VPS_USER@$VPS_IP:$APP_DIR/server/downloads/"
echo "    Installers uploaded"

echo "    Installing dependencies + restarting server..."
ssh "$VPS_USER@$VPS_IP" bash << 'REMOTEEOF'
  set -e
  APP_DIR="/opt/rmpg-flex"
  cd "$APP_DIR"

  # Install server dependencies
  cd server && npm install --production 2>&1 | tail -2 && cd ..

  # Build client on VPS (in case we deployed source only)
  cd client && npm install 2>&1 | tail -2 && npx vite build 2>&1 | tail -3 && cd ..

  # Restart service
  systemctl restart rmpg-flex

  echo "    Server restarted"
REMOTEEOF

echo "    Waiting for server to start..."
sleep 4

# ─── Step 9: Verify Production ──────────────────────────
echo ""
echo ">>> [9/9] Verifying production deployment..."

VERIFY_PASS=true

# Check downloads info API
echo ""
echo "    Checking /api/downloads/info..."
DL_INFO=$(curl -sf "http://$VPS_IP/api/downloads/info" 2>/dev/null || echo "FAILED")

if [ "$DL_INFO" = "FAILED" ]; then
  echo "    FAIL: /api/downloads/info not reachable"
  VERIFY_PASS=false
else
  WIN_VER=$(echo "$DL_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('win',{}).get('version','MISSING'))" 2>/dev/null || echo "PARSE_ERROR")
  MAC_VER=$(echo "$DL_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('mac',{}).get('version','MISSING'))" 2>/dev/null || echo "PARSE_ERROR")
  APK_VER=$(echo "$DL_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('android',{}).get('version','MISSING'))" 2>/dev/null || echo "PARSE_ERROR")
  WIN_FILE=$(echo "$DL_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('win',{}).get('filename',''))" 2>/dev/null || echo "")
  MAC_FILE=$(echo "$DL_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('mac',{}).get('filename',''))" 2>/dev/null || echo "")
  APK_FILE=$(echo "$DL_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('android',{}).get('filename',''))" 2>/dev/null || echo "")

  echo "    Windows:  v$WIN_VER"
  echo "    macOS:    v$MAC_VER"
  echo "    Android:  v$APK_VER"
fi

# Check download links return 200
echo ""
echo "    Checking download links..."
for FILE_VAR in "$WIN_FILE" "$MAC_FILE" "$APK_FILE"; do
  if [ -n "$FILE_VAR" ]; then
    ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$FILE_VAR'))" 2>/dev/null)
    HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' "http://$VPS_IP/downloads/$ENCODED" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      echo "    OK   $FILE_VAR"
    else
      echo "    FAIL $FILE_VAR (HTTP $HTTP_CODE)"
      VERIFY_PASS=false
    fi
  fi
done

# Check update API for all platforms
echo ""
echo "    Checking update API..."
for PLATFORM in android win32 darwin; do
  UPD_VER=$(curl -sf "http://$VPS_IP/api/updates/check?platform=$PLATFORM&currentVersion=0.0.0" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('latestVersion','FAILED'))" 2>/dev/null || echo "FAILED")
  LABEL="Android"
  [ "$PLATFORM" = "win32" ] && LABEL="Windows"
  [ "$PLATFORM" = "darwin" ] && LABEL="macOS  "
  echo "    $LABEL update check → v$UPD_VER"
done

# Check download page
DL_PAGE=$(curl -so /dev/null -w '%{http_code}' "http://$VPS_IP/download" 2>/dev/null || echo "000")
echo ""
echo "    Download page (/download) → HTTP $DL_PAGE"

# ─── Summary ────────────────────────────────────────────
echo ""
if [ "$VERIFY_PASS" = true ]; then
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║     RELEASE DEPLOYED SUCCESSFULLY                   ║"
  echo "╠══════════════════════════════════════════════════════╣"
  echo "║  Version:  v$VERSION                                 "
  echo "║  Server:   http://$VPS_IP                            "
  echo "║  Download: http://$VPS_IP/download                   "
  echo "║                                                      "
  echo "║  Platforms:                                          "
  echo "║    Windows → v$WIN_VER                               "
  echo "║    macOS   → v$MAC_VER                               "
  echo "║    Android → v$APK_VER                               "
  echo "║                                                      "
  echo "║  All download links verified OK                      "
  echo "╚══════════════════════════════════════════════════════╝"
else
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║     DEPLOY COMPLETE — SOME CHECKS FAILED            ║"
  echo "╠══════════════════════════════════════════════════════╣"
  echo "║  Review the warnings above.                          "
  echo "║  Server may need time to start, or files are missing."
  echo "║  Check logs: ssh root@$VPS_IP journalctl -u rmpg-flex -f"
  echo "╚══════════════════════════════════════════════════════╝"
fi
echo ""
