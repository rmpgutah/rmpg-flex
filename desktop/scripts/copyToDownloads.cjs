// ============================================================
// copyToDownloads.cjs — Post-build installer deployment
// Copies built installers + blockmap + YAML files from
// desktop/dist/ to server/downloads/ for auto-update serving.
// Removes old version installers to keep only the latest.
// ============================================================

const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DOWNLOADS_DIR = path.resolve(__dirname, '..', '..', 'server', 'downloads');

// Ensure downloads dir exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// File patterns to copy
const COPY_PATTERNS = [
  /\.dmg$/,
  /\.exe$/,
  /\.blockmap$/,
  /latest\.yml$/,
  /latest-mac\.yml$/,
];

// File patterns to clean from downloads (old versions)
const CLEAN_PATTERNS = [
  /\.dmg$/,
  /\.exe$/,
  /\.blockmap$/,
  /latest\.yml$/,
  /latest-mac\.yml$/,
];

console.log('[DEPLOY] Copying build artifacts to server/downloads/');
console.log(`[DEPLOY] Source: ${DIST_DIR}`);
console.log(`[DEPLOY] Destination: ${DOWNLOADS_DIR}`);

// Clean old installers from downloads dir (keep index.html and other non-installer files)
const existingFiles = fs.readdirSync(DOWNLOADS_DIR);
for (const file of existingFiles) {
  if (CLEAN_PATTERNS.some(pattern => pattern.test(file))) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    fs.unlinkSync(filePath);
    console.log(`[DEPLOY] Removed old: ${file}`);
  }
}

// Copy only the LATEST version of each file type from dist
if (!fs.existsSync(DIST_DIR)) {
  console.error('[DEPLOY] ERROR: dist/ directory not found. Run build first.');
  process.exit(1);
}

/** Extract semver from filename, return null if not found. */
function extractVersion(filename) {
  const match = filename.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/** Compare two semver strings. Returns >0 if a > b. */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// Find the latest version of each installer type
const distFiles = fs.readdirSync(DIST_DIR);
const latest = { exe: null, dmg: null, blockmap_exe: null, blockmap_dmg: null, yml: [], yaml: [] };

for (const file of distFiles) {
  const filePath = path.join(DIST_DIR, file);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) continue;
  if (!COPY_PATTERNS.some(p => p.test(file))) continue;

  const version = extractVersion(file);

  if (file.endsWith('.exe') && !file.includes('blockmap')) {
    if (!latest.exe || (version && (!latest.exe.version || compareVersions(version, latest.exe.version) > 0))) {
      latest.exe = { file, version };
    }
  } else if (file.endsWith('.exe.blockmap')) {
    if (!latest.blockmap_exe || (version && (!latest.blockmap_exe.version || compareVersions(version, latest.blockmap_exe.version) > 0))) {
      latest.blockmap_exe = { file, version };
    }
  } else if (file.endsWith('.dmg') && !file.includes('blockmap')) {
    if (!latest.dmg || (version && (!latest.dmg.version || compareVersions(version, latest.dmg.version) > 0))) {
      latest.dmg = { file, version };
    }
  } else if (file.endsWith('.dmg.blockmap')) {
    if (!latest.blockmap_dmg || (version && (!latest.blockmap_dmg.version || compareVersions(version, latest.blockmap_dmg.version) > 0))) {
      latest.blockmap_dmg = { file, version };
    }
  } else if (file.endsWith('.yml') || file.endsWith('.yaml')) {
    latest.yml.push(file);
  }
}

// Copy only the latest files
const toCopy = [
  latest.exe, latest.dmg, latest.blockmap_exe, latest.blockmap_dmg,
].filter(Boolean).map(e => e.file).concat(latest.yml);

// Hyphenate spaces on copy so on-disk names match the URLs in latest.yml /
// latest-mac.yml (electron-builder emits hyphenated URLs in the manifest
// but writes space-separated filenames to dist/). Without this, Windows
// auto-update 404s when fetching the .exe from the URL in the manifest.
// YAML manifests stay as-is — their own names are already hyphen-free.
const hyphenate = (name) => (name.endsWith('.yml') || name.endsWith('.yaml'))
  ? name
  : name.replace(/ /g, '-');

let copied = 0;
for (const file of toCopy) {
  const src = path.join(DIST_DIR, file);
  const dstName = hyphenate(file);
  const dst = path.join(DOWNLOADS_DIR, dstName);
  const stat = fs.statSync(src);
  fs.copyFileSync(src, dst);
  const renamed = dstName !== file ? ` → ${dstName}` : '';
  console.log(`[DEPLOY] Copied: ${file}${renamed} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
  copied++;
}

console.log(`[DEPLOY] Done! ${copied} files deployed to server/downloads/`);

// List final contents
console.log('[DEPLOY] Current downloads directory:');
for (const file of fs.readdirSync(DOWNLOADS_DIR)) {
  const stat = fs.statSync(path.join(DOWNLOADS_DIR, file));
  console.log(`  ${file} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}
