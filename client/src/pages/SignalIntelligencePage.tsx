// Signal Intelligence — Radar360 RF signal detection browser.
// Database screen for browsing, searching, and viewing RF signal records
// captured by the Radar360 scanner system (WiFi APs, BT Classic, BLE, Cell towers).
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wifi, Bluetooth, Zap, Signal, Radio, Search, Filter,
  ChevronDown, ChevronRight, X, RefreshCw, Clock,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { parseTimestamp, safeDateTimeStr } from '../utils/dateUtils';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';

// ── Types ────────────────────────────────────────────────────────────────────

export type SignalType = 'wifi_ap' | 'bt_classic' | 'ble' | 'cell_tower';

export interface SignalDetection {
  id: number;
  scan_session_id: string;
  signal_type: SignalType;
  identifier: string;
  display_name: string | null;
  rssi_dbm: number | null;
  signal_pct: number | null;
  tx_power_dbm: number | null;
  distance_estimate_m: number | null;
  scanner_lat: number | null;
  scanner_lng: number | null;
  scanner_device_id: string | null;
  call_id: number | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  ssid: string | null;
  bssid: string | null;
  channel: number | null;
  frequency_mhz: number | null;
  band: string | null;
  security_type: string | null;
  cipher_suite: string | null;
  vendor: string | null;
  radio_type: string | null;
  bt_name: string | null;
  bt_mac: string | null;
  bt_device_category: string | null;
  bt_vendor: string | null;
  ble_complete_local_name: string | null;
  ble_manufacturer_name: string | null;
  ble_service_uuids: string | null;
  cell_carrier_name: string | null;
  cell_technology: string | null;
  cell_cell_id: number | null;
  properties: Record<string, unknown>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SIGNAL_TYPES: { key: SignalType; label: string; icon: React.ElementType }[] = [
  { key: 'wifi_ap', label: 'WiFi', icon: Wifi },
  { key: 'bt_classic', label: 'BT Classic', icon: Bluetooth },
  { key: 'ble', label: 'BLE', icon: Zap },
  { key: 'cell_tower', label: 'Cell Tower', icon: Signal },
];

const TIME_RANGES = [
  { key: '1h', label: 'Last Hour' },
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7d' },
  { key: 'all', label: 'All' },
] as const;

type TimeRangeKey = typeof TIME_RANGES[number]['key'];

const SORT_OPTIONS = [
  { key: 'signal', label: 'Strongest Signal' },
  { key: 'distance', label: 'Closest' },
  { key: 'recent', label: 'Most Recent' },
  { key: 'type', label: 'Type' },
] as const;

type SortKey = typeof SORT_OPTIONS[number]['key'];

const PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDist(m: number | null): string {
  if (m == null) return '—';
  if (m < 10) return `~${Math.round(m)} m`;
  if (m < 100) return `${Math.round(m / 5) * 5} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function proximityTier(m: number | null): { label: string; cssVar: string } {
  if (m == null) return { label: 'Unknown', cssVar: 'var(--text-muted)' };
  if (m < 5) return { label: 'Immediate', cssVar: 'var(--sev-critical)' };
  if (m < 20) return { label: 'Close', cssVar: 'var(--sev-high)' };
  if (m < 60) return { label: 'Near', cssVar: 'var(--sev-warn)' };
  if (m < 200) return { label: 'Moderate', cssVar: 'var(--sev-ok)' };
  return { label: 'Distant', cssVar: 'var(--text-muted)' };
}

function signalBars(rssi: number | null): number {
  if (rssi == null) return 0;
  if (rssi >= -50) return 5;
  if (rssi >= -60) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -80) return 2;
  return 1;
}

function signalLabel(bars: number): string {
  switch (bars) {
    case 5: return 'Excellent';
    case 4: return 'Good';
    case 3: return 'Fair';
    case 2: return 'Weak';
    case 1: return 'Very Weak';
    default: return 'N/A';
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - parseTimestamp(iso).getTime();
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function signalName(s: SignalDetection): string {
  return s.display_name || s.ssid || s.bt_name || s.ble_complete_local_name || s.identifier;
}

function signalVendor(s: SignalDetection): string {
  return s.vendor || s.bt_vendor || s.ble_manufacturer_name || s.cell_carrier_name || '—';
}

function signalDetail(s: SignalDetection): string {
  if (s.signal_type === 'wifi_ap') {
    const parts: string[] = [];
    if (s.channel != null) parts.push(`Ch ${s.channel}`);
    if (s.frequency_mhz != null) parts.push(`${s.frequency_mhz} MHz`);
    if (s.band) parts.push(s.band);
    return parts.join(' / ') || '—';
  }
  if (s.signal_type === 'cell_tower') return s.cell_technology || '—';
  if (s.signal_type === 'bt_classic') return s.bt_device_category || '—';
  if (s.signal_type === 'ble') return s.ble_manufacturer_name || '—';
  return '—';
}

function typeIcon(type: SignalType): React.ElementType {
  switch (type) {
    case 'wifi_ap': return Wifi;
    case 'bt_classic': return Bluetooth;
    case 'ble': return Zap;
    case 'cell_tower': return Signal;
  }
}

function typeLabel(type: SignalType): string {
  switch (type) {
    case 'wifi_ap': return 'WiFi AP';
    case 'bt_classic': return 'BT Classic';
    case 'ble': return 'BLE';
    case 'cell_tower': return 'Cell Tower';
  }
}

function sortSignals(signals: SignalDetection[], key: SortKey): SignalDetection[] {
  const sorted = [...signals];
  switch (key) {
    case 'signal':
      return sorted.sort((a, b) => (b.rssi_dbm ?? -999) - (a.rssi_dbm ?? -999));
    case 'distance':
      return sorted.sort((a, b) => (a.distance_estimate_m ?? 99999) - (b.distance_estimate_m ?? 99999));
    case 'recent':
      return sorted.sort((a, b) => parseTimestamp(b.last_seen_at).getTime() - parseTimestamp(a.last_seen_at).getTime());
    case 'type':
      return sorted.sort((a, b) => a.signal_type.localeCompare(b.signal_type));
    default:
      return sorted;
  }
}

// ── Signal Bars Component ────────────────────────────────────────────────────

function SignalBars({ rssi, distance }: { rssi: number | null; distance: number | null }) {
  const bars = signalBars(rssi);
  const { cssVar } = proximityTier(distance);
  return (
    <div className="flex items-end gap-px" title={`${signalLabel(bars)} (${rssi ?? '?'} dBm)`}>
      {[1, 2, 3, 4, 5].map((level) => (
        <div
          key={level}
          className="rounded-[1px]"
          style={{
            width: 3,
            height: 4 + level * 3,
            backgroundColor: level <= bars ? cssVar : 'var(--border-default)',
            opacity: level <= bars ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

// ── Signal Type Icon ─────────────────────────────────────────────────────────

function TypeIcon({ type }: { type: SignalType }) {
  const Icon = typeIcon(type);
  const colorMap: Record<SignalType, string> = {
    wifi_ap: 'text-blue-400',
    bt_classic: 'text-indigo-400',
    ble: 'text-purple-400',
    cell_tower: 'text-green-400',
  };
  return <Icon className={`${colorMap[type]}`} style={{ width: 14, height: 14, flexShrink: 0 }} />;
}

// ── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ signal, onClose }: { signal: SignalDetection; onClose: () => void }) {
  const tier = proximityTier(signal.distance_estimate_m);

  const renderSection = (title: string, fields: [string, string | number | null | undefined][]) => {
    const populated = fields.filter(([, v]) => v != null && v !== '' && v !== undefined);
    if (populated.length === 0) return null;
    return (
      <div className="mb-3">
        <div
          className="text-[9px] font-semibold uppercase tracking-wider mb-1"
          style={{ color: 'var(--panel-header-color)' }}
        >
          {title}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {populated.map(([label, value]) => (
            <React.Fragment key={label}>
              <span
                className="text-[10px] truncate"
                style={{ color: 'var(--field-label-color)' }}
              >
                {label}
              </span>
              <span className="text-[11px] text-rmpg-100 truncate">{String(value)}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-surface-raised border-l border-rmpg-700 overflow-y-auto" style={{ width: 340 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700">
        <div className="flex items-center gap-2 min-w-0">
          <TypeIcon type={signal.signal_type} />
          <span className="text-[12px] font-semibold text-rmpg-100 truncate">
            {signalName(signal)}
          </span>
        </div>
        <IconButton aria-label="Close detail panel" onClick={onClose} className="text-fg-muted hover:text-rmpg-100">
          <X style={{ width: 14, height: 14 }} />
        </IconButton>
      </div>

      <div className="px-3 py-2 space-y-1">
        {/* Signal strength visual */}
        <div className="flex items-center gap-3 mb-2 py-1.5 px-2 bg-surface-sunken rounded-[2px]">
          <SignalBars rssi={signal.rssi_dbm} distance={signal.distance_estimate_m} />
          <div className="text-[11px] text-rmpg-200">
            {signal.rssi_dbm != null ? `${signal.rssi_dbm} dBm` : 'N/A'}
          </div>
          <div
            className="text-[10px] font-medium ml-auto"
            style={{ color: tier.cssVar }}
          >
            {tier.label}
          </div>
        </div>

        {/* Common */}
        {renderSection('Common', [
          ['Identifier', signal.identifier],
          ['Signal Type', typeLabel(signal.signal_type)],
          ['RSSI', signal.rssi_dbm != null ? `${signal.rssi_dbm} dBm` : null],
          ['Signal %', signal.signal_pct != null ? `${signal.signal_pct}%` : null],
          ['TX Power', signal.tx_power_dbm != null ? `${signal.tx_power_dbm} dBm` : null],
          ['Distance', fmtDist(signal.distance_estimate_m)],
          ['Proximity', tier.label],
          ['Scanner', signal.scanner_device_id],
          ['Location', signal.scanner_lat != null && signal.scanner_lng != null
            ? `${signal.scanner_lat.toFixed(5)}, ${signal.scanner_lng.toFixed(5)}` : null],
          ['Session', signal.scan_session_id],
          ['Call ID', signal.call_id],
          ['First Seen', signal.first_seen_at ? safeDateTimeStr(signal.first_seen_at) : null],
          ['Last Seen', signal.last_seen_at ? safeDateTimeStr(signal.last_seen_at) : null],
          ['Created', signal.created_at ? safeDateTimeStr(signal.created_at) : null],
        ])}

        {/* WiFi */}
        {signal.signal_type === 'wifi_ap' && renderSection('WiFi', [
          ['SSID', signal.ssid],
          ['BSSID', signal.bssid],
          ['Channel', signal.channel],
          ['Frequency', signal.frequency_mhz != null ? `${signal.frequency_mhz} MHz` : null],
          ['Band', signal.band],
          ['Security', signal.security_type],
          ['Cipher', signal.cipher_suite],
          ['Vendor', signal.vendor],
          ['Radio Type', signal.radio_type],
          ['Auth', signal.properties?.auth_type as string | null],
          ['WPS', signal.properties?.wps_enabled != null ? String(signal.properties.wps_enabled) : null],
          ['Hidden', signal.properties?.is_hidden != null ? String(signal.properties.is_hidden) : null],
          ['Data Rate', signal.properties?.data_rate as string | null],
        ])}

        {/* BT Classic */}
        {signal.signal_type === 'bt_classic' && renderSection('Bluetooth Classic', [
          ['Name', signal.bt_name],
          ['MAC', signal.bt_mac],
          ['Category', signal.bt_device_category],
          ['Vendor', signal.bt_vendor],
          ['Class', signal.properties?.bt_class as string | null],
          ['Subcategory', signal.properties?.bt_subcategory as string | null],
          ['Connectable', signal.properties?.connectable != null ? String(signal.properties.connectable) : null],
          ['Paired', signal.properties?.paired != null ? String(signal.properties.paired) : null],
          ['Services', signal.properties?.bt_services as string | null],
          ['Version', signal.properties?.bt_version as string | null],
        ])}

        {/* BLE */}
        {signal.signal_type === 'ble' && renderSection('BLE', [
          ['Local Name', signal.ble_complete_local_name],
          ['Manufacturer', signal.ble_manufacturer_name],
          ['Service UUIDs', signal.ble_service_uuids],
          ['MAC Type', signal.properties?.ble_mac_type as string | null],
          ['Manufacturer ID', signal.properties?.ble_manufacturer_id as string | null],
          ['Appearance', signal.properties?.ble_appearance as string | null],
          ['Connectable', signal.properties?.connectable != null ? String(signal.properties.connectable) : null],
          ['Manufacturer Data', signal.properties?.ble_manufacturer_data as string | null],
          ['Flags', signal.properties?.ble_flags as string | null],
        ])}

        {/* Cell */}
        {signal.signal_type === 'cell_tower' && renderSection('Cell Tower', [
          ['Carrier', signal.cell_carrier_name],
          ['Technology', signal.cell_technology],
          ['Cell ID', signal.cell_cell_id],
          ['MCC', signal.properties?.mcc as string | null],
          ['MNC', signal.properties?.mnc as string | null],
          ['Frequency Band', signal.properties?.frequency_band as string | null],
          ['PCI', signal.properties?.pci as string | null],
          ['LAC', signal.properties?.lac as string | null],
          ['TAC', signal.properties?.tac as string | null],
          ['RSRP', signal.properties?.rsrp as string | null],
          ['RSRQ', signal.properties?.rsrq as string | null],
          ['SINR', signal.properties?.sinr as string | null],
          ['Timing Advance', signal.properties?.timing_advance as string | null],
        ])}

        {/* Raw properties (anything not already shown) */}
        {Object.keys(signal.properties || {}).length > 0 && (
          <div className="mt-2 pt-2 border-t border-rmpg-700">
            <div
              className="text-[9px] font-semibold uppercase tracking-wider mb-1"
              style={{ color: 'var(--panel-header-color)' }}
            >
              Properties
            </div>
            <pre className="text-[9px] text-fg-secondary bg-surface-sunken p-1.5 rounded-[2px] overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(signal.properties, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SignalIntelligencePage() {
  const [signals, setSignals] = useState<SignalDetection[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Filters
  const [activeTypes, setActiveTypes] = useState<Set<SignalType>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('all');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Detail
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Pagination
  const [offset, setOffset] = useState(0);

  const fetchSignals = useCallback(async (append = false) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }
      const data = await apiFetch<{ signals: SignalDetection[]; total: number }>(
        '/radar360/signals/all'
      );
      if (append) {
        setSignals((prev) => [...prev, ...data.signals]);
      } else {
        setSignals(data.signals);
      }
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch signals');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  // Live scan (Electron only)
  const handleLiveScan = useCallback(async () => {
    if (typeof window === 'undefined' || !(window as any).electron?.rfScan) return;
    try {
      setScanning(true);
      const results = await (window as any).electron.rfScan();
      if (results) {
        await apiFetch('/radar360/signal-scan', {
          method: 'POST',
          body: JSON.stringify(results),
        });
        await fetchSignals();
      }
    } catch (err) {
      console.error('Live scan failed:', err);
    } finally {
      setScanning(false);
    }
  }, [fetchSignals]);

  // Check if Electron rfScan is available
  const hasElectronScan = typeof window !== 'undefined' && !!(window as any).electron?.rfScan;

  // Filtering + sorting
  const filtered = useMemo(() => {
    let result = signals;

    // Type filter
    if (activeTypes.size > 0) {
      result = result.filter((s) => activeTypes.has(s.signal_type));
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) =>
        (s.identifier && s.identifier.toLowerCase().includes(q)) ||
        (s.display_name && s.display_name.toLowerCase().includes(q)) ||
        (s.ssid && s.ssid.toLowerCase().includes(q)) ||
        (s.bt_name && s.bt_name.toLowerCase().includes(q)) ||
        (s.ble_complete_local_name && s.ble_complete_local_name.toLowerCase().includes(q)) ||
        (s.vendor && s.vendor.toLowerCase().includes(q)) ||
        (s.bt_vendor && s.bt_vendor.toLowerCase().includes(q)) ||
        (s.ble_manufacturer_name && s.ble_manufacturer_name.toLowerCase().includes(q)) ||
        (s.cell_carrier_name && s.cell_carrier_name.toLowerCase().includes(q))
      );
    }

    // Time range filter
    if (timeRange !== 'all') {
      const now = Date.now();
      const cutoff = timeRange === '1h' ? now - 3600_000
        : timeRange === '24h' ? now - 86400_000
        : now - 604800_000;
      result = result.filter((s) => parseTimestamp(s.last_seen_at).getTime() >= cutoff);
    }

    // Sort
    result = sortSignals(result, sortBy);

    return result;
  }, [signals, activeTypes, searchQuery, timeRange, sortBy]);

  // Page slice
  const visible = useMemo(() => filtered.slice(0, offset + PAGE_SIZE), [filtered, offset]);
  const hasMore = visible.length < filtered.length;

  // Stats
  const typeCounts = useMemo(() => {
    const counts: Record<SignalType, number> = { wifi_ap: 0, bt_classic: 0, ble: 0, cell_tower: 0 };
    for (const s of filtered) {
      counts[s.signal_type]++;
    }
    return counts;
  }, [filtered]);

  const selectedSignal = useMemo(
    () => (selectedId != null ? signals.find((s) => s.id === selectedId) ?? null : null),
    [signals, selectedId],
  );

  const toggleType = useCallback((type: SignalType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    setOffset(0);
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Title bar */}
      <PanelTitleBar title="SIGNAL INTELLIGENCE" icon={Radio}>
        {hasElectronScan && (
          <button
            type="button"
            className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium rounded-[2px] bg-brand-700 text-rmpg-100 hover:bg-brand-600 disabled:opacity-40"
            onClick={handleLiveScan}
            disabled={scanning}
          >
            {scanning ? <RefreshCw style={{ width: 12, height: 12 }} className="animate-spin" /> : <Radio style={{ width: 12, height: 12 }} />}
            {scanning ? 'Scanning...' : 'Live Scan'}
          </button>
        )}
        <IconButton
          aria-label="Refresh signals"
          onClick={() => { setOffset(0); fetchSignals(); }}
          className="text-fg-muted hover:text-rmpg-100"
        >
          <RefreshCw style={{ width: 14, height: 14 }} className={loading ? 'animate-spin' : ''} />
        </IconButton>
      </PanelTitleBar>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-surface-raised border-b border-rmpg-700">
        {/* Signal type chips */}
        <div className="flex items-center gap-1">
          {SIGNAL_TYPES.map(({ key, label, icon: SIcon }) => {
            const active = activeTypes.size === 0 || activeTypes.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleType(key)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[10px] font-medium border transition-colors ${
                  activeTypes.has(key)
                    ? 'bg-brand-700/40 border-brand-500 text-rmpg-100'
                    : activeTypes.size === 0
                      ? 'bg-surface-sunken border-rmpg-700 text-fg-secondary hover:text-rmpg-100 hover:border-rmpg-500'
                      : 'bg-surface-sunken border-rmpg-700 text-fg-muted hover:text-fg-secondary hover:border-rmpg-600'
                }`}
                style={{ opacity: active ? 1 : 0.5 }}
              >
                <SIcon style={{ width: 11, height: 11 }} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative flex items-center flex-1 min-w-[160px] max-w-[280px]">
          <Search className="absolute left-1.5 text-fg-muted" style={{ width: 12, height: 12 }} />
          <input
            type="text"
            placeholder="Search identifier, name, SSID..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setOffset(0); }}
            className="w-full pl-6 pr-2 py-0.5 text-[10px] bg-surface-sunken border border-rmpg-700 rounded-[2px] text-rmpg-100 placeholder-fg-muted focus:outline-none focus:border-brand-500"
          />
          {searchQuery && (
            <IconButton
              aria-label="Clear search"
              onClick={() => setSearchQuery('')}
              className="absolute right-1 text-fg-muted hover:text-rmpg-100"
            >
              <X style={{ width: 10, height: 10 }} />
            </IconButton>
          )}
        </div>

        {/* Time range */}
        <div className="flex items-center gap-0.5">
          <Clock className="text-fg-muted mr-0.5" style={{ width: 11, height: 11 }} />
          {TIME_RANGES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setTimeRange(key); setOffset(0); }}
              className={`px-1.5 py-0.5 text-[9px] font-medium rounded-[2px] transition-colors ${
                timeRange === key
                  ? 'bg-brand-700/40 text-rmpg-100'
                  : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-sunken'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setShowSortDropdown((v) => !v)}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-fg-secondary hover:text-rmpg-100 border border-rmpg-700 rounded-[2px] bg-surface-sunken"
          >
            <Filter style={{ width: 10, height: 10 }} />
            {SORT_OPTIONS.find((o) => o.key === sortBy)?.label}
            <ChevronDown style={{ width: 10, height: 10 }} />
          </button>
          {showSortDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSortDropdown(false)} />
              <div className="absolute right-0 top-full mt-0.5 z-20 bg-surface-raised border border-rmpg-700 rounded-[2px] shadow-lg min-w-[130px]">
                {SORT_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setSortBy(key); setShowSortDropdown(false); }}
                    className={`block w-full text-left px-2 py-1 text-[10px] hover:bg-surface-sunken ${
                      sortBy === key ? 'text-rmpg-100 font-medium' : 'text-fg-secondary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 px-3 py-1.5 border-b border-rmpg-700">
        {SIGNAL_TYPES.map(({ key, label, icon: SIcon }) => {
          const count = typeCounts[key];
          const colors: Record<SignalType, string> = {
            wifi_ap: 'text-blue-400',
            bt_classic: 'text-indigo-400',
            ble: 'text-purple-400',
            cell_tower: 'text-green-400',
          };
          return (
            <div
              key={key}
              className="flex items-center gap-2 px-2 py-1 bg-surface-raised rounded-[2px] border border-rmpg-700"
            >
              <SIcon className={colors[key]} style={{ width: 14, height: 14, flexShrink: 0 }} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-rmpg-100 leading-tight">{count}</div>
                <div className="text-[8px] text-fg-muted uppercase tracking-wide truncate">{label}{key === 'wifi_ap' ? ' APs' : key === 'ble' ? ' Beacons' : key === 'cell_tower' ? ' Towers' : ' Devices'}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading && signals.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-fg-muted text-[11px]">
              <RefreshCw className="animate-spin mr-2" style={{ width: 14, height: 14 }} />
              Loading signals...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-40 text-[11px]" style={{ color: 'var(--sev-critical)' }}>
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-fg-muted">
              <Radio style={{ width: 24, height: 24 }} className="mb-2 opacity-40" />
              <span className="text-[11px]">No signal detections found</span>
              {(activeTypes.size > 0 || searchQuery || timeRange !== 'all') && (
                <button
                  type="button"
                  onClick={() => { setActiveTypes(new Set()); setSearchQuery(''); setTimeRange('all'); setOffset(0); }}
                  className="mt-1 text-[10px] text-brand-400 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="sticky top-0 z-[1] bg-surface-sunken">
                  <tr>
                    <th className="px-2 py-[3px] text-left text-[9px] font-semibold whitespace-nowrap border-b border-rmpg-700" style={{ color: 'var(--panel-header-color)' }}>Type</th>
                    <th className="px-2 py-[3px] text-left text-[9px] font-semibold whitespace-nowrap border-b border-rmpg-700" style={{ color: 'var(--panel-header-color)' }}>Name</th>
                    <th className="px-2 py-[3px] text-left text-[9px] font-semibold whitespace-nowrap border-b border-rmpg-700" style={{ color: 'var(--panel-header-color)' }}>Signal</th>
                    <th className="px-2 py-[3px] text-left text-[9px] font-semibold whitespace-nowrap border-b border-rmpg-700" style={{ color: 'var(--panel-header-color)' }}>Distance</th>
                    <th className="px-2 py-[3px] text-left text-[9px] font-semibold whitespace-nowrap border-b border-rmpg-700" style={{ color: 'var(--panel-header-color)' }}>Vendor</th>
                    <th className="px-2 py-[3px] text-left text-[9px] font-semibold whitespace-nowrap border-b border-rmpg-700" style={{ color: 'var(--panel-header-color)' }}>Detail</th>
                    <th className="px-2 py-[3px] text-left text-[9px] font-semibold whitespace-nowrap border-b border-rmpg-700" style={{ color: 'var(--panel-header-color)' }}>Scanner</th>
                    <th className="px-2 py-[3px] text-left text-[9px] font-semibold whitespace-nowrap border-b border-rmpg-700" style={{ color: 'var(--panel-header-color)' }}>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => {
                    const isSelected = s.id === selectedId;
                    const tier = proximityTier(s.distance_estimate_m);
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedId(isSelected ? null : s.id)}
                        className={`cursor-pointer border-b border-rmpg-800 transition-colors ${
                          isSelected
                            ? 'bg-brand-800/30'
                            : 'hover:bg-surface-sunken'
                        }`}
                      >
                        <td className="px-2 py-[2px] text-[11px]">
                          <TypeIcon type={s.signal_type} />
                        </td>
                        <td className="px-2 py-[2px] text-[11px] text-rmpg-100 max-w-[180px] truncate">
                          {signalName(s)}
                        </td>
                        <td className="px-2 py-[2px] text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <SignalBars rssi={s.rssi_dbm} distance={s.distance_estimate_m} />
                            <span className="text-fg-secondary">{s.rssi_dbm != null ? `${s.rssi_dbm}` : '—'}</span>
                          </div>
                        </td>
                        <td className="px-2 py-[2px] text-[11px]" style={{ color: tier.cssVar }}>
                          {fmtDist(s.distance_estimate_m)}
                        </td>
                        <td className="px-2 py-[2px] text-[11px] text-fg-secondary max-w-[120px] truncate">
                          {signalVendor(s)}
                        </td>
                        <td className="px-2 py-[2px] text-[11px] text-fg-muted max-w-[140px] truncate">
                          {signalDetail(s)}
                        </td>
                        <td className="px-2 py-[2px] text-[11px] text-fg-muted truncate">
                          {s.scanner_device_id || '—'}
                        </td>
                        <td className="px-2 py-[2px] text-[11px] text-fg-muted whitespace-nowrap">
                          {relativeTime(s.last_seen_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Load more */}
              {hasMore && (
                <div className="flex justify-center py-2">
                  <button
                    type="button"
                    onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                    disabled={loadingMore}
                    className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium text-fg-secondary bg-surface-raised border border-rmpg-700 rounded-[2px] hover:bg-surface-sunken hover:text-rmpg-100 disabled:opacity-40"
                  >
                    {loadingMore && <RefreshCw style={{ width: 10, height: 10 }} className="animate-spin" />}
                    Load More ({filtered.length - visible.length} remaining)
                  </button>
                </div>
              )}

              {/* Count footer */}
              <div className="px-3 py-1 text-[9px] text-fg-muted border-t border-rmpg-800">
                Showing {visible.length} of {filtered.length} signals{filtered.length !== total ? ` (${total} total)` : ''}
              </div>
            </>
          )}
        </div>

        {/* Detail panel */}
        {selectedSignal && (
          <DetailPanel signal={selectedSignal} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </div>
  );
}
