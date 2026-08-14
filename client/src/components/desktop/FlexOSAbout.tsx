/**
 * FlexOS — About screen
 *
 * Shown from the FlexOS Settings app (OS tab → About FlexOS) and from the
 * taskbar launcher (the agency shield icon long-press / right-click menu).
 * Displays version, build info, license, and hardware identity.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Copy, Check } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

const FLEXOS_VERSION = '1.0.0';
const RMPG_FLEX_VERSION = '5.8.7';

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
  freeBytes: number | null;
  totalBytes?: number | null;
  warn: boolean;
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

interface Officer {
  full_name?: string;
  name?: string;
  role?: string;
  badge_number?: string;
}

const SESSION_START_KEY = 'rmpg_session_start';
const D1_DB_ID = '785de7ae-3e7a-4e01-93bb-d24ddd813f6b';

export default function FlexOSAbout() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [officer, setOfficer] = useState<Officer | null>(null);
  const [copied, setCopied] = useState(false);
  const sessionStart = sessionStorage.getItem(SESSION_START_KEY) ?? localStorage.getItem(SESSION_START_KEY);

  useEffect(() => {
    const el = (window as any).electron;
    if (el?.isElectron) {
      el.getSystemInfo?.().then((info: SystemInfo) => setSysInfo(info)).catch(() => {});
      el.checkDiskSpace?.().then((d: DiskInfo) => setDiskInfo(d)).catch(() => {});
      el.getVersion?.().then((v: string) => setAppVersion(v)).catch(() => {});
    }
    apiFetch<Officer>('/auth/me').then(setOfficer).catch(() => {});
  }, []);

  const copyDiagnostics = useCallback(async () => {
    const blob = JSON.stringify({
      flexos_version: FLEXOS_VERSION,
      rmpg_flex_version: appVersion ?? RMPG_FLEX_VERSION,
      build_sha: import.meta.env.VITE_BUILD_SHA ?? 'dev',
      environment: import.meta.env.MODE,
      api_base: import.meta.env.VITE_API_BASE_URL ?? 'https://api.rmpgutah.us',
      d1_db_id_suffix: D1_DB_ID.slice(-8),
      officer_name: officer?.full_name ?? officer?.name ?? 'unknown',
      officer_role: officer?.role ?? 'unknown',
      session_start: sessionStart ?? 'unknown',
      timestamp: new Date().toISOString(),
      ...(sysInfo ? { hostname: sysInfo.hostname, platform: sysInfo.platform, arch: sysInfo.arch } : {}),
    }, null, 2);
    try {
      await navigator.clipboard.writeText(blob);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard denied */ }
  }, [appVersion, officer, sessionStart, sysInfo]);

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

      {/* Officer info */}
      {officer && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--field-label-color, #d9bd72)', marginBottom: 8 }}>
            Session
          </div>
          <Row label="Officer" value={officer.full_name ?? officer.name ?? '—'} />
          <Row label="Role" value={officer.role ?? '—'} />
          {officer.badge_number && <Row label="Badge" value={officer.badge_number} />}
          {sessionStart && <Row label="Session Start" value={new Date(sessionStart).toLocaleString()} />}{/* new-date-ok: stored by client at login, not a D1 server string */}
        </div>
      )}

      {/* Version info */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--field-label-color, #d9bd72)', marginBottom: 8 }}>
          Version
        </div>
        <Row label="FlexOS" value={`v${FLEXOS_VERSION}`} />
        <Row label="RMPG Flex" value={`v${appVersion ?? RMPG_FLEX_VERSION}`} />
        <Row label="Build" value={import.meta.env.VITE_BUILD_SHA ?? 'dev'} />
        <Row label="Environment" value={import.meta.env.MODE} />
        <Row label="API" value={import.meta.env.VITE_API_BASE_URL ?? 'https://api.rmpgutah.us'} />
        <Row label="Database" value={`…${D1_DB_ID.slice(-8)}`} />
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
          {diskInfo && diskInfo.freeBytes != null && (
            <Row label="Storage" value={`${(diskInfo.freeBytes / (1024 ** 3)).toFixed(1)} GB free${diskInfo.warn ? ' ⚠ Low' : ''}`} />
          )}
        </div>
      )}

      {/* Copy diagnostics */}
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={copyDiagnostics}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', fontSize: 11, fontWeight: 600,
            background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
            borderRadius: 2, cursor: 'pointer', color: 'var(--text-primary)',
          }}
        >
          {copied ? <Check size={12} style={{ color: 'var(--sev-ok, #22c55e)' }} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy diagnostic info'}
        </button>
      </div>

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
