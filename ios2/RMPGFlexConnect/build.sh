#!/bin/bash
set -euo pipefail

SCHEME="RMPGFlexConnect"
PROJECT="project.yml"
ARCHIVE_PATH="./build/RMPGFlexConnect.xcarchive"
EXPORT_PATH="./build/export"
IPA_PATH="$EXPORT_PATH/RMPGFlexConnect.ipa"
OTA_BASE="https://rmpgutah.us/ios/ota"
TEAM_ID="${APPLE_TEAM_ID:-}"
BUNDLE_ID="com.rmpg.flex.connect"

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
    <string>ad-hoc</string>
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

log ""
log "Wireless OTA install URL:"
log "  itms-services://?action=download-manifest&url=$OTA_BASE/manifest.plist"
log ""
log "OTA package ready at $EXPORT_PATH/ — upload its contents as-is to your web server:"
log "  $EXPORT_PATH/RMPGFlexConnect.ipa → $OTA_BASE/RMPGFlexConnect.ipa"
log "  $EXPORT_PATH/manifest.plist     → $OTA_BASE/manifest.plist"
log "  $EXPORT_PATH/index.html        → $OTA_BASE/index.html"
log "  $EXPORT_PATH/icon-57.png       → $OTA_BASE/icon-57.png"
log "  $EXPORT_PATH/icon-512.png      → $OTA_BASE/icon-512.png"
log ""
log "Test the install page: https://rmpgutah.us/ios/ota/"
