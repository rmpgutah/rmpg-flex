#!/bin/bash
# Assemble a throwaway SwiftPM package from the pure-logic workflow sources +
# their tests and run `swift test`. Needed because xcodebuild deadlocks on this
# Mac (see ios/README.md) and the default CommandLineTools toolchain lacks
# XCTest — so we force the Xcode toolchain via DEVELOPER_DIR. Pure-logic files
# import Foundation only (no SwiftUI/UIKit), so they build for the macOS host.
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
IOS="$(cd "$(dirname "$0")" && pwd)"
SRC="$IOS/RMPGFlexTester/RMPGFlexTester"
TST="$IOS/RMPGFlexTester/RMPGFlexTesterTests"
PKG="$(mktemp -d)/WorkflowKit"
mkdir -p "$PKG/Sources/WorkflowKit" "$PKG/Tests/WorkflowKitTests"

SOURCES=(WorkflowModels WorkflowBody WorkflowValidation FieldValidation MultipartBody DictationState WorkflowRegistry MDTMessage OfflineSyncLogic NavStepFormat PhotoBurnLines AlertsFeed AlprResultParse AlprScanLog)
TESTS=(WorkflowModelsTests WorkflowBodyTests WorkflowValidationTests FieldValidationTests MultipartBodyTests WorkflowRegistryTests MDTMessageTests OfflineSyncLogicTests NavStepFormatTests PhotoBurnLinesTests AlertsFeedTests AlprResultParseTests AlprScanLogTests)

for f in "${SOURCES[@]}"; do
  if [ -f "$SRC/$f.swift" ]; then cp "$SRC/$f.swift" "$PKG/Sources/WorkflowKit/"; fi
done
for f in "${TESTS[@]}"; do
  if [ -f "$TST/$f.swift" ]; then
    sed 's/@testable import RMPGFlexTester/@testable import WorkflowKit/' "$TST/$f.swift" > "$PKG/Tests/WorkflowKitTests/$f.swift"
  fi
done

cat > "$PKG/Package.swift" <<'EOF'
// swift-tools-version:5.9
import PackageDescription
let package = Package(
  name: "WorkflowKit",
  targets: [
    .target(name: "WorkflowKit"),
    .testTarget(name: "WorkflowKitTests", dependencies: ["WorkflowKit"]),
  ])
EOF

cd "$PKG" && swift test
