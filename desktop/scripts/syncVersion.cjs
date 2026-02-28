// ============================================================
// syncVersion.cjs — Pre-build version synchronization
// Reads the version from desktop/package.json (source of truth)
// and updates server/package.json + root package.json to match.
// ============================================================

const fs = require('fs');
const path = require('path');

const desktopPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')
);
const version = desktopPkg.version;

console.log(`[SYNC] Synchronizing version: ${version}`);

// Update server/package.json
const serverPkgPath = path.resolve(__dirname, '..', '..', 'server', 'package.json');
if (fs.existsSync(serverPkgPath)) {
  const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf-8'));
  serverPkg.version = version;
  fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2) + '\n');
  console.log(`[SYNC] Updated server/package.json → ${version}`);
}

// Update root package.json
const rootPkgPath = path.resolve(__dirname, '..', '..', 'package.json');
if (fs.existsSync(rootPkgPath)) {
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
  rootPkg.version = version;
  fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
  console.log(`[SYNC] Updated root package.json → ${version}`);
}

// Update client/package.json
const clientPkgPath = path.resolve(__dirname, '..', '..', 'client', 'package.json');
if (fs.existsSync(clientPkgPath)) {
  const clientPkg = JSON.parse(fs.readFileSync(clientPkgPath, 'utf-8'));
  clientPkg.version = version;
  fs.writeFileSync(clientPkgPath, JSON.stringify(clientPkg, null, 2) + '\n');
  console.log(`[SYNC] Updated client/package.json → ${version}`);
}

console.log('[SYNC] Version sync complete.');
