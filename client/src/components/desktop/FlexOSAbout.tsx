/**
 * FlexOS — About screen
 *
 * Shown from the FlexOS Settings app (OS tab → About FlexOS) and from the
 * taskbar launcher (the agency shield icon long-press / right-click menu).
 * Displays version, build info, license, and hardware identity.
 */
import React, { useState, useEffect } from 'react';
import { Shield, Monitor, Cpu, HardDrive, Wifi, Battery } from 'lucide-react';

const FLEXOS_VERSION = '1.0.0';
const RMPG_FLEX_VERSION = '5.9.0';

interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  os_version: string;
  total_memory_mb: number;
  free_memory_mb: number;
  cpu_count: number;
  uptime_seconds: number;
}

interface DiskInfo {
  total_gb: number;
  free_gb: number;
  used_percent: number;
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export default function FlexOSAbout() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    const el = (window as any).electron;
    if (!el?.isElectron) return;
    el.getSystemInfo?.().then((info: SystemInfo) => setSysInfo(info)).catch(() => {});
    el.checkDiskSpace?.().then((d: DiskInfo) => setDiskInfo(d)).catch(() => {});
    el.getVersion?.().then((v: string) => setAppVersion(v)).catch(() => {});
  }, []);

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-subtle, rgba(195,204,214,0.06))' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted, #8da0b3)' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text-primary, #f0f4f9)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );

  return (
    <div style={{ padding: 20, maxWidth: 480 }}>
      {/* FlexOS identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 52,
          height: 52,
          borderRadius: 8,
          background: 'linear-gradient(135deg, rgba(var(--rmpg-700-rgb, 30 60 95), 0.9), rgba(var(--rmpg-500-rgb, 62 116 168), 0.6))',
          border: '1px solid rgba(195,204,214,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Shield style={{ width: 28, height: 28, color: 'var(--accent-silver-300, #d4dde6)' }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary, #f0f4f9)', letterSpacing: '-0.01em' }}>
            FlexOS
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #8da0b3)', marginTop: 2 }}>
            Rocky Mountain Protective Group — Proprietary Operating System
          </div>
        </div>
      </div>

      {/* Version info */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-silver-400, #c3ccd6)', marginBottom: 8 }}>
          Version
        </div>
        <Row label="FlexOS" value={`v${FLEXOS_VERSION}`} />
        <Row label="RMPG Flex" value={`v${appVersion ?? RMPG_FLEX_VERSION}`} />
        <Row label="Build" value={import.meta.env.VITE_BUILD_SHA ?? 'dev'} />
      </div>

      {/* System info (only in desktop) */}
      {sysInfo && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-silver-400, #c3ccd6)', marginBottom: 8 }}>
            Hardware
          </div>
          <Row label="Hostname" value={sysInfo.hostname || '—'} />
          <Row label="Platform" value={`${sysInfo.platform} / ${sysInfo.arch}`} />
          <Row label="OS Version" value={sysInfo.os_version || '—'} />
          <Row label="CPU Cores" value={sysInfo.cpu_count} />
          <Row label="Memory" value={`${Math.round(sysInfo.free_memory_mb / 1024)} GB free / ${Math.round(sysInfo.total_memory_mb / 1024)} GB total`} />
          <Row label="Uptime" value={formatUptime(sysInfo.uptime_seconds)} />
          {diskInfo && diskInfo.free_gb != null && diskInfo.total_gb != null && (
            <Row label="Storage" value={`${diskInfo.free_gb.toFixed(1)} GB free / ${diskInfo.total_gb.toFixed(1)} GB — ${Math.round(diskInfo.used_percent ?? 0)}% used`} />
          )}
        </div>
      )}

      {/* Legal */}
      <div style={{ fontSize: 10, color: 'var(--text-muted, #8da0b3)', lineHeight: 1.6, borderTop: '1px solid var(--border-subtle, rgba(195,204,214,0.1))', paddingTop: 14 }}>
        © {new Date().getFullYear()} Rocky Mountain Protective Group, LLC. All rights reserved.{/* new-date-ok */}
        <br />
        FlexOS is a proprietary software platform licensed exclusively to Rocky Mountain Protective Group.
        Unauthorized reproduction, distribution, or use is strictly prohibited.
      </div>
    </div>
  );
}
