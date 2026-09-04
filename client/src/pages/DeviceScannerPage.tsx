import { useState, useCallback, useRef } from 'react';
import {
  Radio, Wifi, Bluetooth, Globe, Network, Server,
  Printer, Tv, Speaker, Camera, Cpu, Gamepad2,
  Router, Monitor, Smartphone, HelpCircle,
  ScanLine, Trash2, Download, RefreshCw, ChevronDown, ChevronRight,
  Shield, Zap, Antenna,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';

const TABS = [
  { id: 'overview',   label: 'Overview',       icon: Antenna },
  { id: 'network',    label: 'Network (ARP)',   icon: Network },
  { id: 'bluetooth',  label: 'Bluetooth',       icon: Bluetooth },
  { id: 'ssdp',       label: 'UPnP / SSDP',    icon: Globe },
  { id: 'mdns',       label: 'mDNS / Bonjour',  icon: Wifi },
  { id: 'netbios',    label: 'NetBIOS',         icon: Server },
  { id: 'history',    label: 'History',         icon: Shield },
] as const;
type TabId = typeof TABS[number]['id'];

interface MergedDevice {
  ip?: string | null;
  mac?: string | null;
  vendor?: string | null;
  manufacturer?: string | null;
  name?: string | null;
  deviceClass?: string | null;
  protocols?: string[];
  names?: string[];
  services?: string[];
  openPorts?: Record<string, string>;
  friendlyName?: string | null;
  hostname?: string | null;
  ptrHostname?: string | null;
  netbiosName?: string | null;
  netbiosWorkgroup?: string | null;
  netbiosUser?: string | null;
  location?: string | null;
  server?: string | null;
  modelName?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
  udn?: string | null;
  st?: string | null;
  cacheControl?: string | null;
  btClass?: string | null;
  hardwareId?: string | null;
  status?: string | null;
  interface?: string | null;
  isNew?: boolean;
  scanMethod?: string;
  protocol?: string;
}

interface CaptureEntry {
  id: string;
  timestamp: string;
  scanType: string;
  deviceCount: number;
  devices: MergedDevice[];
  method?: string;
  startTs?: string;
  protocols?: Record<string, string>;
  newDeviceCount?: number;
  localIp?: string;
}

// ── Device class → icon ───────────────────────────────────────────────────────
function DeviceIcon({ cls, size = 14 }: { cls?: string | null; size?: number }) {
  const s = { width: size, height: size, flexShrink: 0 as const };
  switch (cls) {
    case 'router':           return <Router style={s} className="text-blue-400" />;
    case 'printer':          return <Printer style={s} className="text-yellow-400" />;
    case 'smart-tv':         return <Tv style={s} className="text-purple-400" />;
    case 'airplay':          return <Tv style={s} className="text-pink-400" />;
    case 'speaker':          return <Speaker style={s} className="text-green-400" />;
    case 'camera':           return <Camera style={s} className="text-red-400" />;
    case 'gaming':           return <Gamepad2 style={s} className="text-orange-400" />;
    case 'server':           return <Server style={s} className="text-cyan-400" />;
    case 'desktop':          return <Monitor style={s} className="text-blue-300" />;
    case 'iot':              return <Cpu style={s} className="text-teal-400" />;
    case 'media-server':     return <Tv style={s} className="text-indigo-400" />;
    case 'bluetooth-device': return <Bluetooth style={s} className="text-blue-500" />;
    case 'mobile':           return <Smartphone style={s} className="text-emerald-400" />;
    default:                 return <HelpCircle style={s} className="text-rmpg-500" />;
  }
}

const PROTO_COLORS: Record<string, string> = {
  ARP:          'bg-blue-900/60 text-blue-300',
  'NDP/IPv6':   'bg-blue-800/60 text-blue-300',
  Bluetooth:    'bg-indigo-900/60 text-indigo-300',
  'SSDP/UPnP':  'bg-purple-900/60 text-purple-300',
  SSDP:         'bg-purple-900/60 text-purple-300',
  mDNS:         'bg-teal-900/60 text-teal-300',
  NetBIOS:      'bg-amber-900/60 text-amber-300',
};
function ProtoBadge({ proto }: { proto: string }) {
  const color = PROTO_COLORS[proto] || 'bg-rmpg-800/60 text-rmpg-300';
  return <span className={`px-1 py-px text-[9px] font-mono rounded ${color}`}>{proto}</span>;
}

function PortChip({ port, svc }: { port: string; svc: string }) {
  return <span className="px-1 py-px text-[9px] font-mono rounded bg-green-900/50 text-green-300">{port}/{svc}</span>;
}

function NewBadge() {
  return <span className="px-1 py-px text-[9px] font-bold rounded bg-red-500/20 text-red-400 border border-red-500/40">NEW</span>;
}

function TH({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-1.5 text-left text-[10px] font-semibold text-[color:var(--panel-header-color)] border-b border-rmpg-700/50 whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}
function TD({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1 text-[11px] text-rmpg-200 align-top ${className}`}>{children}</td>;
}

// ── Expandable device row (overview + network) ────────────────────────────────
function ExpandableRow({ d }: { d: MergedDevice }) {
  const [open, setOpen] = useState(false);
  const ports = Object.entries(d.openPorts || {});
  return (
    <>
      <tr className="border-b border-rmpg-800/30 hover:bg-surface-raised/20 transition-colors cursor-pointer" onClick={() => setOpen(o => !o)}>
        <TD>
          <div className="flex items-center gap-1.5">
            {open ? <ChevronDown size={10} className="text-rmpg-500" /> : <ChevronRight size={10} className="text-rmpg-500" />}
            <DeviceIcon cls={d.deviceClass} size={12} />
            <span className="font-medium text-rmpg-100">{d.name || '—'}</span>
            {d.isNew && <NewBadge />}
          </div>
        </TD>
        <TD><code className="font-mono text-[10px]">{d.ip || '—'}</code></TD>
        <TD><code className="font-mono text-[10px]">{d.mac || '—'}</code></TD>
        <TD>{d.vendor || d.manufacturer || '—'}</TD>
        <TD>{d.hostname || d.ptrHostname || '—'}</TD>
        <TD>{d.netbiosName || '—'}</TD>
        <TD>
          <div className="flex flex-wrap gap-0.5">
            {ports.slice(0, 5).map(([p, s]) => <PortChip key={p} port={p} svc={s} />)}
            {ports.length > 5 && <span className="text-[9px] text-rmpg-500">+{ports.length - 5}</span>}
          </div>
        </TD>
        <TD>{d.interface || '—'}</TD>
      </tr>
      {open && (
        <tr className="bg-surface-sunken/30 border-b border-rmpg-800/40">
          <td colSpan={8} className="px-6 py-2">
            <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 text-[10px]">
              {d.friendlyName     && <><span className="text-[color:var(--field-label-color)]">Friendly Name</span><span className="text-rmpg-200">{d.friendlyName}</span></>}
              {d.modelName        && <><span className="text-[color:var(--field-label-color)]">Model</span><span className="text-rmpg-200">{d.modelName} {d.modelNumber || ''}</span></>}
              {d.serialNumber     && <><span className="text-[color:var(--field-label-color)]">Serial</span><span className="text-rmpg-200">{d.serialNumber}</span></>}
              {d.netbiosWorkgroup && <><span className="text-[color:var(--field-label-color)]">Workgroup</span><span className="text-amber-300">{d.netbiosWorkgroup}</span></>}
              {d.netbiosUser      && <><span className="text-[color:var(--field-label-color)]">Logged-in User</span><span className="text-green-300">{d.netbiosUser}</span></>}
              {(d.names  || []).length > 0 && <><span className="text-[color:var(--field-label-color)]">All Names</span><span className="text-rmpg-300 break-all">{(d.names || []).join(' · ')}</span></>}
              {(d.services || []).length > 0 && <><span className="text-[color:var(--field-label-color)]">mDNS Services</span><span className="text-teal-300 break-all">{(d.services || []).join(' · ')}</span></>}
              {ports.length > 0  && <><span className="text-[color:var(--field-label-color)]">Open Ports</span><span className="text-green-300">{ports.map(([p, s]) => `${p}/${s}`).join(', ')}</span></>}
              {d.location        && <><span className="text-[color:var(--field-label-color)]">SSDP Location</span><span className="text-rmpg-400 break-all text-[9px]">{d.location}</span></>}
              {d.udn             && <><span className="text-[color:var(--field-label-color)]">UDN</span><span className="text-rmpg-400 text-[9px]">{d.udn}</span></>}
              {(d.protocols || []).length > 0 && (
                <><span className="text-[color:var(--field-label-color)]">Protocols</span>
                  <div className="flex flex-wrap gap-1">{(d.protocols || []).map(p => <ProtoBadge key={p} proto={p} />)}</div>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Per-protocol tables ───────────────────────────────────────────────────────
function Empty({ msg }: { msg: string }) {
  return <div className="flex items-center justify-center py-10 text-[11px] text-rmpg-500"><Radio size={14} className="mr-2 opacity-40" />{msg}</div>;
}

function OverviewTable({ devices }: { devices: MergedDevice[] }) {
  if (!devices.length) return <Empty msg="No devices in this scan" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead><tr className="bg-surface-raised/40">
          <TH>Device</TH><TH>IP Address</TH><TH>MAC Address</TH><TH>Vendor</TH>
          <TH>Hostname</TH><TH>NetBIOS Name</TH><TH>Open Ports</TH><TH>Interface</TH>
        </tr></thead>
        <tbody>{devices.map((d, i) => <ExpandableRow key={d.mac || d.ip || i} d={d} />)}</tbody>
      </table>
    </div>
  );
}

function NetworkTable({ devices }: { devices: MergedDevice[] }) {
  const net = devices.filter(d => (d.protocols || [d.protocol]).some((p: any) => p === 'ARP' || p === 'NDP/IPv6'));
  if (!net.length) return <Empty msg="No network neighbors detected — run ARP scan or Full Sweep" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead><tr className="bg-surface-raised/40">
          <TH>Device</TH><TH>IP Address</TH><TH>MAC Address</TH><TH>Vendor / OUI</TH>
          <TH>Hostname (PTR)</TH><TH>NetBIOS Name</TH><TH>Open Ports</TH><TH>Interface</TH>
        </tr></thead>
        <tbody>{net.map((d, i) => <ExpandableRow key={d.mac || d.ip || i} d={d} />)}</tbody>
      </table>
    </div>
  );
}

function BluetoothTable({ devices }: { devices: MergedDevice[] }) {
  const bt = devices.filter(d => (d.protocols || [d.protocol]).some((p: any) => p === 'Bluetooth'));
  if (!bt.length) return <Empty msg="No Bluetooth devices detected — run Bluetooth scan or Full Sweep" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead><tr className="bg-surface-raised/40">
          <TH>Device Name</TH><TH>Type</TH><TH>Manufacturer</TH><TH>MAC</TH>
          <TH>BT Class</TH><TH>Hardware ID</TH><TH>Status</TH>
        </tr></thead>
        <tbody>
          {bt.map((d, i) => (
            <tr key={d.mac || d.hardwareId || i} className="border-b border-rmpg-800/30 hover:bg-surface-raised/20 transition-colors">
              <TD><div className="flex items-center gap-1.5"><DeviceIcon cls={d.deviceClass} size={12} /><span className="font-medium text-rmpg-100">{d.name || d.friendlyName || 'Unknown'}</span>{d.isNew && <NewBadge />}</div></TD>
              <TD>{d.btClass || 'Classic'}</TD>
              <TD>{d.manufacturer || d.vendor || '—'}</TD>
              <TD><code className="font-mono text-[10px] text-rmpg-300">{d.mac || '—'}</code></TD>
              <TD>{d.btClass || '—'}</TD>
              <TD><code className="font-mono text-[9px] text-rmpg-400 break-all">{(d.hardwareId || '').slice(0, 50) || '—'}</code></TD>
              <TD><span className={`px-1 py-px text-[9px] rounded ${d.status === 'OK' ? 'bg-green-900/50 text-green-400' : 'bg-rmpg-800/50 text-rmpg-400'}`}>{d.status || '—'}</span></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SsdpTable({ devices }: { devices: MergedDevice[] }) {
  const ssdp = devices.filter(d => (d.protocols || [d.protocol]).some((p: any) => p === 'SSDP/UPnP' || p === 'SSDP'));
  if (!ssdp.length) return <Empty msg="No UPnP / SSDP devices detected — run SSDP scan or Full Sweep" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead><tr className="bg-surface-raised/40">
          <TH>Friendly Name</TH><TH>IP</TH><TH>Manufacturer</TH><TH>Model</TH>
          <TH>Serial</TH><TH>Service Type</TH><TH>Cache-Control</TH><TH>Server String</TH>
        </tr></thead>
        <tbody>
          {ssdp.map((d, i) => (
            <tr key={d.udn || d.location || d.ip || i} className="border-b border-rmpg-800/30 hover:bg-surface-raised/20 transition-colors">
              <TD><div className="flex items-center gap-1.5"><DeviceIcon cls={d.deviceClass} size={12} /><span className="font-medium text-rmpg-100">{d.friendlyName || d.name || '—'}</span>{d.isNew && <NewBadge />}</div></TD>
              <TD><code className="font-mono text-[10px]">{d.ip || '—'}</code></TD>
              <TD>{d.manufacturer || '—'}</TD>
              <TD>{d.modelName || '—'}{d.modelNumber ? ` (${d.modelNumber})` : ''}</TD>
              <TD><code className="font-mono text-[9px] text-rmpg-400">{d.serialNumber || '—'}</code></TD>
              <TD className="max-w-[180px]"><span className="break-all text-[9px] text-rmpg-400">{d.st || '—'}</span></TD>
              <TD>{d.cacheControl || '—'}</TD>
              <TD className="max-w-[160px]"><span className="break-all text-[9px] text-rmpg-400">{d.server || '—'}</span></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MdnsTable({ devices }: { devices: MergedDevice[] }) {
  const mdns = devices.filter(d => (d.protocols || [d.protocol]).some((p: any) => p === 'mDNS'));
  if (!mdns.length) return <Empty msg="No mDNS / Bonjour devices detected — run mDNS scan or Full Sweep" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead><tr className="bg-surface-raised/40">
          <TH>Instance Name</TH><TH>IP</TH><TH>Hostname (.local)</TH><TH>Services Advertised</TH><TH>All Names</TH>
        </tr></thead>
        <tbody>
          {mdns.map((d, i) => (
            <tr key={d.ip || i} className="border-b border-rmpg-800/30 hover:bg-surface-raised/20 transition-colors">
              <TD><div className="flex items-center gap-1.5"><DeviceIcon cls={d.deviceClass} size={12} /><span className="font-medium text-rmpg-100">{d.name || d.hostname || '—'}</span>{d.isNew && <NewBadge />}</div></TD>
              <TD><code className="font-mono text-[10px]">{d.ip || '—'}</code></TD>
              <TD><code className="font-mono text-[10px] text-teal-300">{d.hostname || '—'}</code></TD>
              <TD><div className="flex flex-wrap gap-1">{(d.services || []).slice(0, 8).map(s => <span key={s} className="px-1 py-px text-[9px] rounded bg-teal-900/40 text-teal-300 font-mono">{s}</span>)}</div></TD>
              <TD><div className="flex flex-wrap gap-1">{(d.names || []).slice(0, 6).map(n => <span key={n} className="text-[9px] text-rmpg-400 font-mono">{n}</span>)}</div></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NetbiosTable({ devices }: { devices: MergedDevice[] }) {
  const nb = devices.filter(d => (d.protocols || [d.protocol]).some((p: any) => p === 'NetBIOS'));
  if (!nb.length) return <Empty msg="No NetBIOS hosts detected — run NetBIOS scan or Full Sweep" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead><tr className="bg-surface-raised/40">
          <TH>Computer Name</TH><TH>IP Address</TH><TH>Workgroup / Domain</TH>
          <TH>Logged-in User</TH><TH>MAC</TH><TH>Vendor</TH>
        </tr></thead>
        <tbody>
          {nb.map((d, i) => (
            <tr key={d.ip || i} className="border-b border-rmpg-800/30 hover:bg-surface-raised/20 transition-colors">
              <TD><div className="flex items-center gap-1.5"><DeviceIcon cls={d.deviceClass} size={12} /><span className="font-medium text-rmpg-100">{d.netbiosName || d.name || '—'}</span>{d.isNew && <NewBadge />}</div></TD>
              <TD><code className="font-mono text-[10px]">{d.ip || '—'}</code></TD>
              <TD><span className="text-amber-300 font-medium">{d.netbiosWorkgroup || '—'}</span></TD>
              <TD><span className="text-green-300">{d.netbiosUser || '—'}</span></TD>
              <TD><code className="font-mono text-[10px]">{d.mac || '—'}</code></TD>
              <TD>{d.vendor || '—'}</TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── History accordion ─────────────────────────────────────────────────────────
function HistoryTable({ log, onDelete }: { log: CaptureEntry[]; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!log.length) return <Empty msg="No capture history yet — run a scan first" />;
  return (
    <div className="space-y-1">
      {log.map(entry => (
        <div key={entry.id} className="border border-rmpg-700/40 rounded bg-surface-raised/10">
          <button
            type="button"
            onClick={() => setExpanded(e => e === entry.id ? null : entry.id)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-surface-raised/20 rounded transition-colors"
          >
            <div className="flex items-center gap-2 text-[11px]">
              {expanded === entry.id ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              <span className="text-rmpg-400 font-mono">{new Date(entry.timestamp).toLocaleString()}</span>
              <span className="text-[color:var(--field-label-color)] font-semibold uppercase text-[9px]">{entry.scanType}</span>
              <span className="text-rmpg-200">{entry.deviceCount} device{entry.deviceCount !== 1 ? 's' : ''}</span>
              {entry.newDeviceCount ? <span className="text-red-400 text-[9px]">{entry.newDeviceCount} new</span> : null}
            </div>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
              className="text-rmpg-600 hover:text-red-400 transition-colors p-0.5 rounded"
              aria-label="Delete entry"
            >
              <Trash2 size={10} />
            </button>
          </button>
          {expanded === entry.id && (
            <div className="px-3 pb-2 border-t border-rmpg-800/30">
              <div className="text-[9px] text-rmpg-500 mb-1">{entry.method}</div>
              <OverviewTable devices={entry.devices} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Scan button ───────────────────────────────────────────────────────────────
function ScanBtn({ label, icon: Icon, onClick, loading, active }: { label: string; icon: React.ElementType; onClick: () => void; loading?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-colors border ${
        active
          ? 'bg-blue-600/30 border-blue-500/50 text-blue-200'
          : 'bg-surface-raised/30 border-rmpg-700/40 text-rmpg-300 hover:bg-surface-raised/60 hover:text-rmpg-100'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {loading ? <RefreshCw size={10} className="animate-spin" /> : <Icon size={10} />}
      {label}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DeviceScannerPage() {
  const [tab, setTab]            = useState<TabId>('overview');
  const [loading, setLoading]    = useState<string | null>(null);
  const [latestEntry, setLatest] = useState<CaptureEntry | null>(null);
  const [log, setLog]            = useState<CaptureEntry[]>([]);
  const [logLoaded, setLogLoaded]= useState(false);
  const [statusMsg, setStatus]   = useState<string | null>(null);
  const electron                 = (window as any).electron;
  const isElectron               = !!electron;
  const statusTimer              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initRef                  = useRef(false);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 4000);
  }, []);

  // Load log once on mount
  if (!initRef.current && isElectron && !logLoaded) {
    initRef.current = true;
    electron.devicesGetLog().then((res: any) => {
      if (res?.ok) { setLog(res.log || []); if (res.log?.[0]) setLatest(res.log[0]); }
      setLogLoaded(true);
    }).catch(() => setLogLoaded(true));
  }

  const runScan = useCallback(async (type: string, fn: () => Promise<any>) => {
    if (!isElectron) return;
    setLoading(type);
    try {
      const res = await fn();
      if (res?.ok && res.entry) {
        setLatest(res.entry);
        setLog(prev => [res.entry, ...prev]);
        const nc = res.newDeviceCount;
        flash(`${res.entry.scanType.toUpperCase()} scan complete — ${res.entry.deviceCount} device${res.entry.deviceCount !== 1 ? 's' : ''} captured${nc ? `, ${nc} NEW` : ''}`);
      } else {
        flash(`Scan failed: ${res?.reason || 'unknown error'}`);
      }
    } catch (e) {
      flash(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(null);
    }
  }, [isElectron, flash]);

  const handleExport = useCallback(async () => {
    if (!isElectron) return;
    const res = await electron.devicesExportLog();
    if (res?.ok) flash(`Exported → ${res.path}`);
    else if (!res?.reason?.includes('cancel')) flash('Export failed');
  }, [isElectron, electron, flash]);

  const handleClear = useCallback(async () => {
    if (!isElectron) return;
    await electron.devicesClearLog();
    setLog([]); setLatest(null);
    flash('Capture log cleared');
  }, [isElectron, electron, flash]);

  const handleDelete = useCallback(async (id: string) => {
    if (!isElectron) return;
    await electron.devicesDeleteEntry(id);
    setLog(prev => prev.filter(e => e.id !== id));
    if (latestEntry?.id === id) setLatest(null);
  }, [isElectron, electron, latestEntry]);

  const latestDevices: MergedDevice[] = latestEntry?.devices || [];
  const newCount = latestDevices.filter(d => d.isNew).length;

  // Tab device counts
  const PROTO_MAP: Record<string, string[]> = {
    network:   ['ARP','NDP/IPv6'],
    bluetooth: ['Bluetooth'],
    ssdp:      ['SSDP/UPnP','SSDP'],
    mdns:      ['mDNS'],
    netbios:   ['NetBIOS'],
  };

  function tabCount(tid: string): number | null {
    if (tid === 'overview') return latestDevices.length || null;
    if (tid === 'history')  return log.length || null;
    const protos = PROTO_MAP[tid];
    if (!protos || !latestDevices.length) return null;
    const n = latestDevices.filter(d => (d.protocols || [d.protocol]).some((p: any) => protos.includes(p))).length;
    return n || null;
  }

  return (
    <div className="h-full flex flex-col bg-surface-base text-rmpg-100 overflow-hidden" style={{ fontSize: '11px' }}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-rmpg-700/50 bg-surface-raised/20">
        <div className="px-4 py-2">
          <PanelTitleBar title="RADAR360 — PASSIVE DEVICE CAPTURE" icon={Antenna} />
        </div>

        {/* Scan controls */}
        <div className="px-4 pb-2 flex flex-wrap items-center gap-1.5">
          <ScanBtn label="Full Sweep" icon={ScanLine}
            onClick={() => runScan('full', () => electron.devicesScanAll())}
            loading={loading === 'full'} active={loading === 'full'} />
          <div className="w-px h-4 bg-rmpg-700/50" />
          <ScanBtn label="ARP / NDP" icon={Network}
            onClick={() => runScan('arp', () => electron.devicesScanArp())}
            loading={loading === 'arp'} />
          <ScanBtn label="Bluetooth" icon={Bluetooth}
            onClick={() => runScan('bt', () => electron.devicesScanBluetooth())}
            loading={loading === 'bt'} />
          <ScanBtn label="UPnP / SSDP" icon={Globe}
            onClick={() => runScan('ssdp', () => electron.devicesScanSsdp())}
            loading={loading === 'ssdp'} />
          <ScanBtn label="mDNS" icon={Wifi}
            onClick={() => runScan('mdns', () => electron.devicesScanMdns())}
            loading={loading === 'mdns'} />
          <ScanBtn label="NetBIOS" icon={Server}
            onClick={() => runScan('nb', () => electron.devicesScanNetbios())}
            loading={loading === 'nb'} />
          <div className="flex-1" />
          <button type="button" onClick={handleExport} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-rmpg-400 hover:text-rmpg-200 transition-colors" aria-label="Export log">
            <Download size={10} className="mr-0.5" />Export
          </button>
          <button type="button" onClick={handleClear} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-500 hover:text-red-300 transition-colors" aria-label="Clear log">
            <Trash2 size={10} className="mr-0.5" />Clear
          </button>
        </div>

        {/* Status bar */}
        {(statusMsg || latestEntry) && (
          <div className="px-4 pb-1.5 flex items-center gap-3 text-[10px]">
            {statusMsg && <span className="text-blue-300">{statusMsg}</span>}
            {latestEntry && !statusMsg && (
              <>
                <span className="text-rmpg-500">Last scan: {new Date(latestEntry.timestamp).toLocaleTimeString()}</span>
                <span className="text-rmpg-300">{latestDevices.length} devices</span>
                {newCount > 0 && <span className="text-red-400 font-semibold">{newCount} NEW</span>}
                {latestEntry.localIp && <span className="text-rmpg-600 font-mono">{latestEntry.localIp}</span>}
                <span className="text-rmpg-700 text-[9px]">{latestEntry.method}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Signal tabs */}
      <div className="flex-shrink-0 flex border-b border-rmpg-700/50 bg-surface-raised/10 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          const count = tabCount(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-500 text-blue-300 bg-blue-900/10'
                  : 'border-transparent text-rmpg-400 hover:text-rmpg-200 hover:bg-surface-raised/20'
              }`}
            >
              <Icon size={10} />
              {t.label}
              {count !== null && (
                <span className={`px-1 py-px text-[9px] rounded-full ${tab === t.id ? 'bg-blue-600/40 text-blue-200' : 'bg-rmpg-800/60 text-rmpg-400'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {!isElectron && (
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-amber-900/20 border border-amber-700/30 text-amber-300 text-[11px] mb-4">
            <Zap size={12} />
            Radar360 requires the RMPG Flex desktop app. Passive RF capture is not available in the browser.
          </div>
        )}

        {!latestEntry && tab !== 'history' && isElectron && (
          <div className="flex flex-col items-center justify-center py-16 text-rmpg-500">
            <Antenna size={36} className="mb-3 opacity-30" />
            <p className="text-[12px] font-medium text-rmpg-400 mb-1">No scan data yet</p>
            <p className="text-[10px]">
              Run <span className="text-blue-400 font-medium">Full Sweep</span> to capture all surrounding devices across all signal types simultaneously
            </p>
          </div>
        )}

        {latestEntry && tab !== 'history' && (
          <>
            {tab === 'overview'  && <OverviewTable  devices={latestDevices} />}
            {tab === 'network'   && <NetworkTable   devices={latestDevices} />}
            {tab === 'bluetooth' && <BluetoothTable  devices={latestDevices} />}
            {tab === 'ssdp'      && <SsdpTable      devices={latestDevices} />}
            {tab === 'mdns'      && <MdnsTable      devices={latestDevices} />}
            {tab === 'netbios'   && <NetbiosTable   devices={latestDevices} />}
          </>
        )}

        {tab === 'history' && <HistoryTable log={log} onDelete={handleDelete} />}
      </div>
    </div>
  );
}
