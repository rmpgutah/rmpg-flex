/**
 * useWindowsBridge — typed renderer-side facade over the Electron preload
 * bridge (`window.electron`) for the desktop Settings panel.
 *
 * Two layers are exposed as ONE flat API:
 *   • the pre-existing preload methods the panel reuses (volume, brightness,
 *     WiFi scan/connect, displays, battery, system info, power, kiosk shell,
 *     clipboard, screenshots, notifications), and
 *   • the `winExt` group added by desktop/windowsBridgeExtended.js
 *     (display modes/rotation, mute, system sounds, adapters, Bluetooth,
 *     ping, processes, installed apps, drives, recent files, event log,
 *     scheduled tasks, native toast).
 *
 * Every call is safe in the plain web build: when `window.electron` is
 * missing the method resolves to `{ ok:false, error:'not_electron' }` (or
 * null for the legacy value-returning methods) instead of throwing, so the
 * panel can render read-only. `available` / `extendedAvailable` let the UI
 * feature-detect before offering a control.
 *
 * Nothing here talks to the Worker API — PIN changes go through apiFetch in
 * the panel itself.
 */
import { useMemo } from 'react';

// ─── Result shapes (mirror desktop/windowsBridgeExtended.js) ─────

export interface BridgeFail { ok: false; error: string; detail?: string }
export type BridgeResult<T extends object = Record<string, never>> = ({ ok: true } & T) | BridgeFail;

export interface DisplayMode { width: number; height: number; refreshHz: number }
export interface CurrentDisplayMode extends DisplayMode { rotation: 0 | 90 | 180 | 270 }
export interface DisplayInfo { id: number; bounds: { x: number; y: number; width: number; height: number }; primary: boolean }

export interface AudioDevice { name: string; status: string; id: string; isDefault: boolean }
export interface NetAdapter { name: string; description: string; status: string; up: boolean; mac: string; linkSpeed: string; mediaType: string; isWifi: boolean }
export interface BluetoothDevice { name: string; status: string; ok: boolean; instanceId: string; isRadio: boolean }
export interface PingResult { ok: boolean; host: string; sent: number; received: number; lost: number; minMs: number | null; maxMs: number | null; avgMs: number | null; error?: string }
export interface ProcessInfo { pid: number; name: string; cpuSeconds: number; memoryBytes: number; windowTitle: string }
export interface InstalledApp { name: string; version: string; publisher: string; installDate: string }
export interface LaunchableApp { id: string; label: string }
export interface DriveInfo { letter: string; root: string; label: string; usedBytes: number; freeBytes: number; totalBytes: number; usedPercent: number }
export interface RecentFile { name: string; path: string; modifiedAt: string | null }
export interface EventLogEntry { id: number; level: string; source: string; message: string; time: string | null }
export interface ScheduledTask { name: string; path: string; state: string; author: string }
export interface SystemPerformance {
  cpuCount: number; cpuModel: string; cpuBusyPercent: number | null;
  memory: { totalBytes: number; freeBytes: number; usedPercent: number };
  disk: { freeBytes: number; totalBytes: number } | null;
  uptimeSeconds: number; hostname: string; osVersion: string; arch: string;
}
export interface WifiNetwork { ssid: string; signal?: number; signalPercent?: number; auth?: string; authentication?: string; secured?: boolean; bssid?: string; channel?: number }
export interface WifiDetail { ssid?: string | null; signal?: number | null; state?: string; ip?: string | null; [k: string]: unknown }
export interface BatteryStatus { percent?: number | null; charging?: boolean | null; status?: string | null; [k: string]: unknown }
export interface SystemInfo {
  hostname: string; platform: string; arch: string; os_version: string; cpu_count: number; cpu_model: string;
  uptime_seconds: number; total_memory_mb: number; free_memory_mb: number; disk_free_gb: number | null; disk_free_bytes: number | null;
}
export interface KioskShellState { supported: boolean; enabled: boolean }
export type EventLogQuery = { logName?: 'System' | 'Application'; level?: 'all' | 'critical' | 'error' | 'warning' | 'information'; maxEvents?: number };

// ─── Preload surface we rely on ──────────────────────────────

interface WinExtPreload {
  getDisplayModes: () => Promise<BridgeResult<{ current: CurrentDisplayMode | null; modes: DisplayMode[] }>>;
  setResolution: (w: number, h: number) => Promise<BridgeResult<{ code: number }>>;
  rotateDisplay: (deg: number) => Promise<BridgeResult<{ code: number }>>;
  getNightLightState: () => Promise<BridgeResult<{ state: 'on' | 'off' | 'unknown'; enabled: boolean }>>;
  screenshotToPictures: () => Promise<BridgeResult<{ path: string }>>;
  getMute: () => Promise<BridgeResult<{ muted: boolean }>>;
  setMute: (m: boolean) => Promise<BridgeResult<{ muted: boolean }>>;
  playSystemSound: (name: string) => Promise<BridgeResult>;
  getAudioDevices: () => Promise<BridgeResult<{ devices: AudioDevice[] }>>;
  setDefaultAudioDevice: (id: string) => Promise<BridgeResult>;
  getNetAdapters: () => Promise<BridgeResult<{ adapters: NetAdapter[] }>>;
  toggleWifi: (enabled: boolean) => Promise<BridgeResult<{ enabled: boolean }>>;
  getBluetoothDevices: () => Promise<BridgeResult<{ devices: BluetoothDevice[]; radioPresent: boolean; radioEnabled: boolean }>>;
  toggleBluetooth: (enabled: boolean) => Promise<BridgeResult<{ enabled: boolean }>>;
  ping: (host: string) => Promise<PingResult>;
  getProcesses: () => Promise<BridgeResult<{ processes: ProcessInfo[] }>>;
  killProcess: (pid: number) => Promise<BridgeResult<{ pid: number }>>;
  launchApp: (appId: string) => Promise<BridgeResult>;
  getLaunchableApps: () => Promise<BridgeResult<{ apps: LaunchableApp[] }>>;
  getSystemPerformance: () => Promise<BridgeResult<SystemPerformance>>;
  getInstalledApps: () => Promise<BridgeResult<{ apps: InstalledApp[] }>>;
  setEnvVar: (name: string, value: string | null) => Promise<BridgeResult<{ name: string }>>;
  getDrives: () => Promise<BridgeResult<{ drives: DriveInfo[] }>>;
  openFolder: (folder: string) => Promise<BridgeResult>;
  getRecentFiles: (limit?: number) => Promise<BridgeResult<{ files: RecentFile[] }>>;
  recycleItem: (target: string) => Promise<BridgeResult>;
  getEventLog: (q?: EventLogQuery) => Promise<BridgeResult<{ events: EventLogEntry[]; logName: string; level: string }>>;
  getScheduledTasks: () => Promise<BridgeResult<{ tasks: ScheduledTask[] }>>;
  sendNativeToast: (title: string, body: string) => Promise<BridgeResult>;
}

interface ElectronPreload {
  isElectron?: boolean;
  platform?: string;
  getVersion?: () => Promise<string>;
  getSystemInfo?: () => Promise<SystemInfo>;
  getCpuUsage?: () => Promise<number>;
  checkDiskSpace?: () => Promise<{ freeBytes: number | null; totalBytes: number | null; warn: boolean }>;
  getBatteryStatus?: () => Promise<BatteryStatus | null>;
  getBattery?: () => Promise<BatteryStatus | null>;
  getDisplays?: () => Promise<DisplayInfo[]>;
  setBrightness?: (level: number) => Promise<unknown>;
  getBrightness?: () => Promise<number | null>;
  setVolume?: (level: number) => Promise<unknown>;
  getVolume?: () => Promise<number | null>;
  wifiGetDetail?: () => Promise<WifiDetail | null>;
  wifiScanNetworks?: () => Promise<WifiNetwork[] | null>;
  wifiListProfiles?: () => Promise<string[] | Array<{ name: string }> | null>;
  wifiConnect?: (profile: string) => Promise<{ ok: boolean; error?: string } | null>;
  wifiDisconnect?: () => Promise<unknown>;
  getClipboardText?: () => Promise<string>;
  setClipboardText?: (text: string) => Promise<unknown>;
  showNotification?: (title: string, body: string) => Promise<unknown>;
  captureScreen?: () => Promise<{ ok: boolean; dataUrl?: string; reason?: string }>;
  saveScreenshot?: (dataUrl: string, filename?: string) => Promise<{ ok: boolean; path?: string; reason?: string }>;
  restartApp?: () => Promise<unknown>;
  shutdownOs?: () => Promise<{ ok: boolean; error?: string }>;
  restartOs?: () => Promise<{ ok: boolean; error?: string }>;
  returnToWindows?: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  getKioskShellState?: () => Promise<KioskShellState | null>;
  setKioskShell?: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  getAutoLaunchState?: () => Promise<{ enabled: boolean } | boolean | null>;
  setAutoLaunch?: (enabled: boolean) => Promise<unknown>;
  keepAwake?: () => Promise<unknown>;
  allowSleep?: () => Promise<unknown>;
  getIdleTime?: () => Promise<number>;
  winExt?: Partial<WinExtPreload>;
}

export function getElectronBridge(): ElectronPreload | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electron?: ElectronPreload }).electron;
}

const NOT_ELECTRON: BridgeFail = { ok: false, error: 'not_electron' };

/** Wraps a preload method so a missing bridge resolves to a typed failure rather than throwing. */
function ext<K extends keyof WinExtPreload>(name: K): WinExtPreload[K] {
  return (async (...args: unknown[]) => {
    const fn = getElectronBridge()?.winExt?.[name] as ((...a: unknown[]) => Promise<unknown>) | undefined;
    if (typeof fn !== 'function') return name === 'ping' ? { ...NOT_ELECTRON, host: String(args[0] ?? ''), sent: 0, received: 0, lost: 0, minMs: null, maxMs: null, avgMs: null } : NOT_ELECTRON;
    try {
      return await fn(...args);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }) as WinExtPreload[K];
}

/** Wraps a legacy value-returning preload method; missing → null, throw → null. */
function legacy<A extends unknown[], R>(pick: (b: ElectronPreload) => ((...a: A) => Promise<R>) | undefined): (...a: A) => Promise<R | null> {
  return async (...args: A) => {
    const b = getElectronBridge();
    const fn = b ? pick(b) : undefined;
    if (typeof fn !== 'function') return null;
    try {
      return await fn(...args);
    } catch {
      return null;
    }
  };
}

export interface WindowsBridge extends WinExtPreload {
  /** window.electron exists — we're inside the desktop shell. */
  available: boolean;
  /** The extended `winExt` group is present (desktop build ≥ this PR). */
  extendedAvailable: boolean;
  isWindows: boolean;
  platform: string;

  // ── Reused legacy surface (10) ──
  getVersion: () => Promise<string | null>;
  getSystemInfo: () => Promise<SystemInfo | null>;
  getCpuUsage: () => Promise<number | null>;
  checkDiskSpace: () => Promise<{ freeBytes: number | null; totalBytes: number | null; warn: boolean } | null>;
  getBattery: () => Promise<BatteryStatus | null>;
  getDisplays: () => Promise<DisplayInfo[] | null>;
  setBrightness: (level: number) => Promise<unknown>;
  getBrightness: () => Promise<number | null>;
  setVolume: (level: number) => Promise<unknown>;
  getVolume: () => Promise<number | null>;
  wifiGetDetail: () => Promise<WifiDetail | null>;
  wifiScanNetworks: () => Promise<WifiNetwork[] | null>;
  wifiConnect: (profile: string) => Promise<{ ok: boolean; error?: string } | null>;
  wifiDisconnect: () => Promise<unknown>;
  getClipboardText: () => Promise<string | null>;
  setClipboardText: (text: string) => Promise<unknown>;
  showNotification: (title: string, body: string) => Promise<unknown>;
  captureScreen: () => Promise<{ ok: boolean; dataUrl?: string; reason?: string } | null>;
  saveScreenshot: (dataUrl: string, filename?: string) => Promise<{ ok: boolean; path?: string; reason?: string } | null>;
  restartApp: () => Promise<unknown>;
  shutdownOs: () => Promise<{ ok: boolean; error?: string } | null>;
  restartOs: () => Promise<{ ok: boolean; error?: string } | null>;
  getKioskShellState: () => Promise<KioskShellState | null>;
  setKioskShell: (enabled: boolean) => Promise<{ ok: boolean; error?: string } | null>;
  getAutoLaunchState: () => Promise<boolean>;
  setAutoLaunch: (enabled: boolean) => Promise<unknown>;
  keepAwake: () => Promise<unknown>;
  allowSleep: () => Promise<unknown>;
  getIdleTime: () => Promise<number | null>;

  /** Screenshot helper: prefers the dialog-free winExt save, falls back to capture+save dialog. */
  takeScreenshot: () => Promise<BridgeResult<{ path: string }>>;
}

/** Module-level singleton: the bridge surface never changes after preload runs. */
export function createWindowsBridge(): WindowsBridge {
  const b = getElectronBridge();
  const platform = b?.platform ?? (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform) ? 'win32' : 'unknown');
  const bridge: WindowsBridge = {
    available: Boolean(b?.isElectron),
    extendedAvailable: Boolean(b?.winExt && typeof b.winExt.getSystemPerformance === 'function'),
    isWindows: platform === 'win32',
    platform,

    getVersion: legacy((e) => e.getVersion),
    getSystemInfo: legacy((e) => e.getSystemInfo),
    getCpuUsage: legacy((e) => e.getCpuUsage),
    checkDiskSpace: legacy((e) => e.checkDiskSpace),
    getBattery: legacy((e) => e.getBatteryStatus ?? e.getBattery),
    getDisplays: legacy((e) => e.getDisplays),
    setBrightness: legacy((e) => e.setBrightness),
    getBrightness: legacy((e) => e.getBrightness),
    setVolume: legacy((e) => e.setVolume),
    getVolume: legacy((e) => e.getVolume),
    wifiGetDetail: legacy((e) => e.wifiGetDetail),
    wifiScanNetworks: legacy((e) => e.wifiScanNetworks),
    wifiConnect: legacy((e) => e.wifiConnect),
    wifiDisconnect: legacy((e) => e.wifiDisconnect),
    getClipboardText: legacy((e) => e.getClipboardText),
    setClipboardText: legacy((e) => e.setClipboardText),
    showNotification: legacy((e) => e.showNotification),
    captureScreen: legacy((e) => e.captureScreen),
    saveScreenshot: legacy((e) => e.saveScreenshot),
    restartApp: legacy((e) => e.restartApp),
    shutdownOs: legacy((e) => e.shutdownOs),
    restartOs: legacy((e) => e.restartOs),
    getKioskShellState: legacy((e) => e.getKioskShellState),
    setKioskShell: legacy((e) => e.setKioskShell),
    getAutoLaunchState: async () => {
      const v = await legacy((e) => e.getAutoLaunchState)();
      return typeof v === 'boolean' ? v : Boolean(v && typeof v === 'object' && v.enabled);
    },
    setAutoLaunch: legacy((e) => e.setAutoLaunch),
    keepAwake: legacy((e) => e.keepAwake),
    allowSleep: legacy((e) => e.allowSleep),
    getIdleTime: legacy((e) => e.getIdleTime),

    getDisplayModes: ext('getDisplayModes'),
    setResolution: ext('setResolution'),
    rotateDisplay: ext('rotateDisplay'),
    getNightLightState: ext('getNightLightState'),
    screenshotToPictures: ext('screenshotToPictures'),
    getMute: ext('getMute'),
    setMute: ext('setMute'),
    playSystemSound: ext('playSystemSound'),
    getAudioDevices: ext('getAudioDevices'),
    setDefaultAudioDevice: ext('setDefaultAudioDevice'),
    getNetAdapters: ext('getNetAdapters'),
    toggleWifi: ext('toggleWifi'),
    getBluetoothDevices: ext('getBluetoothDevices'),
    toggleBluetooth: ext('toggleBluetooth'),
    ping: ext('ping'),
    getProcesses: ext('getProcesses'),
    killProcess: ext('killProcess'),
    launchApp: ext('launchApp'),
    getLaunchableApps: ext('getLaunchableApps'),
    getSystemPerformance: ext('getSystemPerformance'),
    getInstalledApps: ext('getInstalledApps'),
    setEnvVar: ext('setEnvVar'),
    getDrives: ext('getDrives'),
    openFolder: ext('openFolder'),
    getRecentFiles: ext('getRecentFiles'),
    recycleItem: ext('recycleItem'),
    getEventLog: ext('getEventLog'),
    getScheduledTasks: ext('getScheduledTasks'),
    sendNativeToast: ext('sendNativeToast'),

    takeScreenshot: async () => {
      if (bridge.extendedAvailable) {
        const r = await bridge.screenshotToPictures();
        if (r.ok || r.error !== 'not_electron') return r;
      }
      const cap = await bridge.captureScreen();
      if (!cap?.ok || !cap.dataUrl) return { ok: false, error: cap?.reason ?? 'capture_failed' };
      const saved = await bridge.saveScreenshot(cap.dataUrl);
      return saved?.ok && saved.path ? { ok: true, path: saved.path } : { ok: false, error: saved?.reason ?? 'save_failed' };
    },
  };
  return bridge;
}

/** React hook — memoized per mount; the preload surface is static so this never needs to re-run. */
export function useWindowsBridge(): WindowsBridge {
  return useMemo(createWindowsBridge, []);
}

export default useWindowsBridge;
