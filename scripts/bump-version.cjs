#!/usr/bin/env node
// ============================================================
// RMPG Flex — Semantic Version Bump Script
//
// Usage:
//   node scripts/bump-version.cjs <type> "<summary>" [changes...]
//
// Types:
//   major  — Breaking changes, complete rewrites (X.0.0)
//   minor  — New features, significant enhancements (x.Y.0)
//   patch  — Bug fixes, small tweaks, maintenance (x.y.Z)
//
// Examples:
//   node scripts/bump-version.cjs patch "Fix panic system" "fix:Fixed panic button GPS coordinates" "fix:Fixed talk-back audio relay"
//   node scripts/bump-version.cjs minor "GPS breadcrumb trails" "feature:GPS breadcrumb trail tracking" "feature:Rich data per breadcrumb point"
//   node scripts/bump-version.cjs major "Complete rewrite" "feature:New dispatch engine" "security:JWT refresh tokens"
//
// Change format:  "type:description"
//   Types: feature, enhancement, fix, security, refactor, docs
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.json');
const PACKAGE_PATHS = [
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'client', 'package.json'),
  path.join(ROOT, 'server', 'package.json'),
];

// ─── Parse args ──────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(`
  Usage: node scripts/bump-version.cjs <major|minor|patch> "<summary>" [changes...]

  Examples:
    node scripts/bump-version.cjs patch "Fix login bug" "fix:Fixed auth redirect loop"
    node scripts/bump-version.cjs minor "GPS trails" "feature:GPS breadcrumb trails" "fix:Fixed map rendering"
  `);
  process.exit(1);
}

const bumpType = args[0];
if (!['major', 'minor', 'patch'].includes(bumpType)) {
  console.error(`Error: Type must be "major", "minor", or "patch". Got: "${bumpType}"`);
  process.exit(1);
}

const summary = args[1];
const changeArgs = args.slice(2);

// Parse changes from "type:description" format
const changes = changeArgs.map(arg => {
  const colonIdx = arg.indexOf(':');
  if (colonIdx === -1) {
    return { type: 'feature', description: arg };
  }
  return {
    type: arg.substring(0, colonIdx),
    description: arg.substring(colonIdx + 1),
  };
});

// If no changes provided, add a single entry from the summary
if (changes.length === 0) {
  const autoType = bumpType === 'patch' ? 'fix' : 'feature';
  changes.push({ type: autoType, description: summary });
}

// ─── Read current changelog ──────────────────────────────
let changelog;
try {
  changelog = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf-8'));
} catch {
  changelog = { version: '0.0.0', changelog: [] };
}

const currentVersion = changelog.version || '0.0.0';
const [major, minor, patch] = currentVersion.split('.').map(Number);

// ─── Compute new version ─────────────────────────────────
let newVersion;
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

// ─── Build new changelog entry ───────────────────────────
const today = new Date().toISOString().split('T')[0];
const entry = {
  version: newVersion,
  date: today,
  type: bumpType,
  summary,
  changes,
};

// Prepend to changelog array
changelog.version = newVersion;
changelog.changelog.unshift(entry);

// ─── Write CHANGELOG.json ────────────────────────────────
fs.writeFileSync(CHANGELOG_PATH, JSON.stringify(changelog, null, 2) + '\n');
console.log(`  CHANGELOG.json → v${newVersion}`);

// ─── Update all package.json files ───────────────────────
for (const pkgPath of PACKAGE_PATHS) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    pkg.version = newVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`  ${path.relative(ROOT, pkgPath)} → v${newVersion}`);
  } catch {
    // Package file may not exist
  }
}

// ─── Update desktop package.json if it exists ────────────
const desktopPkgPath = path.join(ROOT, 'desktop', 'package.json');
try {
  const pkg = JSON.parse(fs.readFileSync(desktopPkgPath, 'utf-8'));
  pkg.version = newVersion;
  fs.writeFileSync(desktopPkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  ${path.relative(ROOT, desktopPkgPath)} → v${newVersion}`);
} catch {
  // Desktop package may not exist
}

// ─── Update desktop package-lock.json version fields ─────
const desktopLockPath = path.join(ROOT, 'desktop', 'package-lock.json');
try {
  const lock = JSON.parse(fs.readFileSync(desktopLockPath, 'utf-8'));
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = newVersion;
  }
  fs.writeFileSync(desktopLockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(`  ${path.relative(ROOT, desktopLockPath)} → v${newVersion}`);
} catch {
  // Lock file may not exist
}

// ─── Update Android build.gradle versionName + versionCode ─
const gradlePath = path.join(ROOT, 'client', 'android', 'app', 'build.gradle');
try {
  let gradle = fs.readFileSync(gradlePath, 'utf-8');
  // Bump versionName to new version
  gradle = gradle.replace(/versionName\s+"[\d.]+"/, `versionName "${newVersion}"`);
  // Increment versionCode by 1
  gradle = gradle.replace(/versionCode\s+(\d+)/, (_, code) => `versionCode ${parseInt(code) + 1}`);
  fs.writeFileSync(gradlePath, gradle);
  console.log(`  ${path.relative(ROOT, gradlePath)} → v${newVersion}`);
} catch {
  // Gradle file may not exist
}

// ─── Update download page fallback version strings ───────
const downloadHtmlPath = path.join(ROOT, 'server', 'downloads', 'index.html');
try {
  let html = fs.readFileSync(downloadHtmlPath, 'utf-8');
  // Replace all occurrences of old version with new version in the download page
  html = html.replace(new RegExp(currentVersion.replace(/\./g, '\\.'), 'g'), newVersion);
  fs.writeFileSync(downloadHtmlPath, html);
  console.log(`  ${path.relative(ROOT, downloadHtmlPath)} → v${newVersion}`);
} catch {
  // Download page may not exist
}

// ─── Summary ─────────────────────────────────────────────
console.log(`\n  ✓ Version bumped: ${currentVersion} → ${newVersion} (${bumpType})`);
console.log(`    Summary: ${summary}`);
console.log(`    Changes: ${changes.length} item(s)`);
changes.forEach(c => {
  console.log(`      [${c.type}] ${c.description}`);
});
console.log('');
