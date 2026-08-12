import React, { useEffect, useState } from 'react';
import { Shield, Cpu, HardDrive, MemoryStick, X, Activity, User, Clock, Wifi, Battery } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface SystemInfo {
  hostname?: string;
  platform?: string;
  arch?: string;
  cpu_count?: number;
  cpu_model?: string;
  uptime_seconds?: number;
  total_memory_mb?: number;
  free_memory_mb?: number;
  disk_free_gb?: number | null;
}

interface DiskInfo {
  freeBytes?: number | null;
  warn?: boolean;
}

interface NetworkInterface {
  name?: string;
  address?: string;
  type?: string;
}

interface BatteryInfo {
  percent?: number;
  charging?: boolean;
}

const FLEXOS_VERSION = '1.0.0';
const RMPG_FLEX_VERSION = '5.9.0';

function safeFixed(v: number | null | undefined, dec = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(dec);
}

function pct(used?: number, total?: number): number | null {
  if (used == null || total == null || total === 0) return null;
  const p = Math.round((used / total) * 100);
  return isFinite(p) ? p : null;
}

function uptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function HealthBar({ percent, danger = 80, warn = 60 }: { percent: number | null; danger?: number; warn?: number }) {
  if (percent === null) return <span style={{ fontSize: 10, color: 'var(--text-muted, #8da0b3)' }}>—</span>;
  const color = percent >= danger ? 'var(--sev-critical, #ef4444)' : percent >= warn ? 'var(--sev-warn, #f59e0b)' : 'var(--accent-silver-400, #c3ccd6)';
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <div style={{ flex: 1, height: 4, background: 'rgba(195,204,214,0.12)', overflow: 'hidden' }}>
        <div style={{ width: `${clamped}%`, height: '100%', background: color, transition: 'width 400ms ease' }} />
      </div>
      <span style={{ fontSize: 9, color, fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>
        {clamped}%
      </span>
    </div>
  );
}

function Row({ icon: Icon, label, value, children }: { icon: React.ElementType; label: string; value?: string | null; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid rgba(195,204,214,0.04)' }}>
      <Icon style={{ width: 12, height: 12, color: 'var(--text-muted, #8da0b3)', flexShrink: 0 }} />
      <span style={{ fontSize: 9, color: 'var(--text-muted, #8da0b3)', letterSpacing: '0.06em', textTransform: 'uppercase', width: 90, flexShrink: 0 }}>{label}</span>
      {children ?? (
        <span style={{ fontSize: 10, color: 'var(--text-primary, #f0f4f9)', fontVariantNumeric: 'tabular-nums' }}>
          {value ?? '—'}
        </span>
      )}
    </div>
  );
}

export interface FlexOSSystemDashboardProps {
  onClose: () => void;
}

export default function FlexOSSystemDashboard({ onClose }: FlexOSSystemDashboardProps) {
  const { user } = useAuth();
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [networks, setNetworks] = useState<NetworkInterface[]>([]);
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [sessionStart] = useState(() => new Date());

  useEffect(() => {
    const el = (window as any).electron;
    if (!el) return;

    el.getSystemInfo?.()
      .then((info: SystemInfo) => setSysInfo(info ?? null))
      .catch(() => {});

    el.checkDiskSpace?.('/')
      .then((d: DiskInfo) => setDisk(d ?? null))
      .catch(() => {});

    el.getVersion?.()
      .then((v: string) => setAppVersion(v))
      .catch(() => {});

    el.getNetworkInterfaces?.()
      .then((ifaces: NetworkInterface[]) => setNetworks(Array.isArray(ifaces) ? ifaces.slice(0, 3) : []))
      .catch(() => {});

    el.getBatteryStatus?.()
      .then((b: BatteryInfo | null) => setBattery(b ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const totalMb = sysInfo?.total_memory_mb ?? 0;
  const freeMb = sysInfo?.free_memory_mb ?? 0;
  const memUsedPct = totalMb > 0 ? pct(totalMb - freeMb, totalMb) : null;
  const diskFreeGb = sysInfo?.disk_free_gb ?? (disk?.freeBytes != null ? Math.round((disk.freeBytes / (1024 ** 3)) * 10) / 10 : null);
  const diskUsedPct: number | null = (() => {
    if (diskFreeGb == null || totalMb <= 0) return null;
    return null;
  })();

  const hasHardware = sysInfo != null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 460, maxHeight: '85vh', background: 'var(--surface-raised, #1a3352)', border: '1px solid rgba(195,204,214,0.1)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--surface-base, #22405f)', borderBottom: '1px solid rgba(195,204,214,0.08)', flexShrink: 0 }}>
          <Shield style={{ width: 16, height: 16, color: 'var(--accent-silver-400, #c3ccd6)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #f0f4f9)' }}>FlexOS</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted, #8da0b3)', letterSpacing: '0.06em', marginTop: 1 }}>
              ROCKY MOUNTAIN PROTECTIVE GROUP — SYSTEM DASHBOARD
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <X style={{ width: 14, height: 14, color: 'var(--text-muted, #8da0b3)' }} />
          </button>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', flex: 1 }}>
          {/* Version block */}
          <div style={{ padding: '10px 12px', background: 'rgba(195,204,214,0.04)', border: '1px solid rgba(195,204,214,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary, #f0f4f9)' }}>FlexOS {FLEXOS_VERSION}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted, #8da0b3)', marginTop: 2 }}>RMPG Flex {appVersion ?? RMPG_FLEX_VERSION}</div>
            </div>
            <div style={{ fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-silver-400, #c3ccd6)', fontWeight: 700 }}>
              Licensed
            </div>
          </div>

          {/* Session */}
          <section>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-silver-400, #c3ccd6)', marginBottom: 8, fontWeight: 600 }}>Session</div>
            <Row icon={User} label="Officer" value={user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username : '—'} />
            <Row icon={Shield} label="Role" value={user?.role ?? '—'} />
            <Row icon={Clock} label="Session Start" value={sessionStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
            {battery && (
              <Row icon={Battery} label="Battery" value={`${battery.percent ?? '?'}%${battery.charging ? ' ⚡' : ''}`} />
            )}
          </section>

          {/* Hardware */}
          {hasHardware && (
            <section>
              <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-silver-400, #c3ccd6)', marginBottom: 8, fontWeight: 600 }}>Hardware</div>
              <Row icon={Activity} label="Hostname" value={sysInfo!.hostname ?? '—'} />
              <Row icon={Activity} label="Platform" value={`${sysInfo!.platform ?? '—'} / ${sysInfo!.arch ?? '—'}`} />
              <Row icon={Cpu} label="CPU" value={`${sysInfo!.cpu_count ?? '—'} cores`} />
              <Row icon={Activity} label="Uptime" value={uptime(sysInfo!.uptime_seconds)} />
              <Row icon={MemoryStick} label="Memory">
                <HealthBar percent={memUsedPct} danger={85} warn={65} />
                <span style={{ fontSize: 9, color: 'var(--text-muted, #8da0b3)', marginLeft: 8, whiteSpace: 'nowrap' }}>
                  {totalMb > 0 ? `${Math.round(totalMb / 1024)} GB` : '—'}
                </span>
              </Row>
              <Row icon={HardDrive} label="Disk Free">
                <span style={{ fontSize: 10, color: diskFreeGb != null && diskFreeGb < 5 ? 'var(--sev-critical, #ef4444)' : 'var(--text-primary, #f0f4f9)' }}>
                  {diskFreeGb != null ? `${safeFixed(diskFreeGb, 1)} GB` : '—'}
                </span>
              </Row>
            </section>
          )}

          {/* Network */}
          {networks.length > 0 && (
            <section>
              <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-silver-400, #c3ccd6)', marginBottom: 8, fontWeight: 600 }}>Network</div>
              {networks.map((n, i) => (
                <Row key={i} icon={Wifi} label={n.name ?? `Interface ${i + 1}`} value={n.address ?? '—'} />
              ))}
            </section>
          )}

          {!hasHardware && (
            <div style={{ fontSize: 10, color: 'var(--text-muted, #8da0b3)', textAlign: 'center', padding: '8px 0' }}>
              Hardware info available in the FlexOS desktop app
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(195,204,214,0.06)', fontSize: 8, color: 'var(--text-muted, #8da0b3)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <span>© {new Date().getFullYear() /* new-date-ok */} Rocky Mountain Protective Group</span>
          <span>Press Esc to close</span>
        </div>
      </div>
    </div>
  );
}
