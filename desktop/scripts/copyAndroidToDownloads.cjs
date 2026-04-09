#!/usr/bin/env node
/**
 * RMPG Flex — Copy Android APK to server/downloads
 *
 * Copies the built APK from the Capacitor Android build output
 * to the server/downloads directory for distribution.
 *
 * Usage: node desktop/scripts/copyAndroidToDownloads.cjs
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'server', 'downloads');
const ANDROID_BUILD_DIR = path.join(PROJECT_ROOT, 'client', 'android', 'app', 'build', 'outputs', 'apk');

// Read version from desktop/package.json (single source of truth)
const desktopPkg = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'desktop', 'package.json'), 'utf8')
);
const VERSION = desktopPkg.version;

console.log(`\n>>> RMPG Flex — Copy Android APK to Downloads`);
console.log(`    Version: ${VERSION}`);
console.log(`    Build dir: ${ANDROID_BUILD_DIR}`);
console.log(`    Downloads dir: ${DOWNLOADS_DIR}\n`);

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Find the APK file (check release first, then debug)
let apkSource = null;
let apkType = '';

const releaseApk = path.join(ANDROID_BUILD_DIR, 'release', 'app-release.apk');
const debugApk = path.join(ANDROID_BUILD_DIR, 'debug', 'app-debug.apk');

if (fs.existsSync(releaseApk)) {
  apkSource = releaseApk;
  apkType = 'release';
} else if (fs.existsSync(debugApk)) {
  apkSource = debugApk;
  apkType = 'debug';
}

if (!apkSource) {
  console.error('ERROR: No APK found!');
  console.error('  Checked:');
  console.error(`    - ${releaseApk}`);
  console.error(`    - ${debugApk}`);
  console.error('\n  Run "npm run android:build" or "npm run android:build:debug" first.');
  process.exit(1);
}

const apkFilename = `RMPG Flex-${VERSION}.apk`;
const apkDest = path.join(DOWNLOADS_DIR, apkFilename);

// Remove any existing APK versions
const existing = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.apk'));
for (const old of existing) {
  const oldPath = path.join(DOWNLOADS_DIR, old);
  console.log(`  Removing old APK: ${old}`);
  fs.unlinkSync(oldPath);
}

// Copy the new APK
console.log(`  Copying ${apkType} APK → ${apkFilename}`);
fs.copyFileSync(apkSource, apkDest);

const stat = fs.statSync(apkDest);
const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

console.log(`\n>>> Done!`);
console.log(`    ${apkFilename} (${sizeMB} MB)`);
console.log(`    Type: ${apkType}`);
console.log('');
