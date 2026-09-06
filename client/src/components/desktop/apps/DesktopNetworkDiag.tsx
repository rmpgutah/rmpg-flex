import React, { useState, useCallback } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { pingResultsToCsv, networkIfacesToCsv, downloadTextFile } from '../../../utils/rmsListExport';
import { copyToClipboard } from '../../../utils/contextMenuActions';

interface DesktopNetworkDiagProps {
  onClose: () => void;
}

const W = 600;
const H = 500;

type TabId = 'ping' | 'speed' | 'interfaces' | 'dns';

interface PingResult {
  attempt: number;
  latencyMs: number;
  ok: boolean;
}

interface NetworkInterface {
  name: string;
  ipv4?: string;
  ipv6?: string;
  mac?: string;
  status?: string;
}

function latencyColor(ms: number): string {
  if (ms < 50) return 'var(--sev-ok)';
  if (ms < 200) return 'var(--sev-warn)';
  return 'var(--sev-critical)';
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 8, height: 8,
      borderRadius: '50%',
      background: ok ? 'var(--sev-ok)' : 'var(--sev-critical)',
      marginRight: 6,
      flexShrink: 0,
    }} />
  );
}

export default function DesktopNetworkDiag({ onClose }: DesktopNetworkDiagProps) {
  const [pos, setPos] = useState({
    x: Math.max(0, (window.innerWidth - W) / 2),
    y: Math.max(0, (window.innerHeight - H) / 4),
  });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [tab, setTab] = useState<TabId>('ping');

  // --- Ping tab ---
  const [pingTarget, setPingTarget] = useState('api.rmpgutah.us');
  const [pingResults, setPingResults] = useState<PingResult[]>([]);
  const [pingRunning, setPingRunning] = useState(false);

  const runPing = useCallback(async () => {
    setPingRunning(true);
    setPingResults([]);
    const results: PingResult[] = [];
    for (let i = 1; i <= 10; i++) {
      const start = performance.now();
      let ok = false;
      try {
        const r = await fetch(`https://${pingTarget}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        ok = r.ok;
      } catch {
        ok = false;
      }
      const ms = performance.now() - start;
      const result: PingResult = { attempt: i, latencyMs: ms, ok };
      results.push(result);
      setPingResults(prev => [...prev, result]);
    }
    setPingRunning(false);
    return results;
  }, [pingTarget]);

  const pingAvg = pingResults.length > 0 ? pingResults.reduce((s, r) => s + r.latencyMs, 0) / pingResults.length : 0;
  const pingMin = pingResults.length > 0 ? Math.min(...pingResults.map(r => r.latencyMs)) : 0;
  const pingMax = pingResults.length > 0 ? Math.max(...pingResults.map(r => r.latencyMs)) : 0;

  // --- Speed test tab ---
  const [speedRunning, setSpeedRunning] = useState(false);
  const [speedKbps, setSpeedKbps] = useState<number | null>(null);
  const [speedElapsed, setSpeedElapsed] = useState<number | null>(null);

  const runSpeedTest = useCallback(async () => {
    setSpeedRunning(true);
    setSpeedKbps(null);
    setSpeedElapsed(null);
    const count = 20;
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      try {
        await fetch('/api/health', { cache: 'no-store' });
      } catch {
        // ignore
      }
    }
    const elapsed = performance.now() - start;
    // Rough estimate: /api/health is ~200 bytes per response
    const totalBytes = count * 200;
    const kbps = (totalBytes / (elapsed / 1000)) / 1024;
    setSpeedKbps(kbps);
    setSpeedElapsed(elapsed);
    setSpeedRunning(false);
  }, []);

  // --- Interfaces tab ---
  const [interfaces, setInterfaces] = useState<NetworkInterface[] | null>(null);
  const [ifaceLoading, setIfaceLoading] = useState(false);

  const refreshInterfaces = useCallback(async () => {
    const el = (window as any).electron;
    if (!el?.getNetworkInterfaces) {
      setInterfaces([]);
      return;
    }
    setIfaceLoading(true);
    try {
      const result = await el.getNetworkInterfaces();
      setInterfaces(result ?? []);
    } catch {
      setInterfaces([]);
    }
    setIfaceLoading(false);
  }, []);

  // --- DNS/Connectivity tab ---
  const [connApi, setConnApi] = useState<boolean | null>(null);
  const [connInternet, setConnInternet] = useState<boolean | null>(null);
  const [connChecking, setConnChecking] = useState(false);

  const checkConnectivity = useCallback(async () => {
    setConnChecking(true);
    setConnApi(null);
    setConnInternet(null);
    try {
      const r = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      setConnApi(r.ok);
    } catch {
      setConnApi(false);
    }
    try {
      await fetch('https://cloudflare.com/cdn-cgi/trace', { mode: 'no-cors', signal: AbortSignal.timeout(5000) });
      setConnInternet(true);
    } catch {
      setConnInternet(false);
    }
    setConnChecking(false);
  }, []);

  const thStyle: React.CSSProperties = { padding: '3px 6px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 9, borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-overlay)' };
  const tdStyle: React.CSSProperties = { padding: '2px 6px', color: 'var(--text-primary)', fontSize: 10, borderBottom: '1px solid var(--border-subtle)' };

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: W,
        height: H,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        boxShadow: '0 8px 32px rgba(0 0 0 / 0.45)',
        zIndex: 20200,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Title bar */}
      <div
        onPointerDown={onPointerDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          height: 30,
          background: 'var(--surface-overlay)',
          borderBottom: '1px solid var(--border-subtle)',
          cursor: 'move',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-header-color)' }}>Network Diagnostics</span>
        <button type="button" aria-label="Close Network Diagnostics" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
          <X size={12} style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {(['ping', 'speed', 'interfaces', 'dns'] as TabId[]).map(t => {
          const labels: Record<TabId, string> = { ping: 'Ping', speed: 'Speed Test', interfaces: 'Interfaces', dns: 'Connectivity' };
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                padding: '5px 14px',
                fontSize: 11,
                background: tab === t ? 'var(--surface-raised)' : 'transparent',
                borderRight: '1px solid var(--border-subtle)',
                borderBottom: tab === t ? '2px solid var(--accent-silver-400)' : '2px solid transparent',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

        {/* Ping tab */}
        {tab === 'ping' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Target:</span>
              <input
                value={pingTarget}
                onChange={e => setPingTarget(e.target.value)}
                style={{ flex: 1, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: '3px 8px', fontSize: 11, color: 'var(--text-primary)', outline: 'none' }}
              />
              <button
                type="button"
                onClick={() => { void runPing(); }}
                disabled={pingRunning}
                style={{ padding: '3px 12px', fontSize: 11, background: pingRunning ? 'var(--surface-sunken)' : 'var(--accent-silver-400)', color: pingRunning ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 2, cursor: pingRunning ? 'not-allowed' : 'pointer' }}
              >
                {pingRunning ? 'Pinging…' : 'Ping'}
              </button>
              <button
                type="button"
                disabled={pingResults.length === 0}
                onClick={() => downloadTextFile('ping-results.csv', pingResultsToCsv(pingResults))}
                style={{ padding: '3px 10px', fontSize: 11, background: 'none', color: 'var(--text-primary)', border: '1px solid var(--border-default)', borderRadius: 2, cursor: 'pointer' }}
              >CSV</button>
            </div>

            {pingResults.length > 0 && (
              <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Avg: <strong style={{ color: latencyColor(pingAvg) }}>{pingAvg.toFixed(0)} ms</strong></span>
                <span style={{ color: 'var(--text-secondary)' }}>Min: <strong style={{ color: 'var(--sev-ok)' }}>{pingMin.toFixed(0)} ms</strong></span>
                <span style={{ color: 'var(--text-secondary)' }}>Max: <strong style={{ color: latencyColor(pingMax) }}>{pingMax.toFixed(0)} ms</strong></span>
              </div>
            )}

            <div style={{ overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 2 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>Latency</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pingResults.map(r => (
                    <tr key={r.attempt}>
                      <td style={tdStyle}>{r.attempt}</td>
                      <td style={{ ...tdStyle, color: latencyColor(r.latencyMs), fontVariantNumeric: 'tabular-nums' }}>{r.latencyMs.toFixed(0)} ms</td>
                      <td style={tdStyle}>
                        <span style={{ color: r.ok ? 'var(--sev-ok)' : 'var(--sev-critical)', fontSize: 10 }}>
                          {r.ok ? 'OK' : 'FAIL'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {pingResults.length === 0 && !pingRunning && (
                    <tr><td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>Press Ping to begin.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Speed test tab */}
        {tab === 'speed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              type="button"
              onClick={() => { void runSpeedTest(); }}
              disabled={speedRunning}
              style={{ alignSelf: 'flex-start', padding: '5px 16px', fontSize: 12, background: speedRunning ? 'var(--surface-sunken)' : 'var(--accent-silver-400)', color: speedRunning ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 2, cursor: speedRunning ? 'not-allowed' : 'pointer' }}
            >
              {speedRunning ? 'Running…' : 'Run Speed Test'}
            </button>

            {speedKbps !== null && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {speedKbps.toFixed(1)} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>KB/s estimated</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  20 requests completed in {speedElapsed?.toFixed(0)} ms
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  Estimate based on /api/health response size. For true throughput, use a dedicated speed test tool.
                </div>
              </div>
            )}

            {speedKbps === null && !speedRunning && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Press Run Speed Test to measure API round-trip throughput.</p>
            )}
          </div>
        )}

        {/* Interfaces tab */}
        {tab === 'interfaces' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={refreshInterfaces}
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px', fontSize: 11, background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: 2, color: 'var(--text-primary)', cursor: 'pointer' }}
            >
              <RefreshCw size={10} /> Refresh
            </button>
            {interfaces && interfaces.length > 0 && (
              <button
                type="button"
                onClick={() => downloadTextFile('network-ifaces.csv', networkIfacesToCsv(interfaces))}
                style={{ alignSelf: 'flex-start', fontSize: 11, padding: '4px 12px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
              >CSV</button>
            )}

            {!(window as any).electron?.getNetworkInterfaces && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>
                Network interface details require the desktop app.
              </div>
            )}

            {interfaces !== null && (
              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 2, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Interface</th>
                      <th style={thStyle}>IPv4</th>
                      <th style={thStyle}>IPv6</th>
                      <th style={thStyle}>MAC</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ifaceLoading && (
                      <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
                    )}
                    {!ifaceLoading && interfaces.length === 0 && (
                      <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>No interfaces found.</td></tr>
                    )}
                    {interfaces.map((iface, i) => (
                      <tr key={i}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{iface.name}</td>
                        <td style={tdStyle}>
                          {iface.ipv4 ?? '—'}
                          {iface.ipv4 && (
                            <button type="button" onClick={() => void copyToClipboard(iface.ipv4!)} style={{ marginLeft: 6, fontSize: 9, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Copy</button>
                          )}
                        </td>
                        <td style={tdStyle}>{iface.ipv6 ?? '—'}</td>
                        <td style={{ ...tdStyle, fontFamily: 'Arial, sans-serif', fontSize: 9 }}>{iface.mac ?? '—'}</td>
                        <td style={{ ...tdStyle, color: iface.status === 'up' ? 'var(--sev-ok)' : 'var(--text-muted)' }}>{iface.status ?? 'unknown'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* DNS / Connectivity tab */}
        {tab === 'dns' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              type="button"
              onClick={() => { void checkConnectivity(); }}
              disabled={connChecking}
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px', fontSize: 11, background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: 2, color: 'var(--text-primary)', cursor: connChecking ? 'not-allowed' : 'pointer' }}
            >
              <RefreshCw size={10} /> {connChecking ? 'Checking…' : 'Refresh'}
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--text-primary)', padding: '6px 10px', background: 'var(--surface-sunken)', borderRadius: 2, border: '1px solid var(--border-subtle)' }}>
                <StatusDot ok={connApi === true} />
                RMPG API (api.rmpgutah.us)
                {connApi === null && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>Not checked</span>}
                {connApi !== null && <span style={{ marginLeft: 'auto', fontSize: 10, color: connApi ? 'var(--sev-ok)' : 'var(--sev-critical)' }}>{connApi ? 'Reachable' : 'Unreachable'}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--text-primary)', padding: '6px 10px', background: 'var(--surface-sunken)', borderRadius: 2, border: '1px solid var(--border-subtle)' }}>
                <StatusDot ok={connInternet === true} />
                Internet (Cloudflare)
                {connInternet === null && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>Not checked</span>}
                {connInternet !== null && <span style={{ marginLeft: 'auto', fontSize: 10, color: connInternet ? 'var(--sev-ok)' : 'var(--sev-critical)' }}>{connInternet ? 'Connected' : 'No Internet'}</span>}
              </div>
            </div>

            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Cloudflare check uses no-cors mode and does not send credentials.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
