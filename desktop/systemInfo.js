// ============================================================
// RMPG Flex — System & Diagnostics
// System info, log access, diagnostics bundle export, crash
// dumps, app restart, disk space, network interfaces, battery
// status, idle time. Every OS/Electron-touching function takes
// its dependency as a parameter for zero-runtime-dependency
// unit testing, mirroring desktop/security/*.js's pattern.
// ============================================================

'use strict';

/** Free disk space in bytes at targetPath, via fs.statfsSync. */
function getDiskFreeBytes(targetPath, fsModule) {
  const stats = fsModule.statfsSync(targetPath);
  return stats.bavail * stats.bsize;
}

/** Assembles the sys:info shape from Node's os module plus a precomputed diskFree value. */
function formatSystemInfo(osModule, freeBytes) {
  const cpus = osModule.cpus();
  return {
    os: osModule.platform(),
    arch: osModule.arch(),
    cpuModel: cpus.length > 0 ? cpus[0].model : 'unknown',
    totalMem: osModule.totalmem(),
    freeMem: osModule.freemem(),
    diskFree: freeBytes,
  };
}

module.exports = {
  getDiskFreeBytes,
  formatSystemInfo,
};
