// ALPR capture gallery — image-first grid of recent vehicle_capture_photos
// packages with honest TrustBadge (server-derived trust_score/read_count/
// trust_basis) rather than raw model-confidence %. Images served auth-gated
// via authedImageUrl(). Filter bar: source / trust band / plate text.
import { useEffect, useMemo, useState } from 'react';
import { ScanSearch, RefreshCw, AlertTriangle } from 'lucide-react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import TrustBadge from './TrustBadge';
import {
  sourceLabel, detectionBoxes,
  type CaptureSource, type ConfidenceBand,
} from '../utils/alprOverlay';

const GOLD = '#d4a017';

/** Shape of a row from GET /alpr/packages (vehicle_capture_photos). */
interface PackageRow {
  id: number;
  capture_id: number | null;
  vehicle_record_id: number | null;
  canonical_plate: string | null;
  trust_score: number | null;
  trust_basis: string | null;
  read_count: number | null;
  consensus_ratio: number | null;
  full_r2_key: string | null;
  vehicle_r2_key: string | null;
  plate_r2_key: string | null;
  vehicle_bbox_json: string | null;
  plate_bbox_json: string | null;
  source_type: string | null;
  asserted: number | null;
  created_at: string | null;
  created_by: number | null;
  [k: string]: unknown;
}

/** Filter state for the gallery. */
interface PackageFilter {
  source: CaptureSource | 'all';
  band: ConfidenceBand | 'all';
  plate: string;
}

function packageSource(row: PackageRow): CaptureSource {
  const s = (row.source_type || '').toLowerCase();
  if (s === 'dashcam' || s === 'field' || s === 'manual') return s;
  return 'manual';
}

function packageBand(row: PackageRow): ConfidenceBand {
  if (row.asserted === 1) return 'high';
  return (row.trust_score ?? 0) >= 0.85 ? 'high' : 'low';
}

function packageImageUrl(row: PackageRow): string | null {
  const key = row.full_r2_key;
  if (!key) return null;
  if (key.startsWith('field-photos/')) return `/api/field-photos/file/${key}`;
  return `/api/alpr/image/${key}`;
}

function packageMatches(row: PackageRow, f: PackageFilter): boolean {
  if (f.source !== 'all' && packageSource(row) !== f.source) return false;
  if (f.band !== 'all' && packageBand(row) !== f.band) return false;
  if (f.plate) {
    const needle = f.plate.toUpperCase().replace(/[\s-]/g, '');
    if (!(row.canonical_plate || '').toUpperCase().replace(/[\s-]/g, '').includes(needle)) return false;
  }
  return true;
}

/** One capture tile: full-frame image + overlay boxes + meta footer. */
function PackageTile({ row, onPlate }: { row: PackageRow; onPlate?: (p: string) => void }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const src = packageImageUrl(row);
  const band = packageBand(row);
  const source = packageSource(row);
  const boxColor = band === 'high' ? GOLD : '#9ca3af';

  // Parse bboxes (crops are deferred, vehicle_bbox_json / plate_bbox_json may exist)
  const rawBoxes = useMemo(() => {
    const parsed: unknown[] = [];
    try { if (row.vehicle_bbox_json) parsed.push(JSON.parse(row.vehicle_bbox_json as string)); } catch { /* */ }
    try { if (row.plate_bbox_json) parsed.push(JSON.parse(row.plate_bbox_json as string)); } catch { /* */ }
    return parsed;
  }, [row.vehicle_bbox_json, row.plate_bbox_json]);
  const boxes = useMemo(() => detectionBoxes(rawBoxes, nat?.w, nat?.h), [rawBoxes, nat]);

  const trust = {
    trustScore: row.trust_score ?? 0,
    readCount: row.read_count ?? 1,
    basis: row.trust_basis ?? 'no basis',
  };

  return (
    <div className="border border-[#232323] bg-[#0b0b0b] hover:border-[#3a3a3a] transition-colors">
      <button
        type="button"
        onClick={() => row.canonical_plate && onPlate?.(row.canonical_plate)}
        className="relative w-full block aspect-[4/3] bg-black overflow-hidden"
        title={row.canonical_plate || 'capture'}>
        {src ? (
          <img
            src={authedImageUrl(src)} alt={row.canonical_plate || 'ALPR capture'}
            loading="lazy"
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#444]">
            <ScanSearch className="w-8 h-8" />
          </div>
        )}

        {/* Detection boxes drawn as a fractional SVG overlay. */}
        {boxes.length > 0 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
            {boxes.map((b, i) => (
              <rect key={i} x={b.left * 100} y={b.top * 100} width={b.width * 100} height={b.height * 100}
                fill="none" stroke={boxColor} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}

        {/* Top badge: source. */}
        <div className="absolute top-1 left-1 flex items-center gap-1">
          <span className="text-[8px] font-bold tracking-wider px-1 py-[1px] bg-black/75 text-[#bbb] border border-[#333]">
            {sourceLabel(source)}
          </span>
        </div>

        {/* Bottom: canonical plate + honest TrustBadge (replaces raw model %). */}
        <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/90 to-transparent">
          <div className="flex items-end justify-between gap-1">
            <span
              className="text-base leading-none tracking-[0.18em] font-semibold"
              style={{ color: band === 'high' ? '#fff' : '#cbd5e1' }}>
              {row.canonical_plate || '—'}
            </span>
            <TrustBadge trust={trust} />
          </div>
        </div>
      </button>
      <div className="px-1.5 py-1 text-[9px] text-[#777] flex items-center justify-between gap-1">
        <span className="truncate">{trust.basis}</span>
        <span className="shrink-0">{row.created_at ? new Date(row.created_at.replace(' ', 'T') + 'Z').toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
    </div>
  );
}

const SOURCE_TABS: Array<{ key: CaptureSource | 'all'; label: string }> = [
  { key: 'all', label: 'ALL' }, { key: 'dashcam', label: 'DASHCAM' },
  { key: 'field', label: 'FIELD' }, { key: 'manual', label: 'MANUAL' },
];
const BAND_TABS: Array<{ key: ConfidenceBand | 'all'; label: string }> = [
  { key: 'all', label: 'ANY' }, { key: 'high', label: 'VERIFIED' }, { key: 'low', label: 'REVIEW' },
];

export default function AlprCaptureGallery({ onPlate }: { onPlate?: (plate: string) => void }) {
  const [rows, setRows] = useState<PackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<PackageFilter>({ source: 'all', band: 'all', plate: '' });

  const load = () => {
    setLoading(true); setErr(null);
    apiFetch<{ packages: PackageRow[] }>('/alpr/packages')
      .then((r) => setRows(Array.isArray(r?.packages) ? r.packages : []))
      .catch((e) => setErr(e?.message || 'Failed to load packages'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const shown = useMemo(() => rows.filter((r) => packageMatches(r, filter)), [rows, filter]);
  const activeFilters = filter.plate || filter.source !== 'all' || filter.band !== 'all';

  return (
    <div className="space-y-2">
      {/* Filter bar */}
      <div className="border border-[#232323] bg-[#0b0b0b] p-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-[#d4a017] tracking-wider">CAPTURE GALLERY</span>
          <button onClick={load} className="text-[9px] text-[#888] hover:text-white flex items-center gap-1">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {shown.length}/{rows.length}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {SOURCE_TABS.map((t) => (
            <button key={t.key} onClick={() => setFilter((f) => ({ ...f, source: t.key }))}
              className={`text-[9px] px-2 py-1 border ${filter.source === t.key ? 'border-[#d4a017] text-[#d4a017] bg-[#1a1400]' : 'border-[#2a2a2a] text-[#888]'}`}>
              {t.label}
            </button>
          ))}
          <span className="w-px h-4 bg-[#2a2a2a] mx-0.5" />
          {BAND_TABS.map((t) => (
            <button key={t.key} onClick={() => setFilter((f) => ({ ...f, band: t.key }))}
              className={`text-[9px] px-2 py-1 border ${filter.band === t.key ? 'border-[#d4a017] text-[#d4a017] bg-[#1a1400]' : 'border-[#2a2a2a] text-[#888]'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <input
            value={filter.plate} onChange={(e) => setFilter((f) => ({ ...f, plate: e.target.value }))}
            placeholder="Plate…"
            className="text-[10px] bg-black border border-[#2a2a2a] text-[#ccc] px-2 py-1 w-24 focus:border-[#d4a017] focus:outline-none font-mono uppercase" />
          {activeFilters && (
            <button onClick={() => setFilter({ source: 'all', band: 'all', plate: '' })}
              className="text-[9px] px-2 py-1 border border-[#2a2a2a] text-[#888] hover:text-white">CLEAR</button>
          )}
        </div>
      </div>

      {err && <div className="border border-red-600 text-red-300 text-[11px] px-3 py-2 bg-red-950/40">{err}</div>}
      {!loading && !err && shown.length === 0 && (
        <div className="border border-[#232323] text-[11px] text-[#888] px-3 py-6 text-center">
          {rows.length === 0
            ? 'No captures yet. Dashcam reads appear here once media sync runs; field/manual scans land here too.'
            : 'No captures match the current filters.'}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {shown.map((row) => <PackageTile key={row.id} row={row} onPlate={onPlate} />)}
      </div>
    </div>
  );
}
