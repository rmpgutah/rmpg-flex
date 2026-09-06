import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, Lock, Unlock, ChevronRight, ChevronDown, X, Router } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

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

interface ScannedBssid {
  bssid: string | null;
  signal: number;
  signalDbm: number;
  radioType: string | null;
  channel: number | null;
  frequencyMhz: number | null;
  basicRates: number[];
  otherRates: number[];
  maxRateMbps: number | null;
  vendor: string | null;
}

interface ScannedNetwork {
  ssid: string;
  auth: string;
  enc: string;
  networkType: string | null;
  isHidden: boolean;
  signal: number;
  signalDbm: number;
  channel: number | null;
  band: string | null;
  radioType: string | null;
  frequencyMhz: number | null;
  vendor: string | null;
  maxRateMbps: number | null;
  basicRates: number[];
  otherRates: number[];
  bssidCount: number;
  bssids: ScannedBssid[];
}

// ── Signal bars ──────────────────────────────────────────────────────────────

function SignalBars({ signal, size = 14 }: { signal: number; size?: number }) {
  const bars  = signal > 75 ? 4 : signal > 50 ? 3 : signal > 25 ? 2 : 1;
  const color = signal > 75 ? 'var(--sev-ok)' : signal > 40 ? 'var(--sev-warn)' : 'var(--sev-critical)';
  const gap   = Math.round(size * 0.15);
  const barW  = Math.round(size * 0.18);
  const totalW = 4 * barW + 3 * gap;
  const heights = [0.4, 0.6, 0.78, 1.0].map(h => Math.round(h * size));
  return (
    <svg width={totalW} height={size} viewBox={`0 0 ${totalW} ${size}`} aria-hidden="true">
      {heights.map((h, i) => (
        <rect key={i} x={i * (barW + gap)} y={size - h} width={barW} height={h} rx={1}
          fill={i < bars ? color : 'var(--border-subtle)'} />
      ))}
    </svg>
  );
}

// ── Detail row (label + value) ────────────────────────────────────────────────

function DetailRow({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 9, color: 'var(--field-label-color)', flexShrink: 0, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 9, color: 'var(--text-primary)', textAlign: 'right', wordBreak: 'break-all', fontFamily: mono ? 'Arial, sans-serif' : undefined }}>{value}</span>
    </div>
  );
}

// ── Security icon ────────────────────────────────────────────────────────────

function SecurityIcon({ auth }: { auth: string }) {
  return /open|none/i.test(auth)
    ? <Unlock className="w-2.5 h-2.5" style={{ color: 'var(--sev-warn)', flexShrink: 0 }} />
    : <Lock   className="w-2.5 h-2.5" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />;
}

// ── Expanded network detail pane ─────────────────────────────────────────────

function NetworkDetail({ net }: { net: ScannedNetwork }) {
  const allRates = [...new Set([...net.basicRates, ...net.otherRates])].sort((a, b) => a - b);
  const isOpen   = /open|none/i.test(net.auth);

  return (
    <div style={{ padding: '6px 10px 8px 28px', background: 'var(--surface-sunken)', borderTop: '1px solid var(--border-subtle)' }}>
      {/* Security block */}
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.07em', marginBottom: 4 }}>SECURITY</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
        <DetailRow label="Authentication" value={net.auth} />
        <DetailRow label="Encryption"     value={net.enc} />
        {isOpen && (
          <div style={{ fontSize: 9, color: 'var(--sev-warn)', marginTop: 2 }}>⚠ Open network — no encryption</div>
        )}
      </div>

      {/* RF block */}
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.07em', marginBottom: 4 }}>RF</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
        <DetailRow label="Signal"     value={`${net.signal}%  (${net.signalDbm} dBm)`} />
        <DetailRow label="Frequency"  value={net.frequencyMhz ? `${net.frequencyMhz} MHz` : null} />
        <DetailRow label="Channel"    value={net.channel != null ? String(net.channel) : null} />
        <DetailRow label="Band"       value={net.band} />
        <DetailRow label="Radio"      value={net.radioType} />
        {net.maxRateMbps != null && (
          <DetailRow label="Max rate"  value={`${net.maxRateMbps} Mbps`} />
        )}
        {allRates.length > 0 && (
          <DetailRow label="Rates (Mbps)" value={allRates.join('  ')} />
        )}
        <DetailRow label="Network type" value={net.networkType} />
      </div>

      {/* Access points block */}
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.07em', marginBottom: 4 }}>
        ACCESS POINTS ({net.bssidCount})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {net.bssids.map((b, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 4, borderLeft: '2px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <SignalBars signal={b.signal} size={10} />
              <span style={{ fontSize: 9, fontFamily: 'Arial, sans-serif', color: 'var(--text-primary)' }}>{b.bssid ?? '—'}</span>
              {b.vendor && (
                <span style={{ fontSize: 8, color: 'var(--text-secondary)', flexShrink: 0 }}>{b.vendor}</span>
              )}
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-secondary)', paddingLeft: 2 }}>
              {[
                `${b.signal}% (${b.signalDbm} dBm)`,
                b.frequencyMhz ? `${b.frequencyMhz} MHz` : null,
                b.channel != null ? `ch ${b.channel}` : null,
                b.radioType,
                b.maxRateMbps ? `≤${b.maxRateMbps} Mbps` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export default function WifiSelector({ onClose }: { onClose: () => void }) {
  const el = (window as any).electron as Record<string, (...a: any[]) => Promise<any>> | undefined;

  const [detail,     setDetail]     = useState<WifiDetail | null>(null);
  const [networks,   setNetworks]   = useState<ScannedNetwork[]>([]);
  const [profiles,   setProfiles]   = useState<string[]>([]);
  const [scanning,   setScanning]   = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [statusMsg,  setStatusMsg]  = useState<string | null>(null);
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set());

  const ref = useRef<HTMLDivElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  useEffect(() => () => { if (statusTimerRef.current !== null) clearTimeout(statusTimerRef.current); }, []);

  const hasWifiIpc = !!el?.wifiScanNetworks;

  const loadDetail = useCallback(async () => {
    if (!el?.wifiGetDetail) return;
    try { setDetail(await el.wifiGetDetail()); } catch { /* silent */ }
  }, [el]);

  const scan = useCallback(async () => {
    if (!el?.wifiScanNetworks) {
      setStatusMsg('WiFi scanning requires the FlexOS desktop app with system permissions.');
      return;
    }
    setScanning(true);
    setStatusMsg(null);
    setExpanded(new Set());
    try {
      const [nets, profs] = await Promise.all([
        el.wifiScanNetworks(),
        el.wifiListProfiles?.() ?? Promise.resolve([]),
      ]);
      const sorted = (nets as ScannedNetwork[]).sort((a, b) => b.signal - a.signal);
      setNetworks(sorted);
      setProfiles(profs as string[]);
      if (sorted.length === 0) {
        setStatusMsg('No networks in range. Move closer to an access point or check WiFi hardware.');
      }
    } catch (err) {
      setStatusMsg('Scan failed: ' + (err instanceof Error ? err.message : 'unknown error — check WiFi adapter.'));
    } finally {
      setScanning(false);
    }
  }, [el]);

  useEffect(() => { loadDetail(); scan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = useCallback(async (profileName: string) => {
    if (!el?.wifiConnect || connecting) return;
    setConnecting(profileName);
    setStatusMsg(null);
    try {
      const res = await el.wifiConnect(profileName) as { ok: boolean; reason?: string };
      if (res.ok) {
        setStatusMsg(`Connecting to "${profileName}"…`);
        if (statusTimerRef.current !== null) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => { loadDetail(); setStatusMsg(null); }, 3000);
      } else {
        setStatusMsg(`Failed: ${res.reason ?? 'unknown'}`);
      }
    } catch (err) {
      setStatusMsg('Error: ' + (err instanceof Error ? err.message : 'unknown'));
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
      if (statusTimerRef.current !== null) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => { loadDetail(); setStatusMsg(null); }, 1500);
    } catch (err) {
      setStatusMsg('Error: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setConnecting(null);
    }
  }, [el, connecting, loadDetail]);

  const toggleExpand = (i: number) =>
    setExpanded(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });

  const profileSet = new Set(profiles.map(p => p.toLowerCase()));

  return (
    <div
      ref={ref}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
        width: 320, maxHeight: 520, overflowY: 'auto',
        background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
        boxShadow: '0 8px 24px rgba(0 0 0 / 0.55)', zIndex: 99990,
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 6px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {detail?.state === 'connected'
          ? <Wifi    className="w-3.5 h-3.5" style={{ color: 'var(--sev-ok)' }} />
          : <WifiOff className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
        }
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--field-label-color)', flexGrow: 1 }}>WI-FI</span>
        <button type="button" onClick={scan} disabled={scanning} aria-label="Rescan"
          style={{ background: 'none', border: 'none', cursor: scanning ? 'default' : 'pointer', padding: 2, display: 'flex' }}>
          <RefreshCw className="w-3 h-3" style={{ color: 'var(--text-secondary)', animation: scanning ? 'spin 1s linear infinite' : undefined }} />
        </button>
        <button type="button" onClick={onClose} aria-label="Close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}>
          <X className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* Connected network */}
      {detail && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 6 }}>
            {detail.state === 'connected' ? 'CONNECTED' : 'NO CONNECTION'}
          </div>

          {detail.state === 'connected' && detail.ssid ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {detail.ssid}
                </span>
                {detail.signal != null && <SignalBars signal={detail.signal} />}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <DetailRow label="IP Address" value={detail.ip}                                     mono />
                <DetailRow label="IPv6"        value={detail.ipv6}                                  mono />
                <DetailRow label="Gateway"     value={detail.gateway}                               mono />
                {detail.dns?.length > 0 && <DetailRow label="DNS" value={detail.dns.join(', ')}    mono />}
                <DetailRow label="Subnet"      value={detail.subnet}                               mono />
                <DetailRow label="MAC"         value={detail.mac}                                   mono />
                <DetailRow label="BSSID"       value={detail.bssid}                                mono />
                <DetailRow label="Channel"     value={detail.channel != null ? String(detail.channel) : null} />
                <DetailRow label="Band"        value={detail.band} />
                <DetailRow label="Radio"       value={detail.radioType} />
                <DetailRow label="Security"    value={detail.auth} />
                <DetailRow label="Cipher"      value={detail.cipher} />
                {(detail.rxMbps != null || detail.txMbps != null) && (
                  <DetailRow label="Speed" value={[detail.rxMbps && `↓${detail.rxMbps}`, detail.txMbps && `↑${detail.txMbps}`].filter(Boolean).join('  ') + ' Mbps'} />
                )}
                <DetailRow label="Adapter" value={detail.adapter} />
              </div>
              <button type="button" onClick={handleDisconnect} disabled={!!connecting}
                style={{ marginTop: 8, fontSize: 9, padding: '3px 8px', cursor: connecting ? 'default' : 'pointer', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, color: connecting === '__disconnect__' ? 'var(--text-muted)' : 'var(--sev-critical)' }}>
                {connecting === '__disconnect__' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{detail.adapter ?? 'No wireless adapter detected'}</span>
          )}
        </div>
      )}

      {/* Status message */}
      {statusMsg && (
        <div style={{ padding: '4px 10px', fontSize: 9, color: 'var(--sev-warn)', flexShrink: 0 }}>{statusMsg}</div>
      )}

      {/* Available networks */}
      <div style={{ flexGrow: 1 }}>
        <div style={{ padding: '6px 10px 4px', fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>
          {scanning ? 'SCANNING…' : `AVAILABLE NETWORKS (${networks.length})`}
        </div>

        {networks.map((net, i) => {
          const isCurrent    = net.ssid === detail?.ssid;
          const isSaved      = profileSet.has(net.ssid.toLowerCase());
          const isConnecting = connecting === net.ssid;
          const isExpanded   = expanded.has(i);
          const displaySsid  = net.isHidden ? '(Hidden network)' : net.ssid;

          return (
            <div key={`${net.ssid}-${i}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {/* Main row */}
              <div
                style={{
                  padding: '5px 10px',
                  background: isCurrent ? 'rgba(var(--sev-ok-rgb,34 197 94),0.06)' : undefined,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <SignalBars signal={net.signal} size={12} />
                <SecurityIcon auth={net.auth} />

                {/* Info block — click to expand */}
                <button
                  type="button"
                  onClick={() => toggleExpand(i)}
                  style={{ flexGrow: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${displaySsid}`}
                >
                  <div style={{ fontSize: 10, color: net.isHidden ? 'var(--text-secondary)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: net.isHidden ? 'italic' : undefined }}>
                    {displaySsid}
                    {isCurrent && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--sev-ok)' }}>✓</span>}
                    {isSaved && !isCurrent && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--text-muted)' }}>saved</span>}
                    {net.bssidCount > 1 && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--text-muted)' }}>{net.bssidCount} APs</span>}
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginTop: 1 }}>
                    {[
                      net.vendor,
                      net.band,
                      net.radioType,
                      net.frequencyMhz ? `${net.frequencyMhz} MHz` : null,
                      net.channel != null ? `ch ${net.channel}` : null,
                      `${net.signal}% (${net.signalDbm} dBm)`,
                      net.maxRateMbps ? `≤${net.maxRateMbps} Mbps` : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </button>

                {/* Expand chevron */}
                <button type="button" onClick={() => toggleExpand(i)} aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}>
                  {isExpanded
                    ? <ChevronDown  className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                    : <ChevronRight className="w-3 h-3" style={{ color: 'var(--border-subtle)' }} />
                  }
                </button>

                {/* Connect / indicator */}
                {!isCurrent && isSaved && (
                  <button type="button" disabled={!!connecting} onClick={() => handleConnect(net.ssid)}
                    aria-label={`Connect to ${net.ssid}`}
                    style={{ background: 'none', border: 'none', cursor: connecting ? 'default' : 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}>
                    {isConnecting
                      ? <RefreshCw    className="w-3 h-3" style={{ color: 'var(--text-secondary)', animation: 'spin 1s linear infinite' }} />
                      : <Router       className="w-3 h-3" style={{ color: 'var(--brand-400)' }} />
                    }
                  </button>
                )}
                {!isCurrent && !isSaved && (
                  <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>new</span>
                )}
              </div>

              {/* Expanded detail */}
              {isExpanded && <NetworkDetail net={net} />}
            </div>
          );
        })}

        {!scanning && networks.length === 0 && !statusMsg && (
          <div style={{ padding: '8px 10px', fontSize: 9, color: 'var(--text-secondary)' }}>
            {hasWifiIpc
              ? 'No networks found. Click ↺ to scan.'
              : 'WiFi management requires the FlexOS desktop app.'}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 10px 6px', borderTop: '1px solid var(--border-subtle)', fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>
        {hasWifiIpc
          ? 'Click a network row to inspect RF details · Saved profiles connect directly · New networks require OS credentials'
          : 'WiFi scanning requires FlexOS desktop app · Browser shows connection status only'}
      </div>
    </div>
  );
}
