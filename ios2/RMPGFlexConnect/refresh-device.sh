#!/usr/bin/env bash
# Reinstall RMPG Flex Connect on the first connected iPhone via Xcode.
# Requires Xcode + the `xcrun` toolchain. CLI builds bypass the Xcode GUI deadlock noted in ios/README.md.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

DEVICE_ID="$(xcrun devicectl list devices --quiet --json-output - 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(dev["identifier"]) for dev in d.get("result",{}).get("devices",[]) if dev.get("connectionProperties",{}).get("pairingState")=="paired"]' | head -n1)"

if [ -z "${DEVICE_ID}" ]; then
    echo "❌ No paired iPhone found. Connect a device and try again."
    exit 1
fi

echo "→ Building for device ${DEVICE_ID}..."
xcodebuild -scheme RMPGFlexConnect \
    -destination "id=${DEVICE_ID}" \
    -configuration Debug \
    -derivedDataPath .build \
    build

APP_PATH="$(find .build -name "RMPGFlexConnect.app" -type d | head -n1)"
echo "→ Installing ${APP_PATH}..."
xcrun devicectl device install app --device "${DEVICE_ID}" "${APP_PATH}"

echo "✅ Installed. Launch from the home screen."
