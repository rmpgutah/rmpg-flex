// ============================================================
// RMPG Flex — Live GPS HUD
// ============================================================
// A compact on-map readout of the operator's OWN device fix: heading (compass
// cardinal + rotating needle), ground speed, horizontal accuracy, and fix
// source (GPS / WiFi / IP). Doubles as the capture/export surface for the
// session track recorded by useGpsTracking({ capture: true }).
//
// Purely presentational — all GPS math/state lives in useGpsTracking; this just
// renders it and calls the export helpers. The directional needle uses the
// SMOOTHED heading so it glides instead of snapping between noisy fixes.
// ============================================================

import { Navigation2, Satellite, Wifi, Globe, Download, Trash2, X, Crosshair } from 'lucide-react';
import { compassCardinal } from '../../../utils/locationImagery';

interface GpsHudData {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  headingSmoothed: number | null;
  heading: number | null;
  course: number | null;
  speed: number | null;
  positionSource: string;
  capturedCount: number;
}

interface Props {
  gps: GpsHudData;
  onExport: (format: 'csv' | 'geojson') => void;
  onClear: () => void;
  onClose: () => void;
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { icon: typeof Satellite; color: string; label: string }> = {
    gps: { icon: Satellite, color: '#22c55e', label: 'GPS' },
    wifi: { icon: Wifi, color: '#d4a017', label: 'WiFi' },
    ip: { icon: Globe, color: '#ef4444', label: 'IP' },
    unknown: { icon: Globe, color: '#666', label: '—' },
  };
  const s = map[source] || map.unknown;
  const Icon = s.icon;
  return (
    <span className="flex items-center gap-1" style={{ color: s.color }}>
      <Icon className="w-3 h-3" /> <span className="text-[9px] font-bold uppercase">{s.label}</span>
    </span>
  );
}

export default function GpsHud({ gps, onExport, onClear, onClose }: Props) {
  // Prefer smoothed heading, then course-over-ground, then raw device heading.
  const dir = gps.headingSmoothed ?? gps.course ?? gps.heading;
  const mph = gps.speed != null ? Math.round(gps.speed * 2.237) : null;
  const hasFix = gps.latitude != null && gps.longitude != null;

  return (
    <div
      className="panel-beveled bg-surface-deep/95 border border-rmpg-600 shadow-xl backdrop-blur-md"
      style={{ borderRadius: 2, width: 188 }}
      role="region"
      aria-label="Live GPS"
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-rmpg-700">
        <Crosshair className="w-3 h-3 text-brand-400" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-rmpg-300 flex-1">My GPS</span>
        <SourceBadge source={gps.positionSource} />
        <button onClick={onClose} className="toolbar-btn" title="Hide GPS HUD" aria-label="Hide GPS HUD" style={{ padding: '0 1px' }}>
          <X className="w-3 h-3" />
        </button>
      </div>

      {!hasFix ? (
        <div className="px-2 py-2 text-[10px] text-rmpg-500">Acquiring fix…</div>
      ) : (
        <div className="p-2 flex items-center gap-2">
          {/* Directional needle */}
          <div className="relative shrink-0" style={{ width: 44, height: 44 }} title="Heading">
            <div className="absolute inset-0 rounded-full border border-rmpg-600" />
            <Navigation2
              className="absolute inset-0 m-auto w-5 h-5 text-brand-400"
              style={{ transform: `rotate(${dir ?? 0}deg)`, transition: 'transform 0.3s ease-out' }}
              fill={dir != null ? '#d4a017' : 'none'}
            />
            <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[7px] font-bold text-rmpg-400">
              {dir != null ? compassCardinal(dir) : '—'}
            </span>
          </div>
          {/* Readout */}
          <div className="flex-1 min-w-0 font-mono text-[10px] leading-tight text-rmpg-200 space-y-0.5">
            <div><span className="text-rmpg-500">HDG </span><span className="text-brand-300 font-bold">{dir != null ? `${Math.round(dir)}°` : '—'}</span></div>
            <div><span className="text-rmpg-500">SPD </span><span className="font-bold">{mph != null ? `${mph} mph` : '—'}</span></div>
            <div><span className="text-rmpg-500">±   </span>{gps.accuracy != null ? `${Math.round(gps.accuracy)} m` : '—'}</div>
            <div className="text-[8px] text-rmpg-500 truncate">{gps.latitude!.toFixed(5)}, {gps.longitude!.toFixed(5)}</div>
          </div>
        </div>
      )}

      {/* Capture / export */}
      <div className="flex items-center gap-1 px-2 py-1 border-t border-rmpg-800">
        <span className="text-[8px] text-rmpg-500 flex-1">
          Track: <span className="text-rmpg-300 font-bold font-mono">{gps.capturedCount}</span> pts
        </span>
        <button
          onClick={() => onExport('csv')}
          disabled={gps.capturedCount === 0}
          className="flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-bold uppercase text-rmpg-300 hover:text-white hover:bg-rmpg-700/60 disabled:opacity-30 transition-colors"
          style={{ borderRadius: 2 }}
          title="Export track as CSV"
        ><Download className="w-2.5 h-2.5" />CSV</button>
        <button
          onClick={() => onExport('geojson')}
          disabled={gps.capturedCount === 0}
          className="flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-bold uppercase text-rmpg-300 hover:text-white hover:bg-rmpg-700/60 disabled:opacity-30 transition-colors"
          style={{ borderRadius: 2 }}
          title="Export track as GeoJSON"
        ><Download className="w-2.5 h-2.5" />GEO</button>
        <button
          onClick={onClear}
          disabled={gps.capturedCount === 0}
          className="px-1 py-0.5 text-rmpg-500 hover:text-red-400 disabled:opacity-30 transition-colors"
          title="Clear captured track"
          aria-label="Clear captured track"
        ><Trash2 className="w-2.5 h-2.5" /></button>
      </div>
    </div>
  );
}
