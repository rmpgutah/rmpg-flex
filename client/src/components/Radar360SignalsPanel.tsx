// ============================================================
// RMPG Flex — Radar 360º Signal Intelligence Panel
// ============================================================
// Displays RF/electronic signals detected by the field device:
//   WiFi APs, Bluetooth Classic, BLE, and cell towers.
//
// 50 identifying attributes are presented per signal, organized
// into type-specific groups. Signals are fetched from the API
// (populated by the Electron rfScanner IPC on the desktop app).
//
// The polar display shows signals as concentric rings at their
// estimated distance from the scan center. Since bearing is not
// knowable from RSSI alone, signals are distributed evenly
// around each ring at their approximate radius.
// ============================================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Wifi, Bluetooth, Radio, Signal, RefreshCw, Loader2,
  ChevronDown, ChevronUp, Zap, AlertCircle, Activity,
  Database, Info,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

// ── Types ─────────────────────────────────────────────────

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
  properties: Record<string, unknown>;
  call_id: number | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface Props {
  /** Scan center (used to fetch signals from the API). */
  lat: number | null;
  lng: number | null;
  radiusMi?: number;
  callId?: number | null;
  /** Optional scan session to exclude from fetch (avoid re-showing our own submission instantly). */
  excludeSession?: string | null;
}

// ── Constants ─────────────────────────────────────────────

const SIGNAL_TYPE_CONFIG: Record<SignalType, {
  label: string;
  Icon: React.ElementType;
  color: string;
  bgColor: string;
}> = {
  wifi_ap:    { label: 'WiFi Networks', Icon: Wifi,      color: 'var(--brand-400)',   bgColor: 'rgba(var(--brand-400-rgb,59,130,246),0.12)' },
  bt_classic: { label: 'Bluetooth',     Icon: Bluetooth, color: 'var(--accent-silver-300)', bgColor: 'rgba(var(--accent-silver-300-rgb,195,204,214),0.12)' },
  ble:        { label: 'BLE',           Icon: Zap,       color: 'var(--sev-high)',    bgColor: 'rgba(var(--sev-high-rgb,234,88,12),0.10)' },
  cell_tower: { label: 'Cell Towers',   Icon: Signal,    color: 'var(--sev-ok)',      bgColor: 'rgba(var(--sev-ok-rgb,34,197,94),0.10)' },
};

/** Translate dBm to a rough quality label. */
function rssiQuality(dbm: number | null): { label: string; bars: number; color: string } {
  if (dbm == null) return { label: '—',        bars: 0, color: 'var(--text-muted)' };
  if (dbm >= -50)  return { label: 'Excellent', bars: 5, color: 'var(--sev-ok)' };
  if (dbm >= -60)  return { label: 'Good',      bars: 4, color: 'var(--sev-ok)' };
  if (dbm >= -70)  return { label: 'Fair',      bars: 3, color: 'var(--sev-warn)' };
  if (dbm >= -80)  return { label: 'Weak',      bars: 2, color: 'var(--sev-warn)' };
  return                  { label: 'Very Weak', bars: 1, color: 'var(--sev-critical)' };
}

/** 5-bar signal strength indicator */
function SignalBars({ dbm }: { dbm: number | null }) {
  const q = rssiQuality(dbm);
  return (
    <span className="inline-flex items-end gap-px h-4" title={`${dbm ?? '?'} dBm — ${q.label}`}>
      {[1,2,3,4,5].map((n) => (
        <span
          key={n}
          style={{
            width: 3,
            height: 4 + n * 2,
            borderRadius: 1,
            background: n <= q.bars ? q.color : 'var(--surface-raised)',
            transition: 'background 0.2s',
          }}
        />
      ))}
    </span>
  );
}

// ── 50 Feature Fields by signal type ─────────────────────

interface FieldDef {
  key: string;
  label: string;
  format?: (v: unknown) => string;
  danger?: boolean;
}

const WIFI_FIELDS: FieldDef[] = [
  { key: 'ssid',                    label: 'SSID' },
  { key: 'bssid',                   label: 'BSSID (AP MAC)' },
  { key: 'channel',                 label: 'Channel' },
  { key: 'frequency_mhz',           label: 'Frequency (MHz)' },
  { key: 'band',                    label: 'Band (GHz)' },
  { key: 'security_type',           label: 'Security' },
  { key: 'cipher_suite',            label: 'Cipher Suite' },
  { key: 'auth_suite',              label: 'Auth Suite' },
  { key: 'wps_enabled',             label: 'WPS Enabled', format: v => v == null ? '—' : (v ? 'Yes' : 'No') },
  { key: 'hidden',                  label: 'Hidden Network', format: v => v ? 'Yes (probe-only)' : 'No' },
  { key: 'vendor',                  label: 'AP Vendor (OUI)' },
  { key: 'network_type',            label: 'Network Type' },
  { key: 'radio_type',              label: 'Radio Standard' },
  { key: 'max_data_rate_mbps',      label: 'Max Data Rate (Mbps)' },
  { key: 'beacon_interval_ms',      label: 'Beacon Interval (ms)' },
  { key: 'supported_rates',         label: 'Supported Rates' },
  { key: 'country_code',            label: 'Country Code' },
  { key: 'channel_utilization_pct', label: 'Channel Utilization %' },
];

const BT_FIELDS: FieldDef[] = [
  { key: 'bt_name',              label: 'Device Name' },
  { key: 'bt_mac',               label: 'MAC Address' },
  { key: 'bt_class_hex',         label: 'Device Class (hex)' },
  { key: 'bt_device_category',   label: 'Device Category' },
  { key: 'bt_device_subcategory',label: 'Device Subcategory' },
  { key: 'bt_vendor',            label: 'Vendor (OUI)' },
  { key: 'bt_connectable',       label: 'Connectable', format: v => v == null ? '—' : (v ? 'Yes' : 'No') },
  { key: 'bt_paired',            label: 'Paired', format: v => v == null ? '—' : (v ? 'Yes' : 'No') },
  { key: 'bt_services',          label: 'Services', format: v => Array.isArray(v) ? (v.length ? v.join(', ') : 'None') : String(v ?? '—') },
  { key: 'bt_version',           label: 'BT Version' },
  { key: 'bt_lmp_version',       label: 'LMP Version' },
  { key: 'bt_manufacturer_id',   label: 'Manufacturer ID' },
];

const BLE_FIELDS: FieldDef[] = [
  { key: 'ble_complete_local_name',       label: 'Local Name' },
  { key: 'ble_mac_type',                  label: 'MAC Type' },
  { key: 'ble_service_uuids',             label: 'Service UUIDs', format: v => Array.isArray(v) ? (v.length ? v.join('\n') : 'None') : String(v ?? '—') },
  { key: 'ble_manufacturer_id',           label: 'Manufacturer ID', format: v => v != null ? `0x${Number(v).toString(16).toUpperCase().padStart(4,'0')}` : '—' },
  { key: 'ble_manufacturer_name',         label: 'Manufacturer' },
  { key: 'ble_appearance_category',       label: 'Appearance' },
  { key: 'ble_advertisement_interval_ms', label: 'Adv. Interval (ms)' },
  { key: 'ble_connectable',               label: 'Connectable', format: v => v == null ? '—' : (v ? 'Yes' : 'No') },
  { key: 'ble_manufacturer_data_hex',     label: 'Manufacturer Data (hex)' },
  { key: 'ble_service_data',              label: 'Service Data', format: v => v ? JSON.stringify(v) : '—' },
  { key: 'ble_flags',                     label: 'AD Flags', format: v => v != null ? `0x${Number(v).toString(16).toUpperCase()}` : '—' },
  { key: 'bt_vendor',                     label: 'Vendor (OUI)' },
];

const CELL_FIELDS: FieldDef[] = [
  { key: 'cell_mcc',             label: 'MCC (Country Code)' },
  { key: 'cell_mnc',             label: 'MNC (Network Code)' },
  { key: 'cell_carrier_name',    label: 'Carrier' },
  { key: 'cell_technology',      label: 'Technology' },
  { key: 'cell_frequency_band',  label: 'Frequency Band' },
  { key: 'cell_arfcn',           label: 'ARFCN' },
  { key: 'cell_pci',             label: 'Physical Cell ID' },
  { key: 'cell_lac',             label: 'LAC' },
  { key: 'cell_tac',             label: 'TAC' },
  { key: 'cell_cell_id',         label: 'Cell ID' },
  { key: 'cell_rsrp_dbm',        label: 'RSRP (dBm)' },
  { key: 'cell_rsrq_db',         label: 'RSRQ (dB)' },
  { key: 'cell_sinr_db',         label: 'SINR (dB)' },
  { key: 'cell_timing_advance_m',label: 'Timing Advance (m)', format: v => v != null ? `~${v} m` : '—' },
  { key: 'cell_is_serving',      label: 'Serving Cell', format: v => v ? 'Yes' : 'No' },
];

const FIELDS_BY_TYPE: Record<SignalType, FieldDef[]> = {
  wifi_ap: WIFI_FIELDS,
  bt_classic: BT_FIELDS,
  ble: BLE_FIELDS,
  cell_tower: CELL_FIELDS,
};

// Common fields shown for all signal types (always displayed above type-specific)
const COMMON_FIELDS: FieldDef[] = [
  { key: '__rssi',         label: 'Signal Strength' }, // rendered specially
  { key: '__distance',     label: 'Distance Estimate' }, // rendered specially
  { key: 'tx_power_dbm',  label: 'TX Power (dBm)' },
  { key: 'first_seen_at', label: 'First Seen' },
  { key: 'last_seen_at',  label: 'Last Seen' },
  { key: 'scanner_device_id', label: 'Detected By' },
];

// ── Sub-components ─────────────────────────────────────────

function FieldRow({ label, value, danger }: { label: string; value: unknown; danger?: boolean }) {
  const str = value == null ? '—' : String(value);
  const empty = str === '—' || str === '' || str === 'null' || str === 'undefined';
  if (empty) return null; // hide blank rows to keep the panel tight
  return (
    <div className="grid grid-cols-[120px_1fr] gap-1 py-[2px] border-b border-[var(--surface-raised)] last:border-0">
      <span className="text-[9px] font-medium truncate" style={{ color: 'var(--field-label-color)' }}>{label}</span>
      <span
        className="text-[10px] break-all font-mono"
        style={{ color: danger ? 'var(--sev-critical)' : 'var(--text-primary)' }}
      >{str}</span>
    </div>
  );
}

/** Format a distance in metres to a human-readable string. */
function fmtDist(m: number | null): string {
  if (m == null) return '—';
  if (m < 10)    return `~${Math.round(m)} m`;
  if (m < 100)   return `${Math.round(m / 5) * 5} m`;
  if (m < 1000)  return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/** Translate metres to feet. */
function metresToFt(m: number): number {
  return Math.round(m * 3.281);
}

/** Proximity tier: how close is the device? */
function proximityTier(m: number | null): { label: string; color: string } {
  if (m == null)   return { label: 'Unknown range',  color: 'var(--text-muted)' };
  if (m < 5)       return { label: 'Immediate (<5m)', color: 'var(--sev-critical)' };
  if (m < 20)      return { label: 'Close (<20m)',    color: 'var(--sev-high)' };
  if (m < 60)      return { label: 'Near (<60m)',     color: 'var(--sev-warn)' };
  if (m < 200)     return { label: 'Moderate',        color: 'var(--sev-ok)' };
  return              { label: 'Distant',             color: 'var(--text-muted)' };
}

/** Distance arc bar — shows how close 0..maxM the device is (wider = closer). */
function DistanceArc({ distM, maxM = 200, color }: { distM: number | null; maxM?: number; color: string }) {
  const frac = distM != null ? Math.max(0, 1 - distM / maxM) : 0;
  return (
    <div className="flex items-center gap-1 w-full">
      <div className="flex-1 h-[4px] rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
        <div
          style={{
            width: `${frac * 100}%`,
            height: '100%',
            background: color,
            borderRadius: 999,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

function SignalCard({ sig, expanded, onToggle }: { sig: SignalDetection; expanded: boolean; onToggle: () => void }) {
  const cfg = SIGNAL_TYPE_CONFIG[sig.signal_type];
  const q = rssiQuality(sig.rssi_dbm);
  const prox = proximityTier(sig.distance_estimate_m);
  const typeFields = FIELDS_BY_TYPE[sig.signal_type] ?? [];

  return (
    <div
      className="rounded-[2px] mb-1 overflow-hidden"
      style={{ background: 'var(--surface-raised)', border: `1px solid ${sig.distance_estimate_m != null && sig.distance_estimate_m < 20 ? prox.color : 'var(--surface-sunken)'}` }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex flex-col px-2 pt-1.5 pb-1 text-left hover:bg-[var(--surface-sunken)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <cfg.Icon size={12} style={{ color: cfg.color, flexShrink: 0 }} />
          <span className="text-[11px] font-semibold flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
            {sig.display_name ?? sig.identifier}
          </span>
          {/* Prominent distance badge */}
          <span
            className="text-[11px] font-bold font-mono px-1 rounded-[2px]"
            style={{
              color: prox.color,
              background: `color-mix(in srgb, ${prox.color} 12%, transparent)`,
            }}
            title={sig.distance_estimate_m != null ? `${metresToFt(sig.distance_estimate_m)} ft` : 'Distance unknown'}
          >
            {fmtDist(sig.distance_estimate_m)}
          </span>
          {expanded ? <ChevronUp size={10} style={{ color: 'var(--text-muted)', flexShrink:0 }} />
                    : <ChevronDown size={10} style={{ color: 'var(--text-muted)', flexShrink:0 }} />}
        </div>
        {/* Proximity bar + tier label */}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[8px] font-medium" style={{ color: prox.color }}>{prox.label}</span>
          <DistanceArc distM={sig.distance_estimate_m} color={prox.color} />
          <SignalBars dbm={sig.rssi_dbm} />
          <span className="text-[9px]" style={{ color: q.color }}>{sig.rssi_dbm != null ? `${sig.rssi_dbm} dBm` : '—'}</span>
        </div>
      </button>

      {/* Expanded detail — 50 feature fields */}
      {expanded && (
        <div className="px-2 pb-2 pt-1" style={{ borderTop: '1px solid var(--surface-sunken)' }}>
          {/* Common fields */}
          <div className="mb-1 grid grid-cols-[120px_1fr] gap-1 py-[2px]">
            <span className="text-[9px] font-medium" style={{ color: 'var(--field-label-color)' }}>Signal Strength</span>
            <span className="flex items-center gap-1">
              <SignalBars dbm={sig.rssi_dbm} />
              <span className="text-[10px] font-mono" style={{ color: q.color }}>
                {sig.rssi_dbm != null ? `${sig.rssi_dbm} dBm` : '—'}
                {sig.signal_pct != null ? ` (${sig.signal_pct}%)` : ''}
                {' — '}{q.label}
              </span>
            </span>
          </div>
          {/* Distance with both metric + imperial */}
          <div className="mb-1 grid grid-cols-[120px_1fr] gap-1 py-[2px]">
            <span className="text-[9px] font-medium" style={{ color: 'var(--field-label-color)' }}>Distance</span>
            <span className="text-[10px] font-mono font-bold" style={{ color: prox.color }}>
              {fmtDist(sig.distance_estimate_m)}
              {sig.distance_estimate_m != null && (
                <span className="font-normal text-[9px] ml-1" style={{ color: 'var(--text-muted)' }}>
                  ({metresToFt(sig.distance_estimate_m)} ft) — {prox.label}
                </span>
              )}
            </span>
          </div>
          <div className="mb-2">
            <DistanceArc distM={sig.distance_estimate_m} color={prox.color} />
          </div>
          <FieldRow label="TX Power (dBm)" value={sig.tx_power_dbm} />
          <FieldRow label="Identifier" value={sig.identifier} />
          <FieldRow label="Detected By" value={sig.scanner_device_id} />
          <FieldRow label="First Seen" value={sig.first_seen_at ? new Date(sig.first_seen_at).toLocaleTimeString() : null} /> {/* new-date-ok: ISO-8601 with Z suffix */}
          <FieldRow label="Last Seen"  value={sig.last_seen_at  ? new Date(sig.last_seen_at).toLocaleTimeString()  : null} /> {/* new-date-ok: ISO-8601 with Z suffix */}

          {/* Type-specific fields (up to 50 total incl. common) */}
          <div className="mt-1 pt-1" style={{ borderTop: '1px solid var(--surface-sunken)' }}>
            <div className="text-[9px] mb-1 font-semibold uppercase tracking-wider" style={{ color: 'var(--field-label-color)' }}>
              {cfg.label} Details
            </div>
            {typeFields.map((f) => {
              const raw = sig.properties?.[f.key];
              const val = f.format ? f.format(raw) : (raw ?? null);
              return <FieldRow key={f.key} label={f.label} value={val} danger={f.danger} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Polar signal ring display ──────────────────────────────

function SignalRingDisplay({ signals, radiusMi }: { signals: SignalDetection[]; radiusMi: number }) {
  const cx = 110, cy = 110, maxR = 95;
  const maxDistM = radiusMi * 1609.34;

  // Nice distance ticks for the rings — pick 4 evenly-spaced values in metres
  const ringFracs = [0.25, 0.5, 0.75, 1.0];
  const ringDistM = ringFracs.map(f => Math.round(f * maxDistM));

  // Signals with known distance, sorted closest first
  const byDist = [...signals]
    .filter(s => s.distance_estimate_m != null)
    .sort((a, b) => (a.distance_estimate_m ?? 0) - (b.distance_estimate_m ?? 0));

  // Group by distance bucket (10 m resolution) to spread overlapping signals around the ring
  const grouped = new Map<number, SignalDetection[]>();
  byDist.forEach(s => {
    const bucket = Math.round((s.distance_estimate_m ?? 0) / 10) * 10;
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket)!.push(s);
  });

  return (
    <svg viewBox="0 0 220 220" className="w-full" style={{ background: 'var(--surface-sunken)', borderRadius: 2 }}>
      {/* Range rings with distance labels */}
      {ringFracs.map((frac, i) => {
        const distM = ringDistM[i];
        const r = maxR * frac;
        const label = distM < 1000 ? `${distM}m` : `${(distM / 1000).toFixed(1)}km`;
        return (
          <g key={frac}>
            <circle cx={cx} cy={cy} r={r}
              fill="none" stroke="var(--surface-raised)" strokeWidth={frac === 1 ? 0.8 : 0.5} opacity={0.7} />
            <text x={cx + 3} y={cy - r + 7} fontSize={5} fontFamily="Arial, sans-serif"
              fill="var(--text-muted)" opacity={0.6}>{label}</text>
          </g>
        );
      })}

      {/* Crosshairs */}
      <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR} stroke="var(--surface-raised)" strokeWidth={0.4} opacity={0.4} />
      <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy} stroke="var(--surface-raised)" strokeWidth={0.4} opacity={0.4} />

      {/* Scanner center */}
      <circle cx={cx} cy={cy} r={4} fill="var(--brand-400)" opacity={0.9} />
      <circle cx={cx} cy={cy} r={8} fill="none" stroke="var(--brand-400)" strokeWidth={0.8} opacity={0.4} />
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={5} fill="var(--brand-400)" opacity={0.7}>YOU</text>

      {/* Signal dots — distributed around their distance ring */}
      {[...grouped.entries()].map(([bucketM, sigs]) => {
        const distFrac = Math.min(bucketM / maxDistM, 0.97);
        const r = distFrac * maxR;
        const angleStep = (2 * Math.PI) / Math.max(sigs.length, 1);

        return sigs.map((sig, idx) => {
          const cfg = SIGNAL_TYPE_CONFIG[sig.signal_type];
          const prox = proximityTier(sig.distance_estimate_m);
          const angle = idx * angleStep + (bucketM * 0.1); // slight offset per bucket to avoid overlaps
          const x = cx + r * Math.sin(angle);
          const y = cy - r * Math.cos(angle);
          const name = (sig.display_name ?? sig.identifier).slice(0, 8);

          return (
            <g key={sig.id}>
              {/* Proximity ring for very close devices */}
              {(sig.distance_estimate_m ?? 999) < 20 && (
                <circle cx={x} cy={y} r={8} fill="none" stroke={prox.color} strokeWidth={0.8} opacity={0.35}>
                  <animate attributeName="r" values="7;11;7" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.35;0.08;0.35" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={x} cy={y} r={5} fill={cfg.color} opacity={0.9} />
              {/* Distance line from center */}
              <line x1={cx} y1={cy} x2={x} y2={y}
                stroke={cfg.color} strokeWidth={0.3} opacity={0.2} strokeDasharray="2,3" />
              {/* Device name label */}
              <text x={x} y={y - 7} textAnchor="middle" fontSize={4.5} fontFamily="Arial, sans-serif"
                fill="var(--text-primary)" opacity={0.8}>{name}</text>
              {/* Distance label */}
              <text x={x} y={y + 11} textAnchor="middle" fontSize={4.5} fontFamily="Arial, sans-serif"
                fill={prox.color} fontWeight="bold">{fmtDist(sig.distance_estimate_m)}</text>
            </g>
          );
        });
      })}

      {/* Legend — bottom left */}
      {(Object.keys(SIGNAL_TYPE_CONFIG) as SignalType[]).filter(t =>
        signals.some(s => s.signal_type === t)
      ).map((t, i) => {
        const c = SIGNAL_TYPE_CONFIG[t];
        return (
          <g key={t} transform={`translate(4,${180 + i * 9})`}>
            <circle r={2.5} cx={3} cy={3} fill={c.color} />
            <text x={8} y={6} fontSize={5} fill="var(--text-muted)">{c.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Main component ────────────────────────────────────────

type ElectronWithRfScan = { rfScan?: (opts: { lat?: number; lng?: number; deviceId?: string; callId?: number }) => Promise<{
  ok: boolean; signals?: unknown[]; scan_session_id?: string; error?: string;
  counts?: { wifi: number; bt_classic: number; ble: number; cell: number };
}> };

function getElectronApi(): ElectronWithRfScan | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electron?: ElectronWithRfScan }).electron;
}

const TYPES: SignalType[] = ['wifi_ap', 'bt_classic', 'ble', 'cell_tower'];

export default function Radar360SignalsPanel({ lat, lng, radiusMi = 1, callId, excludeSession }: Props) {
  const [signals, setSignals] = useState<SignalDetection[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<SignalType>>(new Set(TYPES));
  const [sortBy, setSortBy] = useState<'rssi' | 'distance' | 'type' | 'time'>('rssi');
  const [lastScanSession, setLastScanSession] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const electronApi = getElectronApi();
  const isElectron = !!electronApi?.rfScan;

  // ── Fetch stored signals from API ─────────────────────

  const fetchSignals = useCallback(async () => {
    if (lat == null || lng == null) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      // Always fetch all types from the API; client-side `activeTypes` filter handles display.
      // Sending only one type param (as a "shortcut") silently drops other selected types
      // because the server only accepts a single type value.
      const sessionParam = lastScanSession ? `&since_session=${encodeURIComponent(lastScanSession)}` : '';
      const data = await apiFetch<{ signals: SignalDetection[]; count: number }>(
        `/api/radar360/signals?lat=${lat}&lng=${lng}&radius_mi=${radiusMi}${sessionParam}`,
      );
      if (!ctrl.signal.aborted) {
        setSignals(data.signals ?? []);
        setError(null);
      }
    } catch (err) {
      if (!ctrl.signal.aborted) setError('Failed to load signal data');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [lat, lng, radiusMi, activeTypes, lastScanSession]);

  useEffect(() => { fetchSignals(); }, [fetchSignals]);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ── Trigger a live scan from the Electron RF scanner ──

  const triggerElectronScan = useCallback(async () => {
    if (!isElectron || lat == null || lng == null) return;
    setScanning(true);
    setError(null);
    try {
      const result = await electronApi!.rfScan!({ lat, lng, callId: callId ?? undefined });
      if (!result.ok) throw new Error(result.error ?? 'Scan failed');

      // POST the raw signals to the API
      const sessionId = result.scan_session_id!;
      await apiFetch('/api/radar360/signal-scan', {
        method: 'POST',
        body: JSON.stringify({
          scan_session_id: sessionId,
          scanned_at: new Date().toISOString(),
          scanner_lat: lat,
          scanner_lng: lng,
          call_id: callId,
          signals: result.signals ?? [],
        }),
      });
      setLastScanSession(sessionId);
      // Refresh to show new results
      await fetchSignals();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Scan failed';
      setError(msg);
    } finally {
      setScanning(false);
    }
  }, [isElectron, electronApi, lat, lng, callId, fetchSignals]);

  // ── Sorting ───────────────────────────────────────────

  const sorted = [...signals]
    .filter(s => activeTypes.has(s.signal_type))
    .sort((a, b) => {
      if (sortBy === 'rssi')     return (b.rssi_dbm ?? -120) - (a.rssi_dbm ?? -120);
      if (sortBy === 'distance') return (a.distance_estimate_m ?? 99999) - (b.distance_estimate_m ?? 99999);
      if (sortBy === 'type')     return a.signal_type.localeCompare(b.signal_type);
      return b.last_seen_at.localeCompare(a.last_seen_at);
    });

  const counts = {
    wifi_ap: signals.filter(s => s.signal_type === 'wifi_ap').length,
    bt_classic: signals.filter(s => s.signal_type === 'bt_classic').length,
    ble: signals.filter(s => s.signal_type === 'ble').length,
    cell_tower: signals.filter(s => s.signal_type === 'cell_tower').length,
  };

  const toggleType = (t: SignalType) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) { if (next.size > 1) next.delete(t); }
      else next.add(t);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2" style={{ minHeight: 0 }}>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-1">
        {TYPES.map((t) => {
          const cfg = SIGNAL_TYPE_CONFIG[t];
          const active = activeTypes.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              className="flex items-center gap-1 px-2 py-[2px] rounded-[2px] text-[9px] font-semibold transition-colors"
              style={{
                background: active ? cfg.bgColor : 'var(--surface-raised)',
                color: active ? cfg.color : 'var(--text-muted)',
                border: `1px solid ${active ? cfg.color : 'transparent'}`,
              }}
            >
              <cfg.Icon size={9} />
              {cfg.label}
              <span className="ml-0.5 opacity-70">{counts[t]}</span>
            </button>
          );
        })}
      </div>

      {/* Polar ring display */}
      {sorted.some(s => s.distance_estimate_m != null) && (
        <SignalRingDisplay signals={sorted} radiusMi={radiusMi} />
      )}

      {/* Sort + scan controls */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-medium" style={{ color: 'var(--field-label-color)' }}>Sort:</span>
        {(['rssi','distance','type','time'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSortBy(s)}
            className="text-[9px] px-1 rounded-[2px] transition-colors"
            style={{
              background: sortBy === s ? 'var(--brand-400)' : 'var(--surface-raised)',
              color: sortBy === s ? '#fff' : 'var(--text-muted)',
            }}
          >
            {s === 'rssi' ? 'Signal' : s === 'distance' ? 'Distance' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div className="flex-1" />
        {/* Refresh stored results */}
        <button
          type="button"
          onClick={fetchSignals}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-[2px] rounded-[2px] text-[9px] transition-colors"
          style={{ background: 'var(--surface-raised)', color: 'var(--text-muted)' }}
          title="Refresh stored signals"
        >
          {loading ? <Loader2 size={9} className="animate-spin" /> : <Database size={9} />}
          Refresh
        </button>
        {/* Live scan (Electron only) */}
        {isElectron && (
          <button
            type="button"
            onClick={triggerElectronScan}
            disabled={scanning || lat == null}
            className="flex items-center gap-1 px-2 py-[2px] rounded-[2px] text-[9px] font-semibold transition-colors"
            style={{
              background: scanning ? 'var(--surface-raised)' : 'var(--brand-400)',
              color: scanning ? 'var(--text-muted)' : '#fff',
            }}
            title="Run live WiFi + Bluetooth scan from this device"
          >
            {scanning ? <Loader2 size={9} className="animate-spin" /> : <Activity size={9} />}
            {scanning ? 'Scanning…' : 'Live Scan'}
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-2 py-1 rounded-[2px] text-[10px]"
          style={{ background: 'rgba(var(--sev-critical-rgb,239,68,68),0.12)', color: 'var(--sev-critical)' }}>
          <AlertCircle size={10} />
          {error}
        </div>
      )}

      {/* Signal cards */}
      <div className="overflow-y-auto flex-1" style={{ maxHeight: 420, minHeight: 80 }}>
        {sorted.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <Radio size={20} style={{ color: 'var(--text-muted)' }} />
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {lat == null
                ? 'No scan center — right-click the map to set a position'
                : isElectron
                  ? 'No signals in range. Press Live Scan to detect nearby WiFi and Bluetooth devices.'
                  : 'No signals stored near this location in the last 24 h.'}
            </span>
            {lat != null && !isElectron && (
              <div className="flex items-start gap-1 mt-1 text-[9px] max-w-[220px]" style={{ color: 'var(--text-muted)' }}>
                <Info size={9} style={{ flexShrink: 0, marginTop: 1 }} />
                Live scanning is available in the Electron desktop app. Mobile clients can submit signal data via the field camera.
              </div>
            )}
          </div>
        )}

        {sorted.map((sig) => (
          <SignalCard
            key={sig.id}
            sig={sig}
            expanded={expandedId === sig.id}
            onToggle={() => setExpandedId(expandedId === sig.id ? null : sig.id)}
          />
        ))}
      </div>

      {/* Summary footer */}
      {sorted.length > 0 && (
        <div className="text-[9px] pt-1 border-t border-[var(--surface-raised)]" style={{ color: 'var(--text-muted)' }}>
          {sorted.length} signal{sorted.length !== 1 ? 's' : ''} detected
          {counts.wifi_ap > 0 && ` · ${counts.wifi_ap} WiFi AP${counts.wifi_ap !== 1 ? 's' : ''}`}
          {counts.bt_classic > 0 && ` · ${counts.bt_classic} BT`}
          {counts.ble > 0 && ` · ${counts.ble} BLE`}
          {counts.cell_tower > 0 && ` · ${counts.cell_tower} cell`}
          {' · last 24 h within '}{radiusMi} mi
        </div>
      )}
    </div>
  );
}
