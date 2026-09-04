// ALPR capture gallery — image-first grid of recent plate captures with an
// ALPR-formatted overlay (bounding box when geometry exists, else a plate chip)
// drawn over each still, plus a visual filter bar (source / confidence / hits /
// plate / event type). Captures come from /alpr/captures?gallery=1 (dashcam +
// field-camera + manual), images served auth-gated via authedImageUrl().
// Trust fields (trust_score / trust_basis / read_count) are enriched server-side
// from the most-recent vehicle_capture_photos package so we can render an honest
// TrustBadge without losing event_type, alerted/HITS, or anything else.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScanSearch, RefreshCw, AlertTriangle, ShieldCheck, Pencil } from 'lucide-react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import { toDisplayLabel } from '../utils/formatters';
import { parseTimestamp } from '../utils/dateUtils';
import TrustBadge from './TrustBadge';
import VehicleDossier from './VehicleDossier';
import CaptureReviewEditor, { type EditableCapture } from './CaptureReviewEditor';
import {
  captureSource, sourceLabel, confidenceBand, detectionBoxes, filterCaptures, eventTypeOptions,
  type GalleryCapture, type CaptureFilter, type CaptureSource, type ConfidenceBand,
} from '../utils/alprOverlay';

/** One capture tile: image + overlay (box or plate chip) + meta footer. */
function CaptureTile({ cap, onPlate, onEdit }: { cap: GalleryCapture; onPlate?: (p: string) => void; onEdit?: (c: GalleryCapture) => void }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [imgError, setImgError] = useState(false);
  const src = cap.image_url || cap.annotated_image_url;
  // Reset the error state if the underlying image source changes.
  useEffect(() => { setImgError(false); }, [src]);
  const boxes = useMemo(() => detectionBoxes(cap.detections, nat?.w, nat?.h), [cap.detections, nat]);
  const band = confidenceBand(cap.confidence, cap.accepted);
  const source = captureSource(cap);
  const boxColor = cap.alerted ? 'var(--sev-critical)' : band === 'high' ? 'var(--accent-gold-300)' : 'var(--rmpg-400)';

  // Display plate: prefer canonical_plate (from the trust package) if available.
  const displayPlate = (cap as any).canonical_plate || cap.plate;
  const reviewStatus = (cap as any).review_status as string | null | undefined;

  const trust = {
    trustScore: (cap as any).trust_score ?? 0,
    readCount: (cap as any).read_count ?? 1,
    basis: (cap as any).trust_basis ?? '',
  };

  return (
    <div className="border border-border-default bg-surface-sunken hover:border-border-subtle transition-colors">
      <button
        type="button"
        onClick={() => displayPlate && onPlate?.(displayPlate)}
        className="relative w-full block aspect-[4/3] bg-black overflow-hidden"
        title={displayPlate || 'capture'}>
        {src && !imgError ? (
          <img
            src={authedImageUrl(src)} alt={displayPlate || 'ALPR capture'}
            loading="lazy"
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-rmpg-700">
            <ScanSearch className="w-8 h-8" />
          </div>
        )}

        {/* Detection boxes (Roboflow geometry) drawn as a fractional SVG overlay. */}
        {boxes.length > 0 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
            {boxes.map((b, i) => (
              <rect key={i} x={b.left * 100} y={b.top * 100} width={b.width * 100} height={b.height * 100}
                fill="none" stroke={boxColor} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}

        {/* Top badges: source + event type + hit. */}
        <div className="absolute top-1 left-1 flex items-center gap-1">
          <span className="text-[8px] font-bold tracking-wider px-1 py-[1px] bg-black/75 text-rmpg-300 border border-border-subtle">
            {sourceLabel(source)}
          </span>
          {cap.event_type && (
            <span className="text-[8px] px-1 py-[1px] bg-black/75 text-fg-muted border border-border-subtle">
              {toDisplayLabel(String(cap.event_type))}
            </span>
          )}
        </div>
        {cap.alerted && (
          <span className="absolute top-1 right-1 text-[8px] font-bold tracking-wider px-1 py-[1px] bg-red-950 text-red-300 border border-red-600 flex items-center gap-0.5">
            <AlertTriangle className="w-2.5 h-2.5" /> HIT
          </span>
        )}

        {/* ALPR plate chip overlay — always present (the headline read).
            Raw confidence % replaced by honest TrustBadge. */}
        <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/90 to-transparent">
          <div className="flex items-end justify-between gap-1">
            <span
              className="text-base leading-none tracking-[0.18em] font-semibold"
              style={{ color: cap.alerted ? 'var(--sev-critical-soft)' : band === 'high' ? 'var(--text-primary)' : 'var(--text-primary)' }}>
              {displayPlate || '—'}
            </span>
            <TrustBadge trust={trust} />
          </div>
        </div>
      </button>
      <div className="px-1.5 py-1 text-[9px] text-rmpg-400 flex items-center justify-between gap-1">
        <span className="truncate">{cap.state ? `${cap.state} · ` : ''}{cap.device_name || cap.location_text || '—'}</span>
        <span className="shrink-0">{cap.created_at ? parseTimestamp(cap.created_at).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
      {/* Human-verification row — distinct from the OCR TrustBadge above. */}
      <div className="px-1.5 pb-1 flex items-center justify-between gap-1">
        {(reviewStatus === 'confirmed' || reviewStatus === 'confirmed_unlinked') ? (
          <span className="text-[8px] font-bold tracking-wider px-1 py-[1px] border border-green-700 text-green-400 flex items-center gap-0.5">
            <ShieldCheck className="w-2.5 h-2.5" /> VERIFIED
          </span>
        ) : reviewStatus === 'rejected' ? (
          <span className="text-[8px] font-bold tracking-wider px-1 py-[1px] border border-red-800 text-red-400">REJECTED</span>
        ) : (
          <span className="text-[8px] font-bold tracking-wider px-1 py-[1px] border border-border-subtle text-fg-muted">UNVERIFIED</span>
        )}
        <button type="button" onClick={() => onEdit?.(cap)}
          className="text-[8px] font-bold tracking-wider px-1.5 py-[1px] border border-[color:var(--field-label-color)] [color:var(--field-label-color)] hover:bg-surface-sunken flex items-center gap-0.5">
          <Pencil className="w-2.5 h-2.5" /> EDIT
        </button>
      </div>
    </div>
  );
}

const SOURCE_TABS: Array<{ key: CaptureSource | 'all'; label: string }> = [
  { key: 'all', label: 'ALL' }, { key: 'dashcam', label: 'DASHCAM' },
  { key: 'field', label: 'FIELD' }, { key: 'manual', label: 'MANUAL' },
];
const BAND_TABS: Array<{ key: ConfidenceBand | 'all'; label: string }> = [
  { key: 'all', label: 'ANY' }, { key: 'high', label: '≥85%' }, { key: 'low', label: 'REVIEW' },
];

export default function AlprCaptureGallery({ onPlate }: { onPlate?: (plate: string) => void }) {
  const [caps, setCaps] = useState<GalleryCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<CaptureFilter>({ source: 'all', band: 'all', hits: 'all' });
  const [dossierPlate, setDossierPlate] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditableCapture | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'warn' | 'err' } | null>(null);

  const handlePlate = (plate: string) => {
    setDossierPlate(plate);
    onPlate?.(plate);
  };

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    return apiFetch<GalleryCapture[]>('/alpr/captures?gallery=1&limit=120')
      .then((r) => setCaps(Array.isArray(r) ? r : []))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load captures'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    apiFetch<GalleryCapture[]>('/alpr/captures?gallery=1&limit=120')
      .then((r) => { if (!cancelled) setCaps(Array.isArray(r) ? r : []); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load captures'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const eventTypes = useMemo(() => eventTypeOptions(caps), [caps]);
  const shown = useMemo(() => filterCaptures(caps, filter), [caps, filter]);
  const hitCount = useMemo(() => caps.filter((c) => c.alerted).length, [caps]);

  return (
    <div className="space-y-2">
      {/* Filter bar */}
      <div className="border border-border-default bg-surface-sunken p-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold [color:var(--field-label-color)] tracking-wider">CAPTURE GALLERY</span>
          <button onClick={load} aria-label="Refresh captures" title="Refresh captures" className="text-[9px] text-fg-muted hover:text-rmpg-100 flex items-center gap-1">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {shown.length}/{caps.length}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {SOURCE_TABS.map((t) => (
            <button key={t.key} onClick={() => setFilter((f) => ({ ...f, source: t.key }))}
              className={`text-[9px] px-2 py-1 border ${filter.source === t.key ? 'border-[color:var(--field-label-color)] [color:var(--field-label-color)] bg-surface-sunken' : 'border-border-default text-fg-muted'}`}>
              {t.label}
            </button>
          ))}
          <span className="w-px h-4 bg-border-default mx-0.5" />
          {BAND_TABS.map((t) => (
            <button key={t.key} onClick={() => setFilter((f) => ({ ...f, band: t.key }))}
              className={`text-[9px] px-2 py-1 border ${filter.band === t.key ? 'border-[color:var(--field-label-color)] [color:var(--field-label-color)] bg-surface-sunken' : 'border-border-default text-fg-muted'}`}>
              {t.label}
            </button>
          ))}
          <span className="w-px h-4 bg-border-default mx-0.5" />
          <button onClick={() => setFilter((f) => ({ ...f, hits: f.hits === 'hits' ? 'all' : 'hits' }))}
            className={`text-[9px] px-2 py-1 border flex items-center gap-1 ${filter.hits === 'hits' ? 'border-red-600 text-red-300 bg-red-950/50' : 'border-border-default text-fg-muted'}`}>
            <AlertTriangle className="w-2.5 h-2.5" /> HITS{hitCount ? ` (${hitCount})` : ''}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <input
            value={filter.plate || ''} onChange={(e) => setFilter((f) => ({ ...f, plate: e.target.value }))}
            placeholder="Plate…"
            className="text-[10px] bg-black border border-border-default text-rmpg-300 px-2 py-1 w-24 focus:border-[color:var(--field-label-color)] focus:outline-none font-mono uppercase" />
          {eventTypes.length > 0 && (
            <select value={filter.eventType || ''} onChange={(e) => setFilter((f) => ({ ...f, eventType: e.target.value || undefined }))}
              className="text-[10px] bg-black border border-border-default text-rmpg-300 px-1 py-1 focus:border-[color:var(--field-label-color)] focus:outline-none">
              <option value="">All events</option>
              {eventTypes.map((t) => <option key={t} value={t}>{toDisplayLabel(t)}</option>)}
            </select>
          )}
          {(filter.plate || filter.eventType || filter.source !== 'all' || filter.band !== 'all' || filter.hits === 'hits') && (
            <button onClick={() => setFilter({ source: 'all', band: 'all', hits: 'all' })}
              className="text-[9px] px-2 py-1 border border-border-default text-fg-muted hover:text-rmpg-100">CLEAR</button>
          )}
        </div>
      </div>

      {err && <div className="border border-red-600 text-red-300 text-[11px] px-3 py-2 bg-red-950/40">{err}</div>}
      {!loading && !err && shown.length === 0 && (
        <div className="border border-border-default text-[11px] text-fg-muted px-3 py-6 text-center">
          {caps.length === 0
            ? 'No captures yet. Dashcam reads appear here once media sync runs; field/manual scans land here too.'
            : 'No captures match the current filters.'}
        </div>
      )}

      {toast && (
        <div className={`text-[11px] px-2 py-1.5 border flex items-center justify-between ${
          toast.kind === 'err' ? 'border-red-700 bg-red-950/50 text-red-300'
          : toast.kind === 'warn' ? 'border-yellow-700 bg-yellow-950/50 text-yellow-200'
          : 'border-rmpg-700 bg-surface-base text-rmpg-300'}`}>
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} className="text-current opacity-70 ml-2" aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {shown.map((cap) => (
          <CaptureTile key={cap.id} cap={cap} onPlate={handlePlate}
            onEdit={(c) => setEditing(c as unknown as EditableCapture)} />
        ))}
      </div>

      {dossierPlate && (
        <VehicleDossier plate={dossierPlate} onClose={() => setDossierPlate(null)} />
      )}
      {editing && (
        <CaptureReviewEditor
          capture={editing}
          onClose={() => setEditing(null)}
          onSaved={(m) => { setToast(m); load(); }}
        />
      )}
    </div>
  );
}
