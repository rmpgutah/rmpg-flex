import React, { useEffect, useState } from 'react';
import { Wifi, WifiOff, Battery, BatteryCharging, BatteryLow, Navigation, RefreshCw, Cpu } from 'lucide-react';

interface BatteryStatus {
  charging: boolean;
  percent: number;
}

type ConnectivityState = 'online' | 'offline' | 'degraded';

function useTrayPolling() {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityState>('online');
  const [gpsLocked, setGpsLocked] = useState(false);
  const [syncPending, setSyncPending] = useState(0);

  // Battery: poll every 60s (rarely changes fast)
  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron || !el?.getBatteryStatus) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const b: BatteryStatus = await el.getBatteryStatus();
        if (!cancelled) setBattery(b);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Network: listen to browser online/offline + probe API every 30s
  useEffect(() => {
    const onOnline = () => setConnectivity('online');
    const onOffline = () => setConnectivity('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (!navigator.onLine) setConnectivity('offline');

    let cancelled = false;
    const probe = async () => {
      if (!navigator.onLine) { if (!cancelled) setConnectivity('offline'); return; }
      try {
        const r = await fetch('https://api.rmpgutah.us/api/health', { signal: AbortSignal.timeout(4000) });
        if (!cancelled) setConnectivity(r.ok ? 'online' : 'degraded');
      } catch {
        if (!cancelled) setConnectivity(navigator.onLine ? 'degraded' : 'offline');
      }
    };
    probe();
    const id = setInterval(probe, 30_000);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  // GPS lock: probe hardware presence every 30s
  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron || !el?.checkGpsHardwarePresent) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await el.checkGpsHardwarePresent();
        // classifyGpsPresence returns { present, portBusy } — read the field
        const locked = typeof result === 'boolean' ? result : !!result?.present;
        if (!cancelled) setGpsLocked(locked);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Sync queue: preload exposes `getOfflineWriteQueueSize` (returns number),
  // not `getSyncStatus` — using the wrong name made the guard always true,
  // causing an immediate early return and a permanently-zero counter.
  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron || !el?.getOfflineWriteQueueSize) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const count: number = await el.getOfflineWriteQueueSize();
        if (!cancelled) setSyncPending(count ?? 0);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // CPU usage: sample every 15s (getCpuUsage itself takes 100ms, so keep interval > 1s)
  const [cpuPercent, setCpuPercent] = useState<number | null>(null);
  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron || !el?.getCpuUsage) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const pct: number = await el.getCpuUsage();
        if (!cancelled) setCpuPercent(pct);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { battery, connectivity, gpsLocked, syncPending, cpuPercent };
}

function BatteryIcon({ battery }: { battery: BatteryStatus }) {
  if (battery.charging) return <BatteryCharging className="w-3.5 h-3.5" style={{ color: '#4ade80' }} />;
  if (battery.percent <= 15) return <BatteryLow className="w-3.5 h-3.5" style={{ color: 'var(--sev-critical, #ef4444)' }} />;
  return <Battery className="w-3.5 h-3.5" style={{ color: battery.percent > 30 ? 'var(--text-secondary, #adbccc)' : 'var(--sev-high, #f97316)' }} />;
}

function BatteryLabel({ battery }: { battery: BatteryStatus }) {
  return (
    <span style={{ fontSize: 9, color: battery.percent <= 15 ? 'var(--sev-critical, #ef4444)' : 'var(--text-secondary, #adbccc)', fontVariantNumeric: 'tabular-nums' }}>
      {Number.isFinite(battery.percent) ? Math.round(battery.percent) : 0}%
    </span>
  );
}

export interface DesktopSystemTrayProps {
  className?: string;
}

export default function DesktopSystemTray({ className }: DesktopSystemTrayProps) {
  const { battery, connectivity, gpsLocked, syncPending, cpuPercent } = useTrayPolling();

  const isElectron = !!(window as any).electron?.isElectron;
  if (!isElectron) return null;

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      role="status"
      aria-label="System status"
    >
      {/* Sync queue indicator */}
      {syncPending > 0 && (
        <div
          title={`${syncPending} item${syncPending !== 1 ? 's' : ''} queued for sync`}
          style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'default' }}
        >
          <RefreshCw className="w-3 h-3 animate-spin" style={{ color: 'var(--sev-medium, #f59e0b)' }} />
          <span style={{ fontSize: 9, color: 'var(--sev-medium, #f59e0b)', fontVariantNumeric: 'tabular-nums' }}>{syncPending}</span>
        </div>
      )}

      {/* GPS lock */}
      {gpsLocked && (
        <Navigation
          className="w-3 h-3"
          style={{ color: '#4ade80' }}
          aria-label="GPS locked"
        />
      )}

      {/* CPU usage — only shown when elevated (>70%) to avoid visual clutter */}
      {cpuPercent != null && cpuPercent >= 70 && (
        <div
          title={`CPU usage: ${cpuPercent}%`}
          style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'default' }}
        >
          <Cpu
            className="w-3 h-3"
            style={{ color: cpuPercent >= 90 ? 'var(--sev-critical, #ef4444)' : 'var(--sev-medium, #f59e0b)' }}
          />
          <span style={{ fontSize: 9, color: cpuPercent >= 90 ? 'var(--sev-critical, #ef4444)' : 'var(--sev-medium, #f59e0b)', fontVariantNumeric: 'tabular-nums' }}>
            {cpuPercent}%
          </span>
        </div>
      )}

      {/* Network */}
      {connectivity === 'online' ? (
        <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary, #adbccc)' }} aria-label="Online" />
      ) : connectivity === 'degraded' ? (
        <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--sev-medium, #f59e0b)' }} aria-label="Network degraded — API unreachable" />
      ) : (
        <WifiOff className="w-3.5 h-3.5" style={{ color: 'var(--sev-critical, #ef4444)' }} aria-label="Offline" />
      )}

      {/* Battery */}
      {battery != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} title={`Battery: ${Number.isFinite(battery.percent) ? Math.round(battery.percent) : 0}%${battery.charging ? ' (charging)' : ''}`}>
          <BatteryIcon battery={battery} />
          <BatteryLabel battery={battery} />
        </div>
      )}
    </div>
  );
}
