#!/bin/bash
# Rebuild RMPGFlexTester with swiftc (xcodebuild deadlocks on this Mac — see ios/README.md),
# re-sign with the RMPG-Field team profile, and reinstall/relaunch on the connected iPhone.
# Safe to run anytime: exits quietly if no device is connected or sources are unchanged
# (pass --force to skip the freshness check).
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$IOS_DIR/RMPGFlexTester/RMPGFlexTester"
BUILD=/tmp/FlexDevAuto
APP="$BUILD/RMPGFlexTester.app"
MARKER="$BUILD/.last-refresh"
DEVICE="8A25564E-C3C6-589E-BC84-AF3DB87AFDF2"   # Christian's iPhone 17 Pro
IDENTITY="E18F6177F42535EF1038C17308B5B509331A53CC"
BID="Rocky-Mountain-Protective-Group--LLC..RMPG-Field"
PROFILE="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/17ef3038-fa82-4901-bd5b-48eb91680164.mobileprovision"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

# Freshness: skip if no Swift source is newer than the last successful refresh.
if [[ "${1:-}" != "--force" && -f "$MARKER" ]]; then
  newer=$(find "$SRC" -name '*.swift' -newer "$MARKER" | head -1)
  [[ -z "$newer" ]] && { echo "refresh-device: sources unchanged, skipping"; exit 0; }
fi

# Device connected?
xcrun devicectl list devices 2>/dev/null | grep -q "$DEVICE" || {
  echo "refresh-device: iPhone not connected, skipping"; exit 0; }

mkdir -p "$APP"
xcrun -sdk iphoneos swiftc -target arm64-apple-ios17.0 -O "$SRC"/*.swift -o "$APP/RMPGFlexTester"

cat > "$APP/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>RMPGFlexTester</string>
<key>CFBundleIdentifier</key><string>$BID</string>
<key>CFBundleName</key><string>RMPGFlexTester</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.4</string>
<key>CFBundleVersion</key><string>$(date +%s)</string>
<key>UILaunchScreen</key><dict/>
<key>UIDeviceFamily</key><array><integer>1</integer></array>
<key>MinimumOSVersion</key><string>17.0</string>
<key>NSCameraUsageDescription</key><string>Scan driver license barcodes to relay identity data to your MDT desktop session.</string>
<key>NSFaceIDUsageDescription</key><string>Unlock RMPG Flex with Face ID.</string>
<key>NSMicrophoneUsageDescription</key><string>Record interaction audio as evidence; recording continues while the phone is locked or backgrounded.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>RMPG Flex transcribes your dictation on-device to fill report and workflow narratives.</string>
<key>NSLocationWhenInUseUsageDescription</key><string>Send your unit position to the dispatch map and attach coordinates to panic alerts.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key><string>While on shift, your unit position streams to the dispatch map even when the phone is pocketed, and you get alerts when dispatch assigns you a call.</string>
<key>UIBackgroundModes</key><array><string>location</string><string>audio</string></array>
<key>CFBundleIcons</key><dict>
  <key>CFBundlePrimaryIcon</key><dict>
    <key>CFBundleIconFiles</key><array><string>AppIcon60x60</string></array>
  </dict>
</dict>
</dict></plist>
EOF
cp "$IOS_DIR/RMPGFlexTester/AppIcons/"AppIcon60x60@*.png "$APP/" 2>/dev/null || true

cp "$PROFILE" "$APP/embedded.mobileprovision"
cat > "$BUILD/ent.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>application-identifier</key><string>D3LYU7YCCN.$BID</string>
<key>com.apple.developer.team-identifier</key><string>D3LYU7YCCN</string>
<key>get-task-allow</key><true/>
</dict></plist>
EOF

codesign -f -s "$IDENTITY" --entitlements "$BUILD/ent.plist" "$APP"
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" "$BID" || true
touch "$MARKER"
echo "refresh-device: installed + launched on iPhone"
