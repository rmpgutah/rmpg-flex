/**
 * FlexOS System Dashboard
 *
 * A modal/overlay that shows OS identity, hardware info (via Tauri bridge),
 * active session details, and system health indicators.
 * Opened from the desktop right-click menu → "System Info" (or Ctrl+I).
 */
import React, { useEffect, useState } from 'react';
import { Shield, Cpu, HardDrive, MemoryStick, X, Activity, User, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface SystemInfo {
  hostname?: string;
  platform?: string;
  arch?: string;
  os_version?: string;
  total_memory_mb?: number;
  free_memory_mb?: number;
  cpu_count?: number;
  uptime_seconds?: number;
}

interface DiskSpace {
  total_gb?: number;
  free_gb?: number;
  used_percent?: number;
}

const FLEXOS_VERSION = '1.0.0';
const RMPG_FLEX_VERSION = '5.9.0';

function pct(used?: number, total?: number): number | null {
  if (!used || !total) return null;
  return Math.round((used / total) * 100);
}

function uptime(seconds?: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function HealthBar({ percent, danger = 80 }: { percent: number | null; danger?: number }) {
  if (percent === null) return <span style={{ fontSize: 10, color: 'var(--text-muted, #8da0b3)' }}>—</span>;
  const color = percent >= danger ? 'var(--sev-critical, #ef4444)' : percent >= 60 ? 'var(--sev-warn, #f59e0b)' : 'var(--accent-silver-400, #c3ccd6)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <div style={{ flex: 1, height: 4, background: 'rgba(195,204,214,0.12)', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', background: color, transition: 'width 400ms ease' }} />
      </div>
      <span style={{ fontSize: 9, color, fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>
        {percent}%
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
  const [disk, setDisk] = useState<DiskSpace | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [sessionStart] = useState(() => new Date());

  useEffect(() => {
    const el = (window as any).electron;
    if (!el) return;

    el.getSystemInfo?.()
      .then((info: SystemInfo) => setSysInfo(info))
      .catch(() => { /* not in Tauri */ });

    el.checkDiskSpace?.('/')
      .then((d: DiskSpace) => setDisk(d))
      .catch(() => { /* not in Tauri */ });

    el.getVersion?.()
      .then((v: string) => setAppVersion(v))
      .catch(() => { /* not in Tauri */ });
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const memUsedPct = sysInfo
    ? pct((sysInfo.total_memory_mb ?? 0) - (sysInfo.free_memory_mb ?? 0), sysInfo.total_memory_mb)
    : null;

  const diskUsedPct = disk?.used_percent != null ? Math.round(disk.used_percent) : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9990,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 440,
          background: 'var(--surface-raised, #1a3352)',
          border: '1px solid rgba(195,204,214,0.1)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          background: 'var(--surface-base, #22405f)',
          borderBottom: '1px solid rgba(195,204,214,0.08)',
        }}>
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

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Version block */}
          <div style={{
            padding: '10px 12px',
            background: 'rgba(195,204,214,0.04)',
            border: '1px solid rgba(195,204,214,0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary, #f0f4f9)' }}>
                FlexOS {FLEXOS_VERSION}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted, #8da0b3)', marginTop: 2 }}>
                RMPG Flex {appVersion ?? RMPG_FLEX_VERSION}
              </div>
            </div>
            <div style={{
              fontSize: 8,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--accent-silver-400, #c3ccd6)',
              fontWeight: 700,
            }}>
              Licensed
            </div>
          </div>

          {/* Session */}
          <section>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-silver-400, #c3ccd6)', marginBottom: 8, fontWeight: 600 }}>
              Session
            </div>
            <Row icon={User} label="Officer" value={user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username : '—'} />
            <Row icon={Shield} label="Role" value={user?.role ?? '—'} />
            <Row icon={Clock} label="Session Start" value={sessionStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
          </section>

          {/* Hardware */}
          {sysInfo && (
            <section>
              <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-silver-400, #c3ccd6)', marginBottom: 8, fontWeight: 600 }}>
                Hardware
              </div>
              <Row icon={Activity} label="Hostname" value={sysInfo.hostname} />
              <Row icon={Cpu} label="CPU Cores" value={sysInfo.cpu_count?.toString()} />
              <Row icon={Activity} label="Uptime" value={uptime(sysInfo.uptime_seconds)} />
              <Row icon={MemoryStick} label="Memory">
                <HealthBar
                  percent={memUsedPct}
                  danger={85}
                />
                <span style={{ fontSize: 9, color: 'var(--text-muted, #8da0b3)', marginLeft: 8 }}>
                  {Math.round((sysInfo.total_memory_mb ?? 0) / 1024)} GB
                </span>
              </Row>
              {disk && (
                <Row icon={HardDrive} label="Disk">
                  <HealthBar percent={diskUsedPct} danger={90} />
                  <span style={{ fontSize: 9, color: 'var(--text-muted, #8da0b3)', marginLeft: 8 }}>
                    {disk.free_gb?.toFixed(1)} GB free
                  </span>
                </Row>
              )}
            </section>
          )}

          {!sysInfo && (
            <div style={{ fontSize: 10, color: 'var(--text-muted, #8da0b3)', textAlign: 'center', padding: '8px 0' }}>
              Hardware info available in the FlexOS desktop app
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid rgba(195,204,214,0.06)',
          fontSize: 8,
          color: 'var(--text-muted, #8da0b3)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>© {new Date().getFullYear() /* new-date-ok */} Rocky Mountain Protective Group</span>
          <span>Press Esc to close</span>
        </div>
      </div>
    </div>
  );
}
