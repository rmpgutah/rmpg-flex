// ============================================================
// afterPack hook for electron-builder
// Rebuilds native Node modules (better-sqlite3) for the target
// platform/arch so the packaged app works on Windows & macOS.
// ============================================================

const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
module.exports = async function afterPack(context) {
  const { electronPlatformName, arch, appOutDir } = context;

  // Map electron-builder arch numbers to strings
  const archMap = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
  const archStr = archMap[arch] || 'x64';

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  afterPack: Rebuilding native modules`);
  console.log(`  Platform: ${electronPlatformName}  Arch: ${archStr}`);
  console.log(`  App output: ${appOutDir}`);
  console.log('═══════════════════════════════════════════════════');

  // Locate the packed server directory inside resources
  let serverDir;
  if (electronPlatformName === 'darwin') {
    // macOS: MyApp.app/Contents/Resources/server
    const appName = context.packager.appInfo.productFilename;
    serverDir = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources', 'server');
  } else {
    // Windows/Linux: resources/server
    serverDir = path.join(appOutDir, 'resources', 'server');
  }

  const betterSqliteDir = path.join(serverDir, 'node_modules', 'better-sqlite3');
  const buildDir = path.join(betterSqliteDir, 'build', 'Release');

  if (!fs.existsSync(betterSqliteDir)) {
    console.log('  ⚠  better-sqlite3 not found in packed server — skipping rebuild');
    return;
  }

  console.log(`  Server dir: ${serverDir}`);
  console.log(`  better-sqlite3: ${betterSqliteDir}`);

  // Get the Electron version so we can match the Node ABI
  const electronVersion = context.packager.config.electronVersion ||
    require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json')).version;

  console.log(`  Electron version: ${electronVersion}`);

  // Strategy 1: Use prebuild-install to download a prebuilt binary
  // prebuild-install downloads precompiled .node files from GitHub releases
  const prebuildBin = path.join(serverDir, 'node_modules', 'prebuild-install', 'bin.js');

  if (fs.existsSync(prebuildBin)) {
    console.log('  → Attempting prebuild-install for target platform...');

    // Map electron-builder platform names to Node platform names
    const platformMap = {
      'darwin': 'darwin',
      'linux': 'linux',
      'win32': 'win32',
    };
    const targetPlatform = platformMap[electronPlatformName] || electronPlatformName;

    try {
      // prebuild-install downloads prebuilt binaries for the specified runtime
      const cmd = [
        process.execPath,  // Use current Node to run the script
        JSON.stringify(prebuildBin),
        '--runtime electron',
        `--target ${electronVersion}`,
        `--arch ${archStr}`,
        `--platform ${targetPlatform}`,
        '--tag-prefix v',
        '--verbose',
      ].join(' ');

      console.log(`  CMD: ${cmd}`);
      execSync(cmd, {
        cwd: betterSqliteDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          npm_config_arch: archStr,
          npm_config_platform: targetPlatform,
        },
        timeout: 120000,
      });

      // Verify the binary was placed correctly
      const nodeFile = path.join(buildDir, 'better_sqlite3.node');
      if (fs.existsSync(nodeFile)) {
        console.log('  ✅ prebuild-install succeeded!');
        console.log('');
        return;
      } else {
        // Check prebuilds directory (newer prebuild-install puts files there)
        const prebuildsDir = path.join(betterSqliteDir, 'prebuilds');
        if (fs.existsSync(prebuildsDir)) {
          console.log('  ✅ prebuild-install downloaded prebuilds!');
          const contents = fs.readdirSync(prebuildsDir);
          console.log('  Prebuilds:', contents.join(', '));
          console.log('');
          return;
        }
        console.log('  ⚠  prebuild-install ran but binary not found — trying @electron/rebuild...');
      }
    } catch (err) {
      console.log('  ⚠  prebuild-install failed:', err.message);
      console.log('  → Falling back to @electron/rebuild...');
    }
  }

  // Strategy 2: Use @electron/rebuild
  try {
    const rebuildPath = require.resolve('@electron/rebuild/lib/cli.js', {
      paths: [path.join(__dirname, '..', 'node_modules')],
    });

    const cmd = [
      process.execPath,
      JSON.stringify(rebuildPath),
      `--version ${electronVersion}`,
      `--arch ${archStr}`,
      '--only better-sqlite3',
      `--module-dir ${JSON.stringify(serverDir)}`,
    ].join(' ');

    console.log(`  CMD: ${cmd}`);
    execSync(cmd, {
      cwd: serverDir,
      stdio: 'inherit',
      timeout: 300000,
    });
    console.log('  ✅ @electron/rebuild succeeded!');
  } catch (err) {
    console.error('  ❌ Failed to rebuild native modules:', err.message);
    console.error('  The packaged app may not work on the target platform.');
    console.error('  Consider running: npm rebuild better-sqlite3 on the target machine.');
  }

  console.log('');
};
