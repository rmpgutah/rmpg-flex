import React, { useState, useEffect, useCallback } from 'react';
import { Cpu, HardDrive, Wifi, Battery, Activity, RefreshCw, CheckCircle, AlertTriangle, XCircle, Monitor, Server } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { networkIfacesToCsv, downloadTextFile } from '../utils/rmsListExport';
import { copyToClipboard } from '../utils/clipboard';

interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  cpu_count: number;
  cpu_model: string;
  uptime_seconds: number;
  total_memory_mb: number;
  free_memory_mb: number;
  disk_free_gb: number;
}

interface NetworkInterface {
  name: string;
  address: string;
  type: string;
}

interface BatteryInfo {
  percent: number;
  charging: boolean;
  timeRemaining?: number;
}

interface HealthState {
  sysInfo: SystemInfo | null;
  cpuUsage: number | null;
  diskFreeGb: number | null;
  networks: NetworkInterface[];
  battery: BatteryInfo | null;
  appVersion: string | null;
  apiLatencyMs: number | null;
  apiOnline: boolean;
  loading: boolean;
  lastRefresh: Date | null;
}

function ProgressBar({ percent, warn = 60, danger = 80 }: { percent: number; warn?: number; danger?: number }) {
  const color =
    percent >= danger
      ? 'var(--sev-critical)'
      : percent >= warn
      ? 'var(--sev-warn)'
      : 'var(--sev-ok)';
  return (
    <div
      style={{
        width: '100%',
        height: 6,
        background: 'var(--surface-base)',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, percent))}%`,
          height: '100%',
          background: color,
          transition: 'width 0.4s ease',
        }}
      />
    </div>
  );
}

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        paddingBottom: 6,
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: 10,
      }}
    >
      <Icon size={13} color="var(--field-label-color)" />
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--panel-header-color, var(--field-label-color))',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function MetricRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
      <span
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--field-label-color)',
          paddingTop: 1,
        }}
      >
        {label}
      </span>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 11, color: 'var(--text-primary)' }}>{value}</span>
        {sub && (
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 1 }}>{sub}</div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: ok ? 'var(--sev-ok)' : 'var(--sev-critical)',
        marginRight: 5,
        verticalAlign: 'middle',
      }}
    />
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function mbToGb(mb: number): number {
  return Math.round((mb / 1024) * 10) / 10;
}

const isElectron = typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).electron;

export default function DeviceHealthPage() {
  const [state, setState] = useState<HealthState>({
    sysInfo: null,
    cpuUsage: null,
    diskFreeGb: null,
    networks: [],
    battery: null,
    appVersion: null,
    apiLatencyMs: null,
    apiOnline: navigator.onLine,
    loading: false,
    lastRefresh: null,
  });

  const fetchAll = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));

    const el = (window as unknown as Record<string, unknown>).electron as Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;

    let sysInfo: SystemInfo | null = null;
    let cpuUsage: number | null = null;
    let diskFreeGb: number | null = null;
    let networks: NetworkInterface[] = [];
    let battery: BatteryInfo | null = null;
    let appVersion: string | null = null;

    if (el) {
      try { sysInfo = (await el.getSystemInfo?.()) as SystemInfo | null ?? null; } catch {}
      try { cpuUsage = (await el.getCpuUsage?.()) as number | null ?? null; } catch {}
      try {
        // checkDiskSpace returns { freeBytes, totalBytes, warn } — not a number.
        // Casting it as `number | null` was silently wrong: the object is truthy,
        // so ?? never fired, and diskFreeGb held an object whose .toFixed(1)
        // call at render time threw TypeError.
        const ds = await el.checkDiskSpace?.() as { freeBytes?: number | null; totalBytes?: number | null } | null | undefined;
        diskFreeGb = ds?.freeBytes != null
          ? Math.round((ds.freeBytes / (1024 ** 3)) * 10) / 10
          : sysInfo?.disk_free_gb ?? null;
      } catch {
        diskFreeGb = sysInfo?.disk_free_gb ?? null;
      }
      try { networks = ((await el.getNetworkInterfaces?.()) as NetworkInterface[] | null) ?? []; } catch {}
      try { battery = (await el.getBatteryStatus?.()) as BatteryInfo | null ?? null; } catch {}
      try { appVersion = (await el.getVersion?.()) as string | null ?? null; } catch {}
    }

    let apiLatencyMs: number | null = null;
    let apiOnline = navigator.onLine;
    try {
      const t0 = performance.now();
      await apiFetch('/api/health');
      apiLatencyMs = Math.round(performance.now() - t0);
      apiOnline = true;
    } catch {
      apiOnline = false;
    }

    setState({
      sysInfo,
      cpuUsage,
      diskFreeGb,
      networks,
      battery,
      appVersion,
      apiLatencyMs,
      apiOnline,
      loading: false,
      lastRefresh: new Date(),
    });
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Poll CPU every 5s
  useEffect(() => {
    if (!isElectron) return;
    const id = setInterval(async () => {
      try {
        const el = (window as unknown as Record<string, unknown>).electron as Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
        const usage = await el?.getCpuUsage?.();
        if (usage != null) setState(s => ({ ...s, cpuUsage: usage as number }));
      } catch {}
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Poll API health every 30s
  useEffect(() => {
    const id = setInterval(async () => {
      let apiLatencyMs: number | null = null;
      let apiOnline = navigator.onLine;
      try {
        const t0 = performance.now();
        await apiFetch('/api/health');
        apiLatencyMs = Math.round(performance.now() - t0);
        apiOnline = true;
      } catch {
        apiOnline = false;
      }
      setState(s => ({ ...s, apiLatencyMs, apiOnline }));
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const { sysInfo, cpuUsage, diskFreeGb, networks, battery, appVersion, apiLatencyMs, apiOnline, loading, lastRefresh } = state;

  const totalMemGb = sysInfo ? mbToGb(sysInfo.total_memory_mb) : null;
  const freeMemGb = sysInfo ? mbToGb(sysInfo.free_memory_mb) : null;
  const usedMemGb = totalMemGb != null && freeMemGb != null ? Math.round((totalMemGb - freeMemGb) * 10) / 10 : null;
  const memPct = totalMemGb && usedMemGb != null ? Math.round((usedMemGb / totalMemGb) * 100) : 0;

  // FZ-55 standard SSD is 512 GB; we know disk_free, estimate used pct from that
  const estimatedTotalDisk = 512;
  const diskUsedPct = diskFreeGb != null ? Math.round(((estimatedTotalDisk - diskFreeGb) / estimatedTotalDisk) * 100) : null;

  const latencyColor =
    apiLatencyMs == null
      ? 'var(--sev-critical)'
      : apiLatencyMs < 300
      ? 'var(--sev-ok)'
      : apiLatencyMs < 800
      ? 'var(--sev-warn)'
      : 'var(--sev-critical)';

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: 'var(--surface-base)',
        color: 'var(--text-primary)',
        padding: 16,
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--panel-header-color, var(--field-label-color))' }}>
            DEVICE HEALTH
          </div>
          {lastRefresh && (
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>
              Last refreshed {lastRefresh.toLocaleTimeString('en-US', { timeZone: 'America/Denver' })}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={fetchAll}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 2,
            color: 'var(--text-primary)',
            fontSize: 10,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? 'Scanning…' : 'Run Diagnostics'}
        </button>
        <button
          type="button"
          disabled={networks.length === 0}
          onClick={() => downloadTextFile('device-ifaces.csv', networkIfacesToCsv(networks.map((n) => ({ name: n.name, ipv4: n.address, status: n.type }))))}
          style={{
            marginLeft: 8,
            padding: '5px 10px',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 2,
            color: 'var(--text-primary)',
            fontSize: 10,
            cursor: networks.length ? 'pointer' : 'not-allowed',
          }}
        >CSV</button>
        {sysInfo?.hostname && (
          <button
            type="button"
            onClick={() => void copyToClipboard(sysInfo.hostname)}
            style={{
              marginLeft: 8,
              padding: '5px 10px',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 2,
              color: 'var(--text-primary)',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >Copy host</button>
        )}
      </div>

      {!apiOnline && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: '8px 10px',
            background: 'rgba(var(--sev-critical-rgb) / 0.12)',
            border: '1px solid rgba(var(--sev-critical-rgb) / 0.4)',
            borderRadius: 2,
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>API health check failed — the CAD API looks unreachable from this device.</span>
          <button
            type="button"
            onClick={fetchAll}
            disabled={loading}
            className="toolbar-btn"
          >
            Retry
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* Left column — hardware */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {!isElectron ? (
            <div
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 2,
                padding: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: 'var(--text-secondary)',
                fontSize: 10,
              }}
            >
              <Monitor size={16} color="var(--field-label-color)" />
              Hardware diagnostics available in the FlexOS desktop app only.
            </div>
          ) : (
            <>
              {/* System */}
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
                <SectionHeader icon={Server} label="System" />
                <MetricRow label="Hostname" value={sysInfo?.hostname ?? '—'} />
                <MetricRow label="Platform" value={sysInfo ? `${sysInfo.platform} / ${sysInfo.arch}` : '—'} />
                <MetricRow label="Uptime" value={sysInfo ? formatUptime(sysInfo.uptime_seconds) : '—'} />
              </div>

              {/* CPU */}
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
                <SectionHeader icon={Cpu} label="CPU" />
                <MetricRow label="Model" value={sysInfo?.cpu_model ?? '—'} />
                <MetricRow label="Cores" value={sysInfo?.cpu_count ?? '—'} />
                <MetricRow
                  label="Usage"
                  value={
                    cpuUsage != null ? (
                      <span style={{ color: cpuUsage >= 80 ? 'var(--sev-critical)' : cpuUsage >= 60 ? 'var(--sev-warn)' : 'var(--sev-ok)' }}>
                        {cpuUsage.toFixed(1)}%
                      </span>
                    ) : '—'
                  }
                />
                {cpuUsage != null && (
                  <div style={{ marginTop: 4 }}>
                    <ProgressBar percent={cpuUsage} warn={60} danger={80} />
                  </div>
                )}
              </div>

              {/* Memory */}
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
                <SectionHeader icon={Activity} label="Memory" />
                <MetricRow label="Total" value={totalMemGb != null ? `${totalMemGb} GB` : '—'} />
                <MetricRow label="Used" value={usedMemGb != null ? `${usedMemGb} GB` : '—'} />
                <MetricRow label="Free" value={freeMemGb != null ? `${freeMemGb} GB` : '—'} />
                {totalMemGb != null && (
                  <div style={{ marginTop: 4 }}>
                    <ProgressBar percent={memPct} warn={65} danger={85} />
                    <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 3 }}>{memPct}% utilized</div>
                  </div>
                )}
              </div>

              {/* Disk */}
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
                <SectionHeader icon={HardDrive} label="Disk" />
                <MetricRow label="Free" value={diskFreeGb != null ? `${diskFreeGb.toFixed(1)} GB` : '—'} />
                {diskUsedPct != null && (
                  <>
                    <MetricRow label="Est. used" value={`${diskUsedPct}%`} />
                    <div style={{ marginTop: 4 }}>
                      <ProgressBar percent={diskUsedPct} warn={70} danger={85} />
                    </div>
                  </>
                )}
              </div>

              {/* Battery */}
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
                <SectionHeader icon={Battery} label="Battery" />
                {battery ? (
                  <>
                    <MetricRow
                      label="Charge"
                      value={
                        <span style={{ color: battery.percent < 20 ? 'var(--sev-critical)' : battery.percent < 40 ? 'var(--sev-warn)' : 'var(--sev-ok)' }}>
                          {battery.percent}%
                        </span>
                      }
                    />
                    <MetricRow label="Status" value={battery.charging ? 'Charging' : 'On Battery'} />
                    {battery.timeRemaining != null && (
                      <MetricRow
                        label="Est. remaining"
                        value={`${Math.floor(battery.timeRemaining / 60)}h ${battery.timeRemaining % 60}m`}
                      />
                    )}
                    <div style={{ marginTop: 4 }}>
                      <ProgressBar percent={battery.percent} warn={40} danger={20} />
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Not available</div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right column — software + connectivity + network */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Software */}
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
            <SectionHeader icon={Monitor} label="Software" />
            <MetricRow label="RMPG Flex" value="5.9.0" />
            <MetricRow label="FlexOS" value="1.0.0" />
            {appVersion && <MetricRow label="Electron" value={appVersion} />}
            <MetricRow
              label="Browser Online"
              value={
                <>
                  <StatusDot ok={navigator.onLine} />
                  {navigator.onLine ? 'Yes' : 'No'}
                </>
              }
            />
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--field-label-color)', marginBottom: 3 }}>
                User Agent
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--text-secondary)',
                  wordBreak: 'break-all',
                  lineHeight: 1.5,
                  background: 'var(--surface-base)',
                  padding: '4px 6px',
                  borderRadius: 2,
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {navigator.userAgent}
              </div>
            </div>
          </div>

          {/* Connectivity */}
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
            <SectionHeader icon={Wifi} label="Connectivity" />
            <MetricRow
              label="API Status"
              value={
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {apiOnline
                    ? <CheckCircle size={11} color="var(--sev-ok)" />
                    : <XCircle size={11} color="var(--sev-critical)" />}
                  {apiOnline ? 'Online' : 'Unreachable'}
                </span>
              }
            />
            <MetricRow
              label="API Latency"
              value={
                apiLatencyMs != null ? (
                  <span style={{ color: latencyColor }}>{apiLatencyMs} ms</span>
                ) : '—'
              }
            />
            <MetricRow
              label="Browser Network"
              value={
                <>
                  <StatusDot ok={navigator.onLine} />
                  {navigator.onLine ? 'Connected' : 'Offline'}
                </>
              }
            />
          </div>

          {/* Network Interfaces — Electron only */}
          {isElectron && (
            <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
              <SectionHeader icon={Wifi} label="Network Interfaces" />
              {networks.length === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>No interfaces detected</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead>
                    <tr>
                      {['Interface', 'Address', 'Type'].map(h => (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            fontSize: 9,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                            color: 'var(--field-label-color)',
                            paddingBottom: 4,
                            fontWeight: 600,
                            borderBottom: '1px solid var(--border-subtle)',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {networks.map((n, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '3px 4px 3px 0', color: 'var(--text-primary)', fontSize: 10 }}>{n.name}</td>
                        <td style={{ padding: '3px 4px', color: 'var(--text-secondary)', fontSize: 10, fontFamily: 'monospace' }}>{n.address}</td>
                        <td style={{ padding: '3px 0 3px 4px', color: 'var(--text-secondary)', fontSize: 10 }}>{n.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Status Summary */}
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
            <SectionHeader icon={Activity} label="Status Summary" />
            {[
              {
                label: 'API Connectivity',
                ok: apiOnline,
                warn: false,
                value: apiOnline ? 'Online' : 'Offline',
              },
              {
                label: 'Memory',
                ok: memPct < 85,
                warn: memPct >= 65 && memPct < 85,
                value: totalMemGb ? `${memPct}%` : 'N/A',
              },
              {
                label: 'CPU Load',
                ok: cpuUsage == null || cpuUsage < 80,
                warn: cpuUsage != null && cpuUsage >= 60 && cpuUsage < 80,
                value: cpuUsage != null ? `${cpuUsage.toFixed(0)}%` : 'N/A',
              },
              {
                label: 'Battery',
                ok: !battery || battery.charging || battery.percent >= 40,
                warn: battery != null && !battery.charging && battery.percent >= 20 && battery.percent < 40,
                value: battery ? `${battery.percent}%` : 'N/A',
              },
            ].map(({ label, ok, warn, value }) => (
              <div
                key={label}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}
              >
                <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--field-label-color)' }}>
                  {label}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                  {ok && !warn && <CheckCircle size={10} color="var(--sev-ok)" />}
                  {warn && <AlertTriangle size={10} color="var(--sev-warn)" />}
                  {!ok && !warn && <XCircle size={10} color="var(--sev-critical)" />}
                  <span style={{ color: ok && !warn ? 'var(--sev-ok)' : warn ? 'var(--sev-warn)' : 'var(--sev-critical)' }}>
                    {value}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
