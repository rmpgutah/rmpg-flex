#!/bin/bash
set -euo pipefail

SCHEME="RMPGFlexConnect"
PROJECT="project.yml"
ARCHIVE_PATH="./build/RMPGFlexConnect.xcarchive"
EXPORT_PATH="./build/export"
IPA_PATH="$EXPORT_PATH/RMPGFlexConnect.ipa"
# Served by the Worker's /api/ios-ota route (src/routes/iosOta.ts) reading
# from R2 bucket DOWNLOADS under the ios-ota/ prefix — NOT the Pages static
# site, which can't stream a binary from R2. Must have a WAF managed-challenge
# skip rule (same as /api/health) or itms-services 403s on the device.
OTA_BASE="https://api.rmpgutah.us/api/ios-ota"
TEAM_ID="${APPLE_TEAM_ID:-}"
BUNDLE_ID="com.rmpg.flex.connect"
# "ad-hoc" needs an Apple Distribution cert (paid Developer Program, generated
# in the Apple Developer portal). No such cert exists on this Mac's keychains
# as of 2026-08-22 — only "Apple Development" identities. Default to
# "development" so OTA install works today for UDID-registered devices; flip
# EXPORT_METHOD=ad-hoc once a distribution cert + provisioning profile exist.
EXPORT_METHOD="${EXPORT_METHOD:-development}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[OTA]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

mkdir -p build

if [ -z "$TEAM_ID" ]; then
    warn "APPLE_TEAM_ID not set — will use automatic signing"
fi

if [ ! -f "$PROJECT" ]; then
    warn "project.yml not found — running xcodegen generate"
    if ! command -v xcodegen &>/dev/null; then
        err "xcodegen not found. Install: brew install xcodegen"
    fi
    xcodegen generate
fi

log "Archiving $SCHEME..."
xcodebuild archive \
    -scheme "$SCHEME" \
    -archivePath "$ARCHIVE_PATH" \
    -destination "generic/platform=iOS" \
    -configuration Release \
    -allowProvisioningUpdates \
    ${TEAM_ID:+DEVELOPMENT_TEAM="$TEAM_ID"} \
    CODE_SIGN_STYLE=Automatic \
    2>&1 | tail -30

if [ ! -d "$ARCHIVE_PATH" ]; then
    err "Archive failed — no .xcarchive produced"
fi

log "Exporting IPA..."
xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_PATH" \
    -exportOptionsPlist <(cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>${EXPORT_METHOD}</string>
    <key>teamID</key>
    <string>${TEAM_ID}</string>
    <key>compileBitcode</key>
    <false/>
    <key>uploadSymbols</key>
    <true/>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
PLIST
) 2>&1 | tail -30

if [ ! -f "$IPA_PATH" ]; then
    err "Export failed — no .ipa produced"
fi

log "IPA exported: $IPA_PATH"
IPA_SIZE=$(du -h "$IPA_PATH" | cut -f1)
log "IPA size: $IPA_SIZE"

if command -v xcrun &>/dev/null; then
    log "Verifying IPA signature..."
    xcrun codesign -d --verbose=4 "$IPA_PATH" 2>/dev/null | head -3 || warn "Could not verify signature"
fi

log "Assembling OTA upload package..."
ICON_SRC="App/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
if [ -f "$ICON_SRC" ] && command -v sips &>/dev/null; then
    sips -Z 57 "$ICON_SRC" --out "$EXPORT_PATH/icon-57.png" >/dev/null
    cp "$ICON_SRC" "$EXPORT_PATH/icon-512.png"
else
    warn "Skipping icon generation ($ICON_SRC or sips missing) — manifest icon URLs will 404 until you add them manually."
fi

sed \
    -e "s#__IPA_URL__#$OTA_BASE/RMPGFlexConnect.ipa#g" \
    -e "s#__ICON_57_URL__#$OTA_BASE/icon-57.png#g" \
    -e "s#__ICON_512_URL__#$OTA_BASE/icon-512.png#g" \
    OTA/manifest.plist > "$EXPORT_PATH/manifest.plist"
cp OTA/index.html "$EXPORT_PATH/index.html"

if command -v npx &>/dev/null && [ "${SKIP_R2_UPLOAD:-0}" != "1" ]; then
    log "Uploading OTA package to R2 (DOWNLOADS bucket, ios-ota/ prefix)..."
    for f in RMPGFlexConnect.ipa manifest.plist index.html icon-57.png icon-512.png; do
        if [ -f "$EXPORT_PATH/$f" ]; then
            npx wrangler r2 object put "rmpg-flex-downloads/ios-ota/$f" \
                --file "$EXPORT_PATH/$f" --remote 2>&1 | tail -5
        else
            warn "Skipping upload of $f — not found in $EXPORT_PATH"
        fi
    done
else
    warn "Skipping R2 upload (SKIP_R2_UPLOAD=1 or npx unavailable) — upload $EXPORT_PATH/* to R2 bucket rmpg-flex-downloads under ios-ota/ manually."
fi

log ""
log "Wireless OTA install URL:"
log "  itms-services://?action=download-manifest&url=$OTA_BASE/manifest.plist"
log ""
log "Test the install page: $OTA_BASE/index.html"
log ""
log "⚠️  This link 403s until a Cloudflare WAF managed-challenge SKIP rule exists"
log "    for path eq \"/api/ios-ota\" (or a prefix match), mirroring the existing"
log "    /api/health skip rule documented in CLAUDE.md. That rule lives in the"
log "    Cloudflare dashboard, not in this repo — set it up once per zone."
