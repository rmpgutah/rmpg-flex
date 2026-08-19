import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Radio, Bluetooth, Wifi, Network, Globe, Server,
  RefreshCw, Trash2, Download, ChevronDown, ChevronRight,
  Activity, Shield, Clock, Copy, X,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';

// ── Types ────────────────────────────────────────────────────────────────────

type ScanType = 'arp' | 'bluetooth' | 'ssdp' | 'mdns' | 'netbios' | 'full-sweep';

interface CapturedDevice {
  ip?: string | null;
  mac?: string | null;
  vendor?: string | null;
  protocol?: string | null;
  scanMethod?: string | null;
  // ARP
  type?: string | null;
  interface?: string | null;
  state?: string | null;
  // Bluetooth
  name?: string | null;
  manufacturer?: string | null;
  hardwareId?: string | null;
  status?: string | null;
  // SSDP
  location?: string | null;
  usn?: string | null;
  st?: string | null;
  server?: string | null;
  cacheControl?: string | null;
  port?: number | null;
  // mDNS
  hostname?: string | null;
  // NetBIOS
  // (name already above)
}

interface CaptureEntry {
  id: string;
  timestamp: string;
  scanType: ScanType;
  deviceCount: number;
  devices: CapturedDevice[];
  method?: string;
  startTs?: string;
  protocols?: Record<string, string>;
  raw?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SCAN_META: Record<ScanType, { label: string; icon: React.ElementType; color: string }> = {
  'arp':        { label: 'ARP / NDP',   icon: Network,    color: 'var(--brand-400)' },
  'bluetooth':  { label: 'Bluetooth',   icon: Bluetooth,  color: '#60a5fa' },
  'ssdp':       { label: 'SSDP/UPnP',  icon: Globe,      color: '#a78bfa' },
  'mdns':       { label: 'mDNS',        icon: Server,     color: '#34d399' },
  'netbios':    { label: 'NetBIOS',     icon: Radio,      color: '#fb923c' },
  'full-sweep': { label: 'Full Sweep',  icon: Activity,   color: 'var(--sev-warn)' },
};

function fmtTs(ts: string) {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function DeviceRow({ dev }: { dev: CapturedDevice }) {
  const [open, setOpen] = useState(false);
  const label = dev.name || dev.hostname || dev.ip || dev.usn || 'Unknown';
  const sub   = [dev.vendor || dev.manufacturer, dev.mac, dev.ip].filter(Boolean).join('  ·  ');
  const badge = dev.scanMethod || dev.protocol;

  const fields = Object.entries(dev).filter(([k, v]) =>
    v !== null && v !== undefined && v !== '' && k !== 'scanMethod'
  );

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left' }}
      >
        {open
          ? <ChevronDown  className="w-2.5 h-2.5" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          : <ChevronRight className="w-2.5 h-2.5" style={{ color: 'var(--border-subtle)',  flexShrink: 0 }} />
        }
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
          {sub && <div style={{ fontSize: 8, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{sub}</div>}
        </div>
        {badge && (
          <span style={{ fontSize: 8, padding: '1px 5px', background: 'rgba(var(--brand-400-rgb,96 165 250)/0.15)', color: 'var(--brand-400)', flexShrink: 0, border: '1px solid var(--border-subtle)' }}>
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: '4px 24px 8px', display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--surface-sunken)' }}>
          {fields.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 8, color: 'var(--field-label-color)', flexShrink: 0, minWidth: 80 }}>{k}</span>
              <span style={{ fontSize: 8, color: 'var(--text-primary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCard({ entry, onDelete }: { entry: CaptureEntry; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const meta = SCAN_META[entry.scanType] ?? SCAN_META['full-sweep'];
  const Icon = meta.icon;

  return (
    <div style={{ border: '1px solid var(--border-subtle)', marginBottom: 6 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--surface-raised)', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <Icon className="w-3 h-3" style={{ color: meta.color, flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', flexGrow: 1 }}>{meta.label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{entry.deviceCount} device{entry.deviceCount !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{fmtTs(entry.timestamp)}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }} aria-label="Delete entry"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}>
          <X className="w-2.5 h-2.5" style={{ color: 'var(--sev-critical)' }} />
        </button>
        {open
          ? <ChevronDown  className="w-3 h-3" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          : <ChevronRight className="w-3 h-3" style={{ color: 'var(--border-subtle)',  flexShrink: 0 }} />
        }
      </div>

      {open && (
        <div>
          {/* Meta info */}
          {entry.method && (
            <div style={{ padding: '4px 8px', fontSize: 8, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
              <Shield className="w-2.5 h-2.5" style={{ display: 'inline', marginRight: 4, color: 'var(--field-label-color)' }} />
              {entry.method}
            </div>
          )}
          {entry.protocols && (
            <div style={{ padding: '3px 8px', display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)' }}>
              {Object.entries(entry.protocols).map(([proto, status]) => (
                <span key={proto} style={{ fontSize: 7, color: status === 'fulfilled' ? 'var(--sev-ok)' : 'var(--sev-critical)' }}>
                  {proto}: {status === 'fulfilled' ? '✓' : '✗'}
                </span>
              ))}
            </div>
          )}
          {/* Device list */}
          {entry.devices.length > 0
            ? entry.devices.map((d, i) => <DeviceRow key={i} dev={d} />)
            : <div style={{ padding: '6px 8px', fontSize: 9, color: 'var(--text-muted)' }}>No devices captured.</div>
          }
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const SCAN_BUTTONS: { type: ScanType; label: string; invoke: string }[] = [
  { type: 'full-sweep', label: 'Full Sweep',  invoke: 'devicesScanAll'       },
  { type: 'arp',        label: 'ARP / NDP',   invoke: 'devicesScanArp'       },
  { type: 'bluetooth',  label: 'Bluetooth',   invoke: 'devicesScanBluetooth' },
  { type: 'ssdp',       label: 'SSDP/UPnP',  invoke: 'devicesScanSsdp'      },
  { type: 'mdns',       label: 'mDNS',        invoke: 'devicesScanMdns'      },
  { type: 'netbios',    label: 'NetBIOS',     invoke: 'devicesScanNetbios'   },
];

export default function DeviceScannerPage() {
  const el = (window as any).electron as Record<string, (...a: any[]) => Promise<any>> | undefined;

  const [log,         setLog]         = useState<CaptureEntry[]>([]);
  const [scanning,    setScanning]    = useState<ScanType | null>(null);
  const [statusMsg,   setStatusMsg]   = useState<string | null>(null);
  const [autoInterval,setAutoInterval]= useState<number>(0); // 0 = off
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLog = useCallback(async () => {
    if (!el?.devicesGetLog) return;
    try {
      const res = await el.devicesGetLog();
      if (res.ok) setLog(res.log);
    } catch {}
  }, [el]);

  useEffect(() => { loadLog(); }, [loadLog]);

  // Auto-scan interval
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoInterval <= 0) return;
    intervalRef.current = setInterval(() => runScan('full-sweep'), autoInterval * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoInterval]); // eslint-disable-line react-hooks/exhaustive-deps

  const runScan = useCallback(async (type: ScanType) => {
    const btn = SCAN_BUTTONS.find(b => b.type === type);
    if (!btn || !el?.[btn.invoke] || scanning) return;
    setScanning(type);
    setStatusMsg(null);
    try {
      const res = await el[btn.invoke]();
      if (res.ok) {
        setLog(prev => [res.entry, ...prev.filter(e => e.id !== res.entry.id)]);
        setStatusMsg(`${SCAN_META[type].label}: ${res.entry.deviceCount} device${res.entry.deviceCount !== 1 ? 's' : ''} captured`);
      } else {
        setStatusMsg(`Scan failed: ${res.reason ?? 'unknown'}`);
      }
    } catch (e: any) {
      setStatusMsg('Error: ' + (e?.message ?? 'unknown'));
    } finally {
      setScanning(null);
    }
  }, [el, scanning]);

  const handleDelete = useCallback(async (id: string) => {
    if (!el?.devicesDeleteEntry) return;
    await el.devicesDeleteEntry(id);
    setLog(prev => prev.filter(e => e.id !== id));
  }, [el]);

  const handleClear = useCallback(async () => {
    if (!el?.devicesClearLog) return;
    await el.devicesClearLog();
    setLog([]);
    setStatusMsg('Log cleared.');
  }, [el]);

  const handleExport = useCallback(async () => {
    if (!el?.devicesExportLog) return;
    const res = await el.devicesExportLog();
    setStatusMsg(res.ok ? `Exported to ${res.path}` : `Export failed: ${res.reason}`);
  }, [el]);

  const copyEntry = useCallback((entry: CaptureEntry) => {
    navigator.clipboard?.writeText(JSON.stringify(entry, null, 2)).catch(() => {});
  }, []);

  const totalDevices = log.reduce((acc, e) => acc + e.deviceCount, 0);

  return (
    <div className="p-3 space-y-3" style={{ maxWidth: 900 }}>
      <PanelTitleBar title="DEVICE CAPTURE SCANNER" icon={Radio} />

      {/* Scan controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {SCAN_BUTTONS.map(btn => {
          const meta = SCAN_META[btn.type];
          const Icon = meta.icon;
          const isActive = scanning === btn.type;
          return (
            <button
              key={btn.type}
              type="button"
              disabled={!!scanning}
              onClick={() => runScan(btn.type)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 9, padding: '4px 10px',
                background: btn.type === 'full-sweep' ? (isActive ? 'var(--brand-400)' : 'rgba(var(--brand-400-rgb,96 165 250)/0.15)') : 'var(--surface-raised)',
                border: `1px solid ${isActive ? meta.color : 'var(--border-subtle)'}`,
                color: isActive ? '#fff' : 'var(--text-primary)',
                cursor: scanning ? 'default' : 'pointer',
                fontWeight: btn.type === 'full-sweep' ? 700 : 400,
              }}
            >
              {isActive
                ? <RefreshCw className="w-2.5 h-2.5" style={{ animation: 'spin 1s linear infinite' }} />
                : <Icon className="w-2.5 h-2.5" style={{ color: isActive ? '#fff' : meta.color }} />
              }
              {btn.label}
            </button>
          );
        })}

        {/* Auto-scan interval */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <Clock className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
          <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Auto:</span>
          <select
            value={autoInterval}
            onChange={e => setAutoInterval(Number(e.target.value))}
            style={{ fontSize: 9, padding: '2px 4px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value={0}>Off</option>
            <option value={30}>30 s</option>
            <option value={60}>1 min</option>
            <option value={300}>5 min</option>
            <option value={600}>10 min</option>
          </select>
        </div>
      </div>

      {/* Status */}
      {statusMsg && (
        <div style={{ fontSize: 9, color: 'var(--sev-warn)', padding: '3px 0' }}>{statusMsg}</div>
      )}

      {/* Log header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--field-label-color)' }}>
          CAPTURE LOG — {log.length} scan{log.length !== 1 ? 's' : ''} · {totalDevices} total devices
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, padding: '2px 8px', background: 'none', border: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <Download className="w-2.5 h-2.5" /> Export JSON
          </button>
          <button type="button" onClick={handleClear} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, padding: '2px 8px', background: 'none', border: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--sev-critical)' }}>
            <Trash2 className="w-2.5 h-2.5" /> Clear All
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div>
        {log.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
            No captures yet. Run a scan to populate the log.
          </div>
        ) : (
          log.map(entry => (
            <div key={entry.id} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => copyEntry(entry)}
                title="Copy entry JSON"
                style={{ position: 'absolute', top: 6, right: 32, background: 'none', border: 'none', cursor: 'pointer', padding: 2, zIndex: 1 }}
              >
                <Copy className="w-2 h-2" style={{ color: 'var(--border-subtle)' }} />
              </button>
              <EntryCard entry={entry} onDelete={handleDelete} />
            </div>
          ))
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
        {Object.entries(SCAN_META).map(([type, meta]) => {
          const Icon = meta.icon;
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon className="w-2.5 h-2.5" style={{ color: meta.color }} />
              <span style={{ fontSize: 8, color: 'var(--text-secondary)' }}>{meta.label}</span>
            </div>
          );
        })}
        <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          Passive-only · no connection required · log persists across restarts
        </span>
      </div>
    </div>
  );
}
