// ============================================================
// afterPack hook for electron-builder (Thin Client)
// Ad-hoc signs macOS .app bundle so Gatekeeper shows
// "unidentified developer" instead of "damaged/delete".
// ============================================================

const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only codesign on macOS
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  if (!fs.existsSync(appPath)) {
    console.log(`  ⚠  App bundle not found at ${appPath} — skipping ad-hoc sign`);
    return;
  }

  console.log('');
  console.log('───────────────────────────────────────────────────');
  console.log('  Ad-hoc codesigning macOS app bundle');
  console.log(`  Path: ${appPath}`);
  console.log('───────────────────────────────────────────────────');

  try {
    // --force: replace any existing signature
    // --deep: sign all nested code (frameworks, helpers)
    // --sign -: ad-hoc identity (no certificate required)
    execSync(`codesign --force --deep --sign - "${appPath}"`, {
      stdio: 'inherit',
      timeout: 60000,
    });
    console.log('  ✅ Ad-hoc codesign succeeded!');
  } catch (err) {
    console.error('  ⚠  Ad-hoc codesign failed:', err.message);
    console.error('  The app may show "damaged" on macOS. Users can fix with:');
    console.error('  sudo xattr -cr /Applications/RMPG\\ Flex.app');
  }
};
