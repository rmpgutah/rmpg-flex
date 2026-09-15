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
import { getDesktopRuntimeState, type DesktopRuntimeState } from '../utils/desktopRuntime';

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
export interface BridgeHealth {
  ok: true; bridgeVersion: number; appVersion: string; platform: string; arch: string;
  electronVersion: string | null; chromeVersion: string | null; nodeVersion: string | null;
  kioskShell: boolean; processUptimeSeconds: number;
}
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
  getBridgeHealth?: () => Promise<BridgeHealth>;
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
const BRIDGE_TIMEOUT_MS = 30_000;

function withBridgeTimeout<T>(operation: Promise<T>, method: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`FlexOS native operation timed out: ${method}`)), BRIDGE_TIMEOUT_MS);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Wraps a preload method so a missing bridge resolves to a typed failure rather than throwing. */
function ext<K extends keyof WinExtPreload>(name: K): WinExtPreload[K] {
  return (async (...args: unknown[]) => {
    const fn = getElectronBridge()?.winExt?.[name] as ((...a: unknown[]) => Promise<unknown>) | undefined;
    if (typeof fn !== 'function') return name === 'ping' ? { ...NOT_ELECTRON, host: String(args[0] ?? ''), sent: 0, received: 0, lost: 0, minMs: null, maxMs: null, avgMs: null } : NOT_ELECTRON;
    try {
      return await withBridgeTimeout(fn(...args), String(name));
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }) as WinExtPreload[K];
}

/** Wraps a legacy value-returning preload method; missing → null, throw → null. */
function legacy<A extends unknown[], R>(name: string, pick: (b: ElectronPreload) => ((...a: A) => Promise<R>) | undefined): (...a: A) => Promise<R | null> {
  return async (...args: A) => {
    const b = getElectronBridge();
    const fn = b ? pick(b) : undefined;
    if (typeof fn !== 'function') return null;
    try {
      return await withBridgeTimeout(fn(...args), name);
    } catch {
      return null;
    }
  };
}

export interface WindowsBridge extends WinExtPreload {
  /** Distinguishes a browser from a FlexOS shell whose preload failed. */
  runtimeState: DesktopRuntimeState;
  shellDetected: boolean;
  /** window.electron exists — we're inside the desktop shell. */
  available: boolean;
  /** The extended `winExt` group is present (desktop build ≥ this PR). */
  extendedAvailable: boolean;
  isWindows: boolean;
  platform: string;

  // ── Reused legacy surface (10) ──
  getVersion: () => Promise<string | null>;
  getBridgeHealth: () => Promise<BridgeHealth | null>;
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
  const runtimeState = getDesktopRuntimeState(b);
  const platform = b?.platform ?? (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform) ? 'win32' : 'unknown');
  const bridge: WindowsBridge = {
    runtimeState,
    shellDetected: runtimeState !== 'browser',
    available: Boolean(b?.isElectron),
    extendedAvailable: Boolean(b?.winExt && typeof b.winExt.getSystemPerformance === 'function'),
    isWindows: platform === 'win32',
    platform,

    getVersion: legacy('getVersion', (e) => e.getVersion),
    getBridgeHealth: legacy('getBridgeHealth', (e) => e.getBridgeHealth),
    getSystemInfo: legacy('getSystemInfo', (e) => e.getSystemInfo),
    getCpuUsage: legacy('getCpuUsage', (e) => e.getCpuUsage),
    checkDiskSpace: legacy('checkDiskSpace', (e) => e.checkDiskSpace),
    getBattery: legacy('getBattery', (e) => e.getBatteryStatus ?? e.getBattery),
    getDisplays: legacy('getDisplays', (e) => e.getDisplays),
    setBrightness: legacy('setBrightness', (e) => e.setBrightness),
    getBrightness: legacy('getBrightness', (e) => e.getBrightness),
    setVolume: legacy('setVolume', (e) => e.setVolume),
    getVolume: legacy('getVolume', (e) => e.getVolume),
    wifiGetDetail: legacy('wifiGetDetail', (e) => e.wifiGetDetail),
    wifiScanNetworks: legacy('wifiScanNetworks', (e) => e.wifiScanNetworks),
    wifiConnect: legacy('wifiConnect', (e) => e.wifiConnect),
    wifiDisconnect: legacy('wifiDisconnect', (e) => e.wifiDisconnect),
    getClipboardText: legacy('getClipboardText', (e) => e.getClipboardText),
    setClipboardText: legacy('setClipboardText', (e) => e.setClipboardText),
    showNotification: legacy('showNotification', (e) => e.showNotification),
    captureScreen: legacy('captureScreen', (e) => e.captureScreen),
    saveScreenshot: legacy('saveScreenshot', (e) => e.saveScreenshot),
    restartApp: legacy('restartApp', (e) => e.restartApp),
    shutdownOs: legacy('shutdownOs', (e) => e.shutdownOs),
    restartOs: legacy('restartOs', (e) => e.restartOs),
    getKioskShellState: legacy('getKioskShellState', (e) => e.getKioskShellState),
    setKioskShell: legacy('setKioskShell', (e) => e.setKioskShell),
    getAutoLaunchState: async () => {
      const v = await legacy('getAutoLaunchState', (e) => e.getAutoLaunchState)();
      return typeof v === 'boolean' ? v : Boolean(v && typeof v === 'object' && v.enabled);
    },
    setAutoLaunch: legacy('setAutoLaunch', (e) => e.setAutoLaunch),
    keepAwake: legacy('keepAwake', (e) => e.keepAwake),
    allowSleep: legacy('allowSleep', (e) => e.allowSleep),
    getIdleTime: legacy('getIdleTime', (e) => e.getIdleTime),

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
