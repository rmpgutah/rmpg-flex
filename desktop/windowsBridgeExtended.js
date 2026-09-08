// ============================================================
// RMPG Flex — Extended Windows bridge (Settings panel backend)
//
// Backs the desktop Settings panel's Display / Sound / Network /
// Bluetooth / System / Storage / Apps / Event Log / Kiosk tabs with
// PowerShell- and Electron-backed handlers on the `winext:*` channel
// prefix. Everything the renderer can reach here is:
//
//   • registered through the caller-supplied guardedHandle (so the
//     sender-origin check in security/ipcGuard.js applies),
//   • Windows-only (non-win32 returns { ok:false, error:'not_supported' }
//     rather than throwing),
//   • argument-validated by the pure helpers below BEFORE anything is
//     interpolated into a PowerShell command line,
//   • bounded by an execFile timeout and windowsHide.
//
// The pure helpers (parsers + validators) have no Electron dependency
// and are unit-tested in __tests__/windowsBridgeExtended.test.js,
// matching the wifiInfo.js / deviceInfo.js convention.
// ============================================================

'use strict';

const path = require('path');

const PS_BIN = 'powershell.exe';
const PS_BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const DEFAULT_TIMEOUT_MS = 8000;
const LONG_TIMEOUT_MS = 20000;

// ─── Pure helpers ────────────────────────────────────────────

/**
 * ConvertTo-Json emits a bare object for a single result and an array for
 * many; callers always want an array. Tolerates empty output.
 */
function parsePsJsonArray(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) return [];
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (parsed === null || parsed === undefined) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Parses `ping.exe -n N host` output into { sent, received, lost, minMs,
 * maxMs, avgMs, ok }. Works for both IPv4 and IPv6 replies; a host that
 * never answers yields received:0 and null timings.
 */
function parsePingOutput(stdout) {
  const text = stdout || '';
  const sentMatch = text.match(/Sent\s*=\s*(\d+)/i);
  const recvMatch = text.match(/Received\s*=\s*(\d+)/i);
  const lostMatch = text.match(/Lost\s*=\s*(\d+)/i);
  const timesMatch = text.match(/Minimum\s*=\s*(\d+)ms,\s*Maximum\s*=\s*(\d+)ms,\s*Average\s*=\s*(\d+)ms/i);
  const sent = sentMatch ? Number(sentMatch[1]) : 0;
  const received = recvMatch ? Number(recvMatch[1]) : 0;
  const lost = lostMatch ? Number(lostMatch[1]) : Math.max(0, sent - received);
  return {
    ok: received > 0,
    sent,
    received,
    lost,
    minMs: timesMatch ? Number(timesMatch[1]) : null,
    maxMs: timesMatch ? Number(timesMatch[2]) : null,
    avgMs: timesMatch ? Number(timesMatch[3]) : null,
  };
}

/**
 * Hostname or IPv4/IPv6 literal, nothing else — this is the only value we
 * ever pass to ping.exe, so it must not be able to smuggle a flag.
 */
function validateHost(host) {
  if (typeof host !== 'string') return { ok: false, error: 'host must be a string' };
  const trimmed = host.trim();
  if (trimmed.length === 0 || trimmed.length > 253) return { ok: false, error: 'host length out of range' };
  if (trimmed.startsWith('-') || trimmed.startsWith('/')) return { ok: false, error: 'host may not begin with a flag character' };
  const hostname = /^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*\.?$/;
  const ipv6 = /^[0-9A-Fa-f:.]+$/;
  if (hostname.test(trimmed) || (trimmed.includes(':') && ipv6.test(trimmed))) {
    return { ok: true, host: trimmed };
  }
  return { ok: false, error: 'host contains invalid characters' };
}

/** Positive integer PID above the Windows system-reserved range (0 = idle, 4 = System). */
function validatePid(pid, selfPid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 4) {
    return { ok: false, error: 'pid must be an integer greater than 4' };
  }
  if (pid === selfPid) return { ok: false, error: 'refusing to terminate the running app' };
  return { ok: true, pid };
}

/**
 * Apps the Settings panel is allowed to launch. A fixed map, not a free-form
 * path — the renderer may be showing a compromised remote page and must not
 * be able to spawn arbitrary executables from a kiosk machine.
 */
const LAUNCHABLE_APPS = Object.freeze({
  notepad:       { label: 'Notepad',         exe: 'notepad.exe' },
  calc:          { label: 'Calculator',      exe: 'calc.exe' },
  mspaint:       { label: 'Paint',           exe: 'mspaint.exe' },
  snippingtool:  { label: 'Snipping Tool',   exe: 'snippingtool.exe' },
  taskmgr:       { label: 'Task Manager',    exe: 'taskmgr.exe' },
  control:       { label: 'Control Panel',   exe: 'control.exe' },
  osk:           { label: 'On-Screen Keyboard', exe: 'osk.exe' },
  magnify:       { label: 'Magnifier',       exe: 'magnify.exe' },
});

function validateLaunchableApp(appId) {
  if (typeof appId !== 'string' || !Object.prototype.hasOwnProperty.call(LAUNCHABLE_APPS, appId)) {
    return { ok: false, error: `unknown app "${String(appId)}"` };
  }
  return { ok: true, exe: LAUNCHABLE_APPS[appId].exe };
}

/**
 * User-scope environment variables the panel may set. Namespaced so the
 * renderer can never touch PATH, COMSPEC, PSModulePath, etc.
 */
function validateEnvVar(name, value) {
  if (typeof name !== 'string' || !/^RMPG_[A-Z0-9_]{1,40}$/.test(name)) {
    return { ok: false, error: 'name must match RMPG_[A-Z0-9_]{1,40}' };
  }
  if (value !== null && typeof value !== 'string') {
    return { ok: false, error: 'value must be a string or null' };
  }
  if (typeof value === 'string' && (value.length > 512 || /[\r\n\0]/.test(value))) {
    return { ok: false, error: 'value too long or contains control characters' };
  }
  return { ok: true, name, value };
}

const EVENT_LOGS = Object.freeze(['System', 'Application']);
const EVENT_LEVELS = Object.freeze({ critical: 1, error: 2, warning: 3, information: 4 });

function validateEventLogQuery(query) {
  const q = query && typeof query === 'object' ? query : {};
  const logName = EVENT_LOGS.includes(q.logName) ? q.logName : 'System';
  const level = typeof q.level === 'string' && Object.prototype.hasOwnProperty.call(EVENT_LEVELS, q.level) ? q.level : 'all';
  let maxEvents = Number.isInteger(q.maxEvents) ? q.maxEvents : 50;
  maxEvents = Math.max(1, Math.min(200, maxEvents));
  return { ok: true, logName, level, maxEvents };
}

const SYSTEM_SOUNDS = Object.freeze(['Asterisk', 'Beep', 'Exclamation', 'Hand', 'Question']);

function validateSystemSound(name) {
  if (typeof name !== 'string' || !SYSTEM_SOUNDS.includes(name)) {
    return { ok: false, error: `sound must be one of ${SYSTEM_SOUNDS.join(', ')}` };
  }
  return { ok: true, name };
}

const ROTATIONS = Object.freeze({ 0: 0, 90: 1, 180: 2, 270: 3 });

function validateRotation(degrees) {
  if (!Object.prototype.hasOwnProperty.call(ROTATIONS, degrees)) {
    return { ok: false, error: 'rotation must be 0, 90, 180 or 270' };
  }
  return { ok: true, dmOrientation: ROTATIONS[degrees], degrees: Number(degrees) };
}

function validateResolution(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 640 || h < 480 || w > 7680 || h > 4320) {
    return { ok: false, error: 'resolution out of range' };
  }
  return { ok: true, width: w, height: h };
}

/** Clamp a 0–100 percentage; non-numeric → 0. */
function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Strips `.lnk` and returns the newest `limit` shortcut entries from the Recent folder listing. */
function formatRecentEntries(entries, limit) {
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 25;
  return (entries || [])
    .filter((e) => e && typeof e.name === 'string' && e.name.toLowerCase().endsWith('.lnk'))
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
    .slice(0, cap)
    .map((e) => ({
      name: e.name.replace(/\.lnk$/i, ''),
      path: e.fullPath,
      modifiedAt: e.mtimeMs ? new Date(e.mtimeMs).toISOString() : null,
    }));
}

/** Get-PSDrive -PSProvider FileSystem rows → normalized drive objects. */
function formatDrives(rows) {
  return (rows || [])
    .filter((r) => r && typeof r.Name === 'string')
    .map((r) => {
      const used = Number(r.Used) || 0;
      const free = Number(r.Free) || 0;
      const total = used + free;
      return {
        letter: r.Name,
        root: r.Root || `${r.Name}:\\`,
        label: r.Description || '',
        usedBytes: used,
        freeBytes: free,
        totalBytes: total,
        usedPercent: total > 0 ? Math.round((used / total) * 100) : 0,
      };
    });
}

/** Get-Process rows → normalized process objects. */
function formatProcesses(rows) {
  return (rows || [])
    .filter((r) => r && Number.isInteger(r.Id))
    .map((r) => ({
      pid: r.Id,
      name: r.ProcessName || '',
      cpuSeconds: Number(r.CPU) || 0,
      memoryBytes: Number(r.WorkingSet64) || 0,
      windowTitle: r.MainWindowTitle || '',
    }));
}

/** Registry Uninstall rows → installed-app objects (drops entries with no name). */
function formatInstalledApps(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    if (!r || typeof r.DisplayName !== 'string' || !r.DisplayName.trim()) continue;
    const key = `${r.DisplayName}|${r.DisplayVersion || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: r.DisplayName.trim(),
      version: r.DisplayVersion || '',
      publisher: r.Publisher || '',
      installDate: r.InstallDate || '',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Get-WinEvent rows → event objects; TimeCreated may be a /Date(ms)/ string or ISO. */
function formatEventLog(rows) {
  return (rows || [])
    .filter((r) => r && r.Id !== undefined)
    .map((r) => ({
      id: r.Id,
      level: String(r.LevelDisplayName || 'Information').toLowerCase(),
      source: r.ProviderName || '',
      message: typeof r.Message === 'string' ? r.Message : '',
      time: normalizePsDate(r.TimeCreated),
    }));
}

function normalizePsDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.match(/\/Date\((\d+)\)\//);
    if (m) return new Date(Number(m[1])).toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (value && typeof value === 'object' && typeof value.DateTime === 'string') {
    const d = new Date(value.DateTime);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** Get-ScheduledTask rows → task objects. */
function formatScheduledTasks(rows) {
  return (rows || [])
    .filter((r) => r && typeof r.TaskName === 'string')
    .map((r) => ({
      name: r.TaskName,
      path: r.TaskPath || '\\',
      state: typeof r.State === 'number' ? ['Unknown', 'Disabled', 'Queued', 'Ready', 'Running'][r.State] || 'Unknown' : String(r.State || 'Unknown'),
      author: r.Author || '',
    }));
}

/** Get-NetAdapter rows → adapter objects. */
function formatNetAdapters(rows) {
  return (rows || [])
    .filter((r) => r && typeof r.Name === 'string')
    .map((r) => ({
      name: r.Name,
      description: r.InterfaceDescription || '',
      status: String(r.Status || 'Unknown'),
      up: String(r.Status || '').toLowerCase() === 'up',
      mac: r.MacAddress || '',
      linkSpeed: r.LinkSpeed || '',
      mediaType: r.MediaType || '',
      isWifi: /802\.11/i.test(String(r.MediaType || '')) || /wi-?fi|wireless/i.test(String(r.InterfaceDescription || '')),
    }));
}

/** Get-PnpDevice -Class Bluetooth rows → device objects. */
function formatBluetoothDevices(rows) {
  return (rows || [])
    .filter((r) => r && typeof r.FriendlyName === 'string')
    .map((r) => ({
      name: r.FriendlyName,
      status: String(r.Status || 'Unknown'),
      ok: String(r.Status || '').toUpperCase() === 'OK',
      instanceId: r.InstanceId || '',
      isRadio: /radio|adapter/i.test(String(r.FriendlyName)),
    }));
}

/** Win32_SoundDevice / MMDevice rows → audio device objects. */
function formatAudioDevices(rows) {
  return (rows || [])
    .filter((r) => r && (typeof r.Name === 'string' || typeof r.FriendlyName === 'string'))
    .map((r) => ({
      name: r.Name || r.FriendlyName,
      status: String(r.Status || 'OK'),
      id: r.DeviceID || r.InstanceId || r.ID || '',
      isDefault: Boolean(r.Default),
    }));
}

// ─── PowerShell script builders ──────────────────────────────
// All dynamic values reaching these builders have already passed the
// validators above, so interpolation is limited to integers and
// allowlisted identifiers.

const AUDIO_COM_TYPE = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int _0(); int _1(); int _2(); int _3(); int _4(); int _5(); int _6();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int _9(); int _10(); int _11(); int _12();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid iid, int dwClsCtx, System.IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
public class AudioMute {
  static IAudioEndpointVolume Vol() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice dev; enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
    var iid = typeof(IAudioEndpointVolume).GUID;
    object o; dev.Activate(ref iid, 1, System.IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static void SetMute(bool m) { Vol().SetMute(m, System.Guid.Empty); }
  public static bool GetMute() { bool m; Vol().GetMute(out m); return m; }
}
'@ -ErrorAction SilentlyContinue
`;

function buildSetMuteScript(muted) {
  return `${AUDIO_COM_TYPE}\n[AudioMute]::SetMute($${muted ? 'true' : 'false'}); [AudioMute]::GetMute()`;
}

function buildGetMuteScript() {
  return `${AUDIO_COM_TYPE}\n[AudioMute]::GetMute()`;
}

const DISPLAY_PINVOKE_TYPE = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RmpgDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra;
    public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight;
    public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent;
    public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2;
    public int dmPanningWidth; public int dmPanningHeight;
  }
  [DllImport("user32.dll")] public static extern int EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
  [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);
  const int ENUM_CURRENT_SETTINGS = -1;
  const int DM_PELSWIDTH = 0x80000; const int DM_PELSHEIGHT = 0x100000; const int DM_DISPLAYORIENTATION = 0x80;
  const int CDS_UPDATEREGISTRY = 0x1;
  public static int SetResolution(int w, int h) {
    DEVMODE dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    if (EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref dm) == 0) return -100;
    dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT;
    return ChangeDisplaySettings(ref dm, CDS_UPDATEREGISTRY);
  }
  public static int SetOrientation(int orientation) {
    DEVMODE dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    if (EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref dm) == 0) return -100;
    bool wasLandscape = dm.dmDisplayOrientation == 0 || dm.dmDisplayOrientation == 2;
    bool wantLandscape = orientation == 0 || orientation == 2;
    if (wasLandscape != wantLandscape) { int t = dm.dmPelsWidth; dm.dmPelsWidth = dm.dmPelsHeight; dm.dmPelsHeight = t; }
    dm.dmDisplayOrientation = orientation; dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYORIENTATION;
    return ChangeDisplaySettings(ref dm, CDS_UPDATEREGISTRY);
  }
  public static string ListModes() {
    DEVMODE dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    var sb = new System.Text.StringBuilder(); int i = 0;
    while (EnumDisplaySettings(null, i++, ref dm) != 0) { sb.Append(dm.dmPelsWidth).Append('x').Append(dm.dmPelsHeight).Append('@').Append(dm.dmDisplayFrequency).Append(';'); }
    return sb.ToString();
  }
  public static string Current() {
    DEVMODE dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    if (EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref dm) == 0) return "";
    return dm.dmPelsWidth + "x" + dm.dmPelsHeight + "@" + dm.dmDisplayFrequency + "/" + dm.dmDisplayOrientation;
  }
}
'@ -ErrorAction SilentlyContinue
`;

function buildSetResolutionScript(width, height) {
  return `${DISPLAY_PINVOKE_TYPE}\n[RmpgDisplay]::SetResolution(${width}, ${height})`;
}

function buildSetOrientationScript(dmOrientation) {
  return `${DISPLAY_PINVOKE_TYPE}\n[RmpgDisplay]::SetOrientation(${dmOrientation})`;
}

function buildDisplayModesScript() {
  return `${DISPLAY_PINVOKE_TYPE}\n[RmpgDisplay]::Current(); [RmpgDisplay]::ListModes()`;
}

/** "1920x1080@60;1280x720@60;" → sorted unique [{width,height,refreshHz}] */
function parseDisplayModes(stdout) {
  const lines = (stdout || '').trim().split(/\r?\n/);
  const currentLine = lines.find((l) => /^\d+x\d+@\d+\/\d$/.test(l.trim())) || '';
  const modesLine = lines.find((l) => l.includes(';')) || '';
  const seen = new Set();
  const modes = [];
  for (const chunk of modesLine.split(';')) {
    const m = chunk.trim().match(/^(\d+)x(\d+)@(\d+)$/);
    if (!m) continue;
    const width = Number(m[1]);
    const height = Number(m[2]);
    const refreshHz = Number(m[3]);
    if (width < 800 || height < 600) continue;
    const key = `${width}x${height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    modes.push({ width, height, refreshHz });
  }
  modes.sort((a, b) => b.width * b.height - a.width * a.height);
  let current = null;
  const cm = currentLine.trim().match(/^(\d+)x(\d+)@(\d+)\/(\d)$/);
  if (cm) {
    current = {
      width: Number(cm[1]),
      height: Number(cm[2]),
      refreshHz: Number(cm[3]),
      rotation: [0, 90, 180, 270][Number(cm[4])] ?? 0,
    };
  }
  return { current, modes };
}

/** ChangeDisplaySettings return codes → { ok, error } */
function interpretDisplayChangeCode(stdout) {
  const code = Number((stdout || '').trim().split(/\r?\n/).pop());
  if (code === 0) return { ok: true, code };
  const names = {
    1: 'restart_required',
    '-1': 'display_change_failed',
    '-2': 'bad_mode',
    '-3': 'not_updated',
    '-4': 'bad_flags',
    '-5': 'bad_param',
    '-6': 'bad_dual_view',
    '-100': 'enum_failed',
  };
  return { ok: false, code, error: names[String(code)] || `code_${Number.isNaN(code) ? 'unknown' : code}` };
}

// ─── Handler registration ────────────────────────────────────

/**
 * Registers every `winext:*` handler. Dependencies are injected so the
 * module never requires 'electron' at load time (keeps it Node-testable):
 *   guardedHandle  — from createIpcGuards in main.js
 *   execFileAsync  — promisified child_process.execFile
 *   electron       — { app, shell, clipboard, Notification, screen }
 *   fs, os         — node modules (injectable for tests)
 *   getMainWindow  — () => BrowserWindow | null
 *   checkRateLimit — (channel) => boolean, for process-spawning channels
 *   log            — console-like
 */
function registerWindowsBridgeExtended(deps) {
  const {
    guardedHandle,
    execFileAsync,
    electron,
    fs = require('fs'),
    os = require('os'),
    getMainWindow = () => null,
    checkRateLimit = () => true,
    log = console,
    platform = process.platform,
    selfPid = process.pid,
  } = deps;

  const isWin = platform === 'win32';
  const notSupported = () => ({ ok: false, error: 'not_supported' });

  async function ps(script, timeout = DEFAULT_TIMEOUT_MS) {
    const { stdout } = await execFileAsync(PS_BIN, [...PS_BASE_ARGS, script], {
      timeout,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout || '';
  }

  async function psJson(script, timeout) {
    return parsePsJsonArray(await ps(script, timeout));
  }

  function fail(channel, err) {
    log.error(`[${channel}]`, err && err.message ? err.message : err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }

  function requireBudget(channel) {
    if (!checkRateLimit(channel)) return { ok: false, error: 'rate_limited' };
    return null;
  }

  function allowedRoots() {
    const { app } = electron;
    return [app.getPath('downloads'), app.getPath('documents'), app.getPath('desktop'), app.getPath('pictures'), app.getPath('temp')];
  }

  function validateUserPath(candidate) {
    if (typeof candidate !== 'string' || candidate.length === 0) return { ok: false, error: 'path must be a non-empty string' };
    const resolved = path.resolve(candidate);
    const roots = allowedRoots();
    const inside = roots.some((root) => {
      const r = path.resolve(root);
      return resolved === r || resolved.startsWith(r + path.sep);
    });
    if (!inside) return { ok: false, error: 'path is outside the allowed user folders' };
    return { ok: true, resolved };
  }

  // ── Display ──────────────────────────────────────────────
  guardedHandle('winext:display-modes', async () => {
    if (!isWin) return notSupported();
    try {
      return { ok: true, ...parseDisplayModes(await ps(buildDisplayModesScript())) };
    } catch (err) { return fail('WINEXT:DISPLAY-MODES', err); }
  });

  guardedHandle('winext:set-resolution', async (_e, width, height) => {
    if (!isWin) return notSupported();
    const v = validateResolution(width, height);
    if (!v.ok) return v;
    try {
      return interpretDisplayChangeCode(await ps(buildSetResolutionScript(v.width, v.height), LONG_TIMEOUT_MS));
    } catch (err) { return fail('WINEXT:SET-RESOLUTION', err); }
  });

  guardedHandle('winext:rotate-display', async (_e, degrees) => {
    if (!isWin) return notSupported();
    const v = validateRotation(degrees);
    if (!v.ok) return v;
    try {
      return interpretDisplayChangeCode(await ps(buildSetOrientationScript(v.dmOrientation), LONG_TIMEOUT_MS));
    } catch (err) { return fail('WINEXT:ROTATE-DISPLAY', err); }
  });

  // Night light: Windows exposes no supported API, only an undocumented
  // CloudStore registry blob. Read the registry state so the panel can show
  // it, and let the renderer's own DesktopNightLightOverlay do the tinting.
  guardedHandle('winext:night-light-state', async () => {
    if (!isWin) return notSupported();
    try {
      const out = await ps(
        "$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default$windows.data.bluelightreduction.bluelightreductionstate\\windows.data.bluelightreduction.bluelightreductionstate'; if (Test-Path $k) { $d=(Get-ItemProperty $k).Data; if ($d -and $d.Length -gt 18 -and $d[18] -eq 0x15) { 'on' } else { 'off' } } else { 'unknown' }"
      );
      const state = out.trim();
      return { ok: true, state: state === 'on' || state === 'off' ? state : 'unknown', enabled: state === 'on' };
    } catch (err) { return fail('WINEXT:NIGHT-LIGHT-STATE', err); }
  });

  // Saves a full-screen capture straight to the Pictures folder without a
  // dialog — kiosk machines have no file picker the operator can use.
  guardedHandle('winext:screenshot-to-pictures', async () => {
    try {
      const sources = await electron.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 3840, height: 2160 } });
      if (!sources.length) return { ok: false, error: 'no_sources' };
      const dir = path.join(electron.app.getPath('pictures'), 'RMPG Flex Screenshots');
      await fs.promises.mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(dir, `screenshot-${stamp}.png`);
      await fs.promises.writeFile(file, sources[0].thumbnail.toPNG());
      return { ok: true, path: file };
    } catch (err) { return fail('WINEXT:SCREENSHOT', err); }
  });

  // ── Audio ────────────────────────────────────────────────
  guardedHandle('winext:get-mute', async () => {
    if (!isWin) return notSupported();
    try {
      return { ok: true, muted: /true/i.test(await ps(buildGetMuteScript())) };
    } catch (err) { return fail('WINEXT:GET-MUTE', err); }
  });

  guardedHandle('winext:set-mute', async (_e, muted) => {
    if (!isWin) return notSupported();
    try {
      return { ok: true, muted: /true/i.test(await ps(buildSetMuteScript(Boolean(muted)))) };
    } catch (err) { return fail('WINEXT:SET-MUTE', err); }
  });

  guardedHandle('winext:play-system-sound', async (_e, name) => {
    if (!isWin) return notSupported();
    const v = validateSystemSound(name);
    if (!v.ok) return v;
    try {
      await ps(`[System.Media.SystemSounds]::${v.name}.Play(); Start-Sleep -Milliseconds 600`);
      return { ok: true };
    } catch (err) { return fail('WINEXT:PLAY-SOUND', err); }
  });

  guardedHandle('winext:audio-devices', async () => {
    if (!isWin) return notSupported();
    try {
      const rows = await psJson(
        "Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json -Compress"
      );
      return { ok: true, devices: formatAudioDevices(rows) };
    } catch (err) { return fail('WINEXT:AUDIO-DEVICES', err); }
  });

  // Setting the default endpoint needs the AudioDeviceCmdlets module (not
  // shipped with Windows). Report not_supported cleanly when it's absent.
  guardedHandle('winext:set-default-audio-device', async (_e, deviceId) => {
    if (!isWin) return notSupported();
    if (typeof deviceId !== 'string' || !/^[A-Za-z0-9{}\-._\\:#&]{1,200}$/.test(deviceId)) {
      return { ok: false, error: 'invalid device id' };
    }
    try {
      const has = (await ps("if (Get-Module -ListAvailable -Name AudioDeviceCmdlets) { 'yes' } else { 'no' }")).trim();
      if (has !== 'yes') return { ok: false, error: 'not_supported', detail: 'AudioDeviceCmdlets module not installed' };
      await ps(`Import-Module AudioDeviceCmdlets; Set-AudioDevice -ID '${deviceId.replace(/'/g, "''")}' | Out-Null`);
      return { ok: true };
    } catch (err) { return fail('WINEXT:SET-DEFAULT-AUDIO', err); }
  });

  // ── Network ──────────────────────────────────────────────
  guardedHandle('winext:net-adapters', async () => {
    if (!isWin) return notSupported();
    try {
      const rows = await psJson(
        'Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Select-Object Name, InterfaceDescription, Status, MacAddress, LinkSpeed, MediaType | ConvertTo-Json -Compress'
      );
      return { ok: true, adapters: formatNetAdapters(rows) };
    } catch (err) { return fail('WINEXT:NET-ADAPTERS', err); }
  });

  guardedHandle('winext:toggle-wifi', async (_e, enabled) => {
    if (!isWin) return notSupported();
    const limited = requireBudget('winext:toggle-wifi');
    if (limited) return limited;
    const verb = enabled ? 'Enable-NetAdapter' : 'Disable-NetAdapter';
    try {
      await ps(`Get-NetAdapter -Physical | Where-Object { $_.MediaType -match '802.11' -or $_.InterfaceDescription -match 'Wi-?Fi|Wireless' } | ${verb} -Confirm:$false`, LONG_TIMEOUT_MS);
      return { ok: true, enabled: Boolean(enabled) };
    } catch (err) { return fail('WINEXT:TOGGLE-WIFI', err); }
  });

  guardedHandle('winext:bluetooth-devices', async () => {
    if (!isWin) return notSupported();
    try {
      const rows = await psJson(
        'Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json -Compress'
      );
      const devices = formatBluetoothDevices(rows);
      const radio = devices.find((d) => d.isRadio);
      return { ok: true, devices, radioPresent: Boolean(radio), radioEnabled: Boolean(radio && radio.ok) };
    } catch (err) { return fail('WINEXT:BLUETOOTH-DEVICES', err); }
  });

  guardedHandle('winext:toggle-bluetooth', async (_e, enabled) => {
    if (!isWin) return notSupported();
    const limited = requireBudget('winext:toggle-bluetooth');
    if (limited) return limited;
    const verb = enabled ? 'Enable-PnpDevice' : 'Disable-PnpDevice';
    try {
      await ps(`Get-PnpDevice -Class Bluetooth | Where-Object { $_.FriendlyName -match 'Radio|Adapter' } | ${verb} -Confirm:$false`, LONG_TIMEOUT_MS);
      return { ok: true, enabled: Boolean(enabled) };
    } catch (err) { return fail('WINEXT:TOGGLE-BLUETOOTH', err); }
  });

  guardedHandle('winext:ping', async (_e, host) => {
    const v = validateHost(host);
    if (!v.ok) return v;
    const limited = requireBudget('winext:ping');
    if (limited) return limited;
    try {
      const args = isWin ? ['-n', '4', '-w', '2000', v.host] : ['-c', '4', v.host];
      const { stdout } = await execFileAsync(isWin ? 'ping.exe' : 'ping', args, { timeout: 15000, windowsHide: true, encoding: 'utf8' });
      return { ...parsePingOutput(stdout), host: v.host };
    } catch (err) {
      // ping exits non-zero on total loss but still prints statistics.
      if (err && typeof err.stdout === 'string' && err.stdout.length) return { ...parsePingOutput(err.stdout), host: v.host };
      return fail('WINEXT:PING', err);
    }
  });

  // ── System ───────────────────────────────────────────────
  guardedHandle('winext:processes', async () => {
    if (!isWin) return notSupported();
    try {
      const rows = await psJson(
        'Get-Process | Sort-Object CPU -Descending | Select-Object -First 80 Id, ProcessName, CPU, WorkingSet64, MainWindowTitle | ConvertTo-Json -Compress'
      );
      return { ok: true, processes: formatProcesses(rows) };
    } catch (err) { return fail('WINEXT:PROCESSES', err); }
  });

  guardedHandle('winext:kill-process', async (_e, pid) => {
    if (!isWin) return notSupported();
    const v = validatePid(pid, selfPid);
    if (!v.ok) return v;
    const limited = requireBudget('winext:kill-process');
    if (limited) return limited;
    try {
      await ps(`Stop-Process -Id ${v.pid} -Force -ErrorAction Stop`);
      return { ok: true, pid: v.pid };
    } catch (err) { return fail('WINEXT:KILL-PROCESS', err); }
  });

  guardedHandle('winext:launch-app', async (_e, appId) => {
    if (!isWin) return notSupported();
    const v = validateLaunchableApp(appId);
    if (!v.ok) return v;
    const limited = requireBudget('winext:launch-app');
    if (limited) return limited;
    try {
      // Start-Process detaches; execFile on the exe directly would block until exit.
      await ps(`Start-Process -FilePath '${v.exe}'`);
      return { ok: true };
    } catch (err) { return fail('WINEXT:LAUNCH-APP', err); }
  });

  guardedHandle('winext:launchable-apps', () => ({
    ok: true,
    apps: Object.entries(LAUNCHABLE_APPS).map(([id, a]) => ({ id, label: a.label })),
  }));

  guardedHandle('winext:system-performance', async () => {
    try {
      const cpus = os.cpus();
      const load = cpus.reduce((acc, c) => {
        const total = Object.values(c.times).reduce((a, b) => a + b, 0);
        return { idle: acc.idle + c.times.idle, total: acc.total + total };
      }, { idle: 0, total: 0 });
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      let disk = null;
      try {
        const st = await fs.promises.statfs(electron.app.getPath('userData'));
        disk = { freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize };
      } catch { /* statfs unavailable on older Node — leave null */ }
      return {
        ok: true,
        cpuCount: cpus.length,
        cpuModel: cpus[0] ? cpus[0].model : '',
        cpuBusyPercent: load.total > 0 ? Math.round(((load.total - load.idle) / load.total) * 100) : null,
        memory: { totalBytes: totalMem, freeBytes: freeMem, usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100) },
        disk,
        uptimeSeconds: os.uptime(),
        hostname: os.hostname(),
        osVersion: os.release(),
        arch: os.arch(),
      };
    } catch (err) { return fail('WINEXT:SYSTEM-PERFORMANCE', err); }
  });

  guardedHandle('winext:installed-apps', async () => {
    if (!isWin) return notSupported();
    try {
      const rows = await psJson(
        "@('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*') | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName -and -not $_.SystemComponent } | Select-Object DisplayName, DisplayVersion, Publisher, InstallDate | ConvertTo-Json -Compress",
        LONG_TIMEOUT_MS
      );
      return { ok: true, apps: formatInstalledApps(rows) };
    } catch (err) { return fail('WINEXT:INSTALLED-APPS', err); }
  });

  guardedHandle('winext:set-env-var', async (_e, name, value) => {
    if (!isWin) return notSupported();
    const v = validateEnvVar(name, value);
    if (!v.ok) return v;
    try {
      const literal = v.value === null ? '$null' : `'${v.value.replace(/'/g, "''")}'`;
      await ps(`[Environment]::SetEnvironmentVariable('${v.name}', ${literal}, 'User')`);
      return { ok: true, name: v.name };
    } catch (err) { return fail('WINEXT:SET-ENV-VAR', err); }
  });

  // ── Filesystem ───────────────────────────────────────────
  guardedHandle('winext:drives', async () => {
    if (!isWin) return notSupported();
    try {
      const rows = await psJson('Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free, Root, Description | ConvertTo-Json -Compress');
      return { ok: true, drives: formatDrives(rows) };
    } catch (err) { return fail('WINEXT:DRIVES', err); }
  });

  guardedHandle('winext:open-folder', async (_e, folder) => {
    const v = validateUserPath(folder);
    if (!v.ok) return v;
    try {
      const result = await electron.shell.openPath(v.resolved);
      return result ? { ok: false, error: result } : { ok: true };
    } catch (err) { return fail('WINEXT:OPEN-FOLDER', err); }
  });

  guardedHandle('winext:recent-files', async (_e, limit) => {
    if (!isWin) return notSupported();
    try {
      const recentDir = path.join(electron.app.getPath('appData'), 'Microsoft', 'Windows', 'Recent');
      const names = await fs.promises.readdir(recentDir);
      const entries = await Promise.all(names.map(async (name) => {
        const fullPath = path.join(recentDir, name);
        try {
          const st = await fs.promises.stat(fullPath);
          return { name, fullPath, mtimeMs: st.mtimeMs };
        } catch { return null; }
      }));
      return { ok: true, files: formatRecentEntries(entries.filter(Boolean), limit) };
    } catch (err) { return fail('WINEXT:RECENT-FILES', err); }
  });

  guardedHandle('winext:recycle-item', async (_e, target) => {
    const v = validateUserPath(target);
    if (!v.ok) return v;
    try {
      await electron.shell.trashItem(v.resolved);
      return { ok: true };
    } catch (err) { return fail('WINEXT:RECYCLE-ITEM', err); }
  });

  // ── Features ─────────────────────────────────────────────
  guardedHandle('winext:event-log', async (_e, query) => {
    if (!isWin) return notSupported();
    const q = validateEventLogQuery(query);
    const levelFilter = q.level === 'all' ? '' : `; Level=${EVENT_LEVELS[q.level]}`;
    try {
      const rows = await psJson(
        `Get-WinEvent -FilterHashtable @{LogName='${q.logName}'${levelFilter}} -MaxEvents ${q.maxEvents} -ErrorAction SilentlyContinue | Select-Object Id, LevelDisplayName, ProviderName, Message, @{n='TimeCreated';e={$_.TimeCreated.ToString('o')}} | ConvertTo-Json -Compress`,
        LONG_TIMEOUT_MS
      );
      return { ok: true, events: formatEventLog(rows), logName: q.logName, level: q.level };
    } catch (err) { return fail('WINEXT:EVENT-LOG', err); }
  });

  guardedHandle('winext:scheduled-tasks', async () => {
    if (!isWin) return notSupported();
    try {
      const rows = await psJson(
        "Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' } | Select-Object -First 100 TaskName, TaskPath, State, Author | ConvertTo-Json -Compress",
        LONG_TIMEOUT_MS
      );
      return { ok: true, tasks: formatScheduledTasks(rows) };
    } catch (err) { return fail('WINEXT:SCHEDULED-TASKS', err); }
  });

  guardedHandle('winext:native-toast', (_e, title, body) => {
    const t = typeof title === 'string' ? title.slice(0, 120) : 'RMPG Flex';
    const b = typeof body === 'string' ? body.slice(0, 500) : '';
    try {
      if (!electron.Notification || !electron.Notification.isSupported()) return { ok: false, error: 'not_supported' };
      const n = new electron.Notification({ title: t, body: b, silent: false });
      n.on('click', () => { const w = getMainWindow(); if (w) { w.show(); w.focus(); } });
      n.show();
      return { ok: true };
    } catch (err) { return fail('WINEXT:NATIVE-TOAST', err); }
  });
}

module.exports = {
  registerWindowsBridgeExtended,
  // pure helpers (tested)
  parsePsJsonArray,
  parsePingOutput,
  validateHost,
  validatePid,
  validateLaunchableApp,
  validateEnvVar,
  validateEventLogQuery,
  validateSystemSound,
  validateRotation,
  validateResolution,
  clampPercent,
  formatRecentEntries,
  formatDrives,
  formatProcesses,
  formatInstalledApps,
  formatEventLog,
  formatScheduledTasks,
  formatNetAdapters,
  formatBluetoothDevices,
  formatAudioDevices,
  parseDisplayModes,
  interpretDisplayChangeCode,
  normalizePsDate,
  LAUNCHABLE_APPS,
  SYSTEM_SOUNDS,
  EVENT_LOGS,
};
