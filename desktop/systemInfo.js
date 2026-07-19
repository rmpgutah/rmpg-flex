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

/** Appends one timestamped line to the log file. Never throws on the format — a real fs error still propagates. */
function appendToLogFile(message, logFilePath, fsModule) {
  fsModule.appendFileSync(logFilePath, `[${new Date().toISOString()}] ${message}\n`);
}

/** Returns the last `lines` lines of logFilePath, or '' if it doesn't exist yet. */
function tailLogFile(logFilePath, lines, fsModule) {
  if (!fsModule.existsSync(logFilePath)) return '';
  const content = fsModule.readFileSync(logFilePath, 'utf8');
  const allLines = content.split('\n').filter((_, i, arr) => !(i === arr.length - 1 && arr[arr.length - 1] === ''));
  return allLines.slice(-lines).join('\n');
}

/** Directory containing the log file — pure path math, no fs access. */
function getLogsDirectory(logFilePath, pathModule) {
  return pathModule.dirname(logFilePath);
}

/** Plain-text diagnostics bundle body — redaction/encryption happens after this, at the call site. */
function buildDiagnosticsBundleText(systemInfoObj, logTail) {
  return [
    '=== System Info ===',
    JSON.stringify(systemInfoObj, null, 2),
    '',
    '=== Recent Logs ===',
    logTail,
  ].join('\n');
}

/** Lists crash dump files in Electron's standard crashDumps directory. */
function listCrashReports(crashDumpsDir, fsModule) {
  if (!fsModule.existsSync(crashDumpsDir)) return [];
  return fsModule.readdirSync(crashDumpsDir).map((name) => {
    const fullPath = `${crashDumpsDir}/${name}`;
    const stats = fsModule.statSync(fullPath);
    return { date: stats.mtime.toISOString(), path: fullPath };
  });
}

const DEFAULT_DISK_WARN_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500MB

/** Flags low disk space before a local DB write that could fail on a full disk. */
function evaluateDiskSpace(freeBytes, warnThresholdBytes = DEFAULT_DISK_WARN_THRESHOLD_BYTES) {
  return { freeBytes, warn: freeBytes < warnThresholdBytes };
}

/** Flattens os.networkInterfaces() into {name, address, type}[], dropping internal/loopback entries. */
function formatNetworkInterfaces(rawInterfaces) {
  const result = [];
  for (const [name, addresses] of Object.entries(rawInterfaces)) {
    for (const addr of addresses) {
      if (addr.internal) continue;
      result.push({ name, address: addr.address, type: addr.family });
    }
  }
  return result;
}

module.exports = {
  getDiskFreeBytes,
  formatSystemInfo,
  appendToLogFile,
  tailLogFile,
  getLogsDirectory,
  buildDiagnosticsBundleText,
  listCrashReports,
  evaluateDiskSpace,
  DEFAULT_DISK_WARN_THRESHOLD_BYTES,
  formatNetworkInterfaces,
};
