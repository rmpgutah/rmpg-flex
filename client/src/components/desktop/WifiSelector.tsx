import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, Lock, Unlock, ChevronRight, X } from 'lucide-react';

// ── Types returned by the IPC handlers ──────────────────────────────────────

interface WifiDetail {
  state: 'connected' | 'disconnected' | null;
  ssid: string | null;
  bssid: string | null;
  signal: number | null;
  channel: number | null;
  band: string | null;
  radioType: string | null;
  auth: string | null;
  cipher: string | null;
  profile: string | null;
  adapter: string | null;
  mac: string | null;
  ip: string | null;
  ipv6: string | null;
  subnet: string | null;
  gateway: string | null;
  dns: string[];
  rxMbps: number | null;
  txMbps: number | null;
}

interface ScannedNetwork {
  ssid: string;
  auth: string;
  enc: string;
  signal: number;
  channel: number | null;
  band: string | null;
  radioType: string | null;
  bssids: Array<{ bssid: string | null; signal: number; channel: number | null; radioType: string | null }>;
}

// ── Signal strength bars ─────────────────────────────────────────────────────

function SignalBars({ signal, size = 14 }: { signal: number; size?: number }) {
  const bars = signal > 75 ? 4 : signal > 50 ? 3 : signal > 25 ? 2 : 1;
  const color = signal > 75 ? 'var(--sev-ok)' : signal > 40 ? 'var(--sev-warn)' : 'var(--sev-critical)';
  const gap = Math.round(size * 0.15);
  const barW = Math.round(size * 0.18);
  const heights = [0.4, 0.6, 0.78, 1.0].map(h => Math.round(h * size));
  const totalW = 4 * barW + 3 * gap;

  return (
    <svg width={totalW} height={size} viewBox={`0 0 ${totalW} ${size}`} aria-hidden="true">
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * (barW + gap)}
          y={size - h}
          width={barW}
          height={h}
          rx={1}
          fill={i < bars ? color : 'var(--border-subtle)'}
        />
      ))}
    </svg>
  );
}

// ── Detail row ───────────────────────────────────────────────────────────────

function DetailRow({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 9, color: 'var(--field-label-color)', flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontSize: 9,
          color: 'var(--text-primary)',
          textAlign: 'right',
          wordBreak: 'break-all',
          fontFamily: mono ? 'monospace' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Lock icon helper ─────────────────────────────────────────────────────────

function SecurityIcon({ auth }: { auth: string }) {
  const open = /open|none/i.test(auth);
  return open
    ? <Unlock className="w-2.5 h-2.5" style={{ color: 'var(--sev-warn)', flexShrink: 0 }} />
    : <Lock   className="w-2.5 h-2.5" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />;
}

// ── Main panel ───────────────────────────────────────────────────────────────

interface WifiSelectorProps {
  onClose: () => void;
}

export default function WifiSelector({ onClose }: WifiSelectorProps) {
  const el = (window as any).electron as Record<string, (...a: any[]) => Promise<any>> | undefined;

  const [detail, setDetail]         = useState<WifiDetail | null>(null);
  const [networks, setNetworks]     = useState<ScannedNetwork[]>([]);
  const [profiles, setProfiles]     = useState<string[]>([]);
  const [scanning, setScanning]     = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [statusMsg, setStatusMsg]   = useState<string | null>(null);

  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const loadDetail = useCallback(async () => {
    if (!el?.wifiGetDetail) return;
    try { setDetail(await el.wifiGetDetail()); } catch { /* silent */ }
  }, [el]);

  const scan = useCallback(async () => {
    if (!el?.wifiScanNetworks) return;
    setScanning(true);
    setStatusMsg(null);
    try {
      const [nets, profs] = await Promise.all([
        el.wifiScanNetworks(),
        el.wifiListProfiles?.() ?? Promise.resolve([]),
      ]);
      // Sort by signal descending
      const sorted = (nets as ScannedNetwork[]).sort((a, b) => b.signal - a.signal);
      setNetworks(sorted);
      setProfiles(profs as string[]);
    } catch (err: any) {
      setStatusMsg('Scan failed: ' + (err?.message ?? 'unknown error'));
    } finally {
      setScanning(false);
    }
  }, [el]);

  // Load detail + trigger initial scan on mount
  useEffect(() => {
    loadDetail();
    scan();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = useCallback(async (profileName: string) => {
    if (!el?.wifiConnect || connecting) return;
    setConnecting(profileName);
    setStatusMsg(null);
    try {
      const res = await el.wifiConnect(profileName) as { ok: boolean; reason?: string };
      if (res.ok) {
        setStatusMsg(`Connecting to "${profileName}"…`);
        // Refresh detail after a brief delay to let the OS associate
        setTimeout(() => { loadDetail(); setStatusMsg(null); }, 3000);
      } else {
        setStatusMsg(`Failed: ${res.reason ?? 'unknown'}`);
      }
    } catch (err: any) {
      setStatusMsg('Error: ' + (err?.message ?? 'unknown'));
    } finally {
      setConnecting(null);
    }
  }, [el, connecting, loadDetail]);

  const handleDisconnect = useCallback(async () => {
    if (!el?.wifiDisconnect || connecting) return;
    setConnecting('__disconnect__');
    setStatusMsg(null);
    try {
      await el.wifiDisconnect();
      setStatusMsg('Disconnected.');
      setTimeout(() => { loadDetail(); setStatusMsg(null); }, 1500);
    } catch (err: any) {
      setStatusMsg('Error: ' + (err?.message ?? 'unknown'));
    } finally {
      setConnecting(null);
    }
  }, [el, connecting, loadDetail]);

  const profileSet = new Set(profiles.map(p => p.toLowerCase()));

  return (
    <div
      ref={ref}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        bottom: '100%',
        right: 0,
        marginBottom: 6,
        width: 300,
        maxHeight: 480,
        overflowY: 'auto',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        boxShadow: '0 8px 24px rgba(0 0 0 / 0.55)',
        zIndex: 99990,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {detail?.state === 'connected'
          ? <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--sev-ok)' }} />
          : <WifiOff className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
        }
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--field-label-color)', flexGrow: 1 }}>
          WI-FI
        </span>
        <button
          type="button"
          onClick={scan}
          disabled={scanning}
          aria-label="Rescan networks"
          style={{ background: 'none', border: 'none', cursor: scanning ? 'default' : 'pointer', padding: 2, display: 'flex' }}
        >
          <RefreshCw
            className="w-3 h-3"
            style={{ color: 'var(--text-secondary)', animation: scanning ? 'spin 1s linear infinite' : undefined }}
          />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close WiFi selector"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
        >
          <X className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* Current connection detail */}
      {detail && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 6 }}>
            {detail.state === 'connected' ? 'CONNECTED NETWORK' : 'NO CONNECTION'}
          </div>

          {detail.state === 'connected' && detail.ssid && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {detail.ssid}
                </span>
                {detail.signal != null && <SignalBars signal={detail.signal} />}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <DetailRow label="IP Address"  value={detail.ip}        mono />
                <DetailRow label="IPv6"        value={detail.ipv6}      mono />
                <DetailRow label="Gateway"     value={detail.gateway}   mono />
                {detail.dns?.length > 0 && (
                  <DetailRow label="DNS"       value={detail.dns.join(', ')} mono />
                )}
                <DetailRow label="Subnet"      value={detail.subnet}    mono />
                <DetailRow label="MAC"         value={detail.mac}       mono />
                <DetailRow label="BSSID"       value={detail.bssid}     mono />
                <DetailRow label="Channel"     value={detail.channel != null ? String(detail.channel) : null} />
                <DetailRow label="Band"        value={detail.band} />
                <DetailRow label="Radio"       value={detail.radioType} />
                <DetailRow label="Security"    value={detail.auth} />
                <DetailRow label="Cipher"      value={detail.cipher} />
                {(detail.rxMbps != null || detail.txMbps != null) && (
                  <DetailRow label="Speed"     value={[detail.rxMbps && `↓${detail.rxMbps}`, detail.txMbps && `↑${detail.txMbps}`].filter(Boolean).join('  ') + ' Mbps'} />
                )}
                <DetailRow label="Adapter"     value={detail.adapter} />
              </div>

              <button
                type="button"
                onClick={handleDisconnect}
                disabled={!!connecting}
                style={{
                  marginTop: 8, fontSize: 9, padding: '3px 8px', cursor: connecting ? 'default' : 'pointer',
                  background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2,
                  color: connecting === '__disconnect__' ? 'var(--text-muted)' : 'var(--sev-critical)',
                }}
              >
                {connecting === '__disconnect__' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </>
          )}

          {detail.state !== 'connected' && (
            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
              {detail.adapter ?? 'No wireless adapter detected'}
            </span>
          )}
        </div>
      )}

      {/* Status message */}
      {statusMsg && (
        <div style={{ padding: '4px 10px', fontSize: 9, color: 'var(--sev-warn)', flexShrink: 0 }}>
          {statusMsg}
        </div>
      )}

      {/* Available networks */}
      <div style={{ flexGrow: 1 }}>
        <div style={{ padding: '6px 10px 4px', fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>
          {scanning ? 'SCANNING…' : `AVAILABLE NETWORKS (${networks.length})`}
        </div>

        {networks.map((net, i) => {
          const isCurrent   = net.ssid === detail?.ssid;
          const isSaved     = profileSet.has(net.ssid.toLowerCase());
          const isConnecting = connecting === net.ssid;

          return (
            <div
              key={`${net.ssid}-${i}`}
              style={{
                padding: '5px 10px',
                borderTop: '1px solid var(--border-subtle)',
                background: isCurrent ? 'rgba(var(--sev-ok-rgb,34 197 94),0.06)' : undefined,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <SignalBars signal={net.signal} size={12} />
              <SecurityIcon auth={net.auth} />

              <div style={{ flexGrow: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {net.ssid}
                  {isCurrent && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--sev-ok)' }}>✓</span>}
                  {isSaved && !isCurrent && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--text-muted)' }}>saved</span>}
                </div>
                <div style={{ fontSize: 8, color: 'var(--text-secondary)' }}>
                  {[net.band, net.radioType, net.channel != null && `ch ${net.channel}`, `${net.signal}%`].filter(Boolean).join(' · ')}
                </div>
              </div>

              {/* Connect button — only for saved profiles; new networks need OS credential flow */}
              {!isCurrent && isSaved && (
                <button
                  type="button"
                  disabled={!!connecting}
                  onClick={() => handleConnect(net.ssid)}
                  aria-label={`Connect to ${net.ssid}`}
                  style={{
                    background: 'none', border: 'none', cursor: connecting ? 'default' : 'pointer',
                    padding: 2, display: 'flex', flexShrink: 0,
                  }}
                >
                  {isConnecting
                    ? <RefreshCw className="w-3 h-3" style={{ color: 'var(--text-secondary)', animation: 'spin 1s linear infinite' }} />
                    : <ChevronRight className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                  }
                </button>
              )}

              {/* Unsaved networks: show a hint that the OS will prompt */}
              {!isCurrent && !isSaved && (
                <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>new</span>
              )}
            </div>
          );
        })}

        {!scanning && networks.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 9, color: 'var(--text-secondary)' }}>
            No networks found. Click ↺ to scan.
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 10px 6px', borderTop: '1px solid var(--border-subtle)', fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>
        Saved profiles connect directly. New networks require OS credentials.
      </div>
    </div>
  );
}
