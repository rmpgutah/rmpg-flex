import React, { useEffect, useState } from 'react';
import { Wifi, WifiOff, Battery, BatteryCharging, BatteryLow, Navigation, RefreshCw } from 'lucide-react';

interface BatteryStatus {
  charging: boolean;
  percent: number;
}

interface SyncStatus {
  queueDepth?: number;
  pending?: number; // legacy alias — some versions returned this name
  isSyncing?: boolean;
  lastPush?: string | null;
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
        const present = await el.checkGpsHardwarePresent();
        if (!cancelled) setGpsLocked(!!present);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Sync queue: read from Tauri offline state
  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron || !el?.getSyncStatus) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s: SyncStatus = await el.getSyncStatus();
        if (!cancelled) setSyncPending(s?.queueDepth ?? s?.pending ?? 0);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { battery, connectivity, gpsLocked, syncPending };
}

function BatteryIcon({ battery }: { battery: BatteryStatus }) {
  if (battery.charging) return <BatteryCharging className="w-3.5 h-3.5" style={{ color: '#4ade80' }} />;
  if (battery.percent <= 15) return <BatteryLow className="w-3.5 h-3.5" style={{ color: 'var(--sev-critical, #ef4444)' }} />;
  return <Battery className="w-3.5 h-3.5" style={{ color: battery.percent > 30 ? 'var(--text-secondary, #adbccc)' : 'var(--sev-high, #f97316)' }} />;
}

function BatteryLabel({ battery }: { battery: BatteryStatus }) {
  return (
    <span style={{ fontSize: 9, color: battery.percent <= 15 ? 'var(--sev-critical, #ef4444)' : 'var(--text-secondary, #adbccc)', fontVariantNumeric: 'tabular-nums' }}>
      {Math.round(battery.percent)}%
    </span>
  );
}

export interface DesktopSystemTrayProps {
  className?: string;
}

export default function DesktopSystemTray({ className }: DesktopSystemTrayProps) {
  const { battery, connectivity, gpsLocked, syncPending } = useTrayPolling();

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} title={`Battery: ${Math.round(battery.percent ?? 0)}%${battery.charging ? ' (charging)' : ''}`}>
          <BatteryIcon battery={battery} />
          <BatteryLabel battery={battery} />
        </div>
      )}
    </div>
  );
}
