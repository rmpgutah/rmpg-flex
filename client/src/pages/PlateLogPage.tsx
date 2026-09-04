// Patrol plate/sighting log (Intel Wave 1) + ALPR camera capture.
// Mobile-first: tap SCAN to photograph a plate — Cloudflare Workers AI reads
// the plate + vehicle details (no external key/credits), which flow through the
// SAME cross-hit screening as a manual entry (STOLEN / watchlist / owner-warrant
// hits render as full-width red banners). Manual big-plate entry remains for
// when there's no camera or the read is poor. Every sighting is stored and
// source-tagged (FIELD CAMERA / DASHCAM / MANUAL), building a searchable,
// mappable per-plate history. ClearPath dashcam reads land here automatically.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, Car, FileText, MapPin, ScanLine, Map as MapIcon } from 'lucide-react';
import { apiFetch, apiPostForm, authedImageUrl } from '../hooks/useApi';
import { downscaleImage } from '../utils/downscaleImage';
import { enhancePlateImage } from '../utils/alprImagePrep';
import PanelTitleBar from '../components/PanelTitleBar';
import { sightingSource, sightingSourceKey, ALL_SOURCES, type SightingSourceKey } from '../utils/alprSource';
import SightingsMap, { type MapSighting } from '../components/SightingsMap';
import PlateDossier from '../components/PlateDossier';
import CarxeLookupPanel from '../components/CarxeLookupPanel';
import ClearPathDashcamPanel from '../components/ClearPathDashcamPanel';
import AlprCaptureGallery from '../components/AlprCaptureGallery';
import CaptureReviewEditor, { type EditableCapture } from '../components/CaptureReviewEditor';
import TrustBadge from '../components/TrustBadge';
import { openPlateCapturePdf, type PlateCaptureForPdf } from '../utils/plateCapturePdf';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useSlashFocus } from '../hooks/useSlashFocus';
import { plateSightingsToCsv, downloadTextFile } from '../utils/rmsListExport';

interface ScreenHit { kind: string; severity: 'critical' | 'warning'; detail: string }
interface Vehicle { id: number; plate_number: string; make: string; model: string; color: string; year: number }
interface SightResult {
  plate: string;
  vehicle: Vehicle | null;
  hits: ScreenHit[];
}
interface DamageArea { panel: string | null; type: string | null; severity: string | null }
interface AlprCapture {
  plate: string | null; state: string | null; make: string | null; model: string | null;
  color: string | null; year: number | null; vehicleType: string | null;
  confidence: number | null; riskScore: number | null; reviewStatus: string | null; alerted: boolean;
  condition?: string | null; damageObserved?: boolean | null; damageSummary?: string | null;
  accepted?: boolean | null; plateConfidence?: number | null;
}
interface AlprResult {
  id: number; sighting_id: number | null; capture: AlprCapture;
  detections: Array<{ class?: string; confidence?: number }>;
  output_keys: string[]; hits: ScreenHit[]; vehicle: Vehicle | null;
  enrich_status?: 'pending' | 'done' | 'failed';
  accepted?: boolean | null; plate_confidence?: number | null;
  condition?: string | null; damage_observed?: boolean | null; damage_summary?: string | null;
  damage_areas?: DamageArea[];
  image_url: string; annotated_image_url: string | null;
  /** Non-fatal warnings from image upload / field-photo attach (Worker returns these
   *  when a secondary write failed but the capture itself succeeded). */
  warnings?: string[];
}

/** A held (sub-85%) capture awaiting officer review. Carries the AI-observed
 *  attributes so the editor pre-fills (the /captures?review=1 payload is a full
 *  shapeCapture row). */
interface ReviewItem {
  id: number; plate: string | null; state?: string | null; condition?: string | null;
  damage_summary?: string | null; plate_confidence?: number | null;
  image_url?: string | null; annotated_image_url?: string | null; created_at?: string;
  make?: string | null; model?: string | null; color?: string | null;
  year?: number | null; vehicle_type?: string | null; review_status?: string | null;
}

const REVIEW_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  confirmed_unlinked: 'Confirmed (record not linked)',
  needs_review: 'Needs review',
  no_plate: 'No plate',
  rejected: 'Rejected',
};

function reviewStatusLabel(status: string): string {
  return REVIEW_STATUS_LABELS[status] ?? status;
}

const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

/** Tailwind classes for a condition badge (clean→salvage). */
function conditionBadgeClass(condition?: string | null): string {
  switch ((condition || '').toLowerCase()) {
    case 'clean': return 'bg-green-900/40 text-green-300 border-green-700';
    case 'minor': return 'bg-yellow-900/30 text-yellow-300 border-yellow-700';
    case 'moderate': return 'bg-orange-900/30 text-orange-300 border-orange-700';
    case 'heavy': case 'salvage': return 'bg-red-900/40 text-red-300 border-red-700';
    default: return 'bg-surface-overlay text-rmpg-300 border-rmpg-600';
  }
}
interface Sighting {
  id: number; plate: string; location_text: string | null; notes: string | null; created_at: string;
  lat?: number | null; lng?: number | null; state?: string | null; confidence?: number | null;
}

// Shared hit banners — identical styling for manual + ALPR results.
// Critical hits get the Lucide AlertTriangle (the prior `⚠` glyph rendered as
// a tofu box on some Android WebView builds and on the iOS app's older fallback
// font); warning hits are bordered gold chips.
function HitBanners({ hits }: { hits: ScreenHit[] }) {
  return (
    <>
      {hits.filter((h) => h.severity === 'critical').map((h, i) => (
        <div key={`c${i}-${h.detail}`} className="bg-red-950 border border-red-600 text-red-300 text-sm font-semibold px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {h.detail}
        </div>
      ))}
      {hits.filter((h) => h.severity === 'warning').map((h, i) => (
        <div key={`w${i}-${h.detail}`} className="border border-brand-gold-500 text-brand-gold-500 text-[11px] px-3 py-1">
          {h.detail}
        </div>
      ))}
    </>
  );
}

const DELETE_ROLES = new Set(['admin', 'manager']);

export default function PlateLogPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');
  const canDelete = DELETE_ROLES.has(user?.role ?? '');
  const [confirmDismissScan, setConfirmDismissScan] = useState(false);

  const [plate, setPlate] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [result, setResult] = useState<SightResult | null>(null);
  const [recent, setRecent] = useState<Sighting[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scan, setScan] = useState<AlprResult | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[]>([]);
  const [reviewBusy, setReviewBusy] = useState<number | null>(null);
  const [reviewMsg, setReviewMsg] = useState<{ text: string; kind: 'ok' | 'warn' | 'err' } | null>(null);
  const [editing, setEditing] = useState<EditableCapture | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SightingSourceKey | 'all'>('all');
  const [dossierPlate, setDossierPlate] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [view, setView] = useState<'scan' | 'gallery'>('scan');
  const [pdfBusy, setPdfBusy] = useState(false);
  // ConfirmDialog state for bulk destructive actions
  const [confirmBulk, setConfirmBulk] = useState<'confirm' | 'reject' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const plateInputRef = useRef<HTMLInputElement>(null);
  useSlashFocus(plateInputRef);
  // Ref for the scan tile — used to scroll into view after a deep-link load.
  const scanTileRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // One-shot deep-link handles: `?capture_id=<n>` hydrates the scan tile from
  // server (so the entity-aware notification routing — see notificationRouting.ts
  // `alpr_capture → /plate-log?capture_id=` — actually lands SOMEWHERE useful).
  // `?plate=ABC123` opens the dossier directly.
  const pendingCaptureRef = useRef<string | null>(searchParams.get('capture_id'));
  const pendingPlateRef = useRef<string | null>(searchParams.get('plate'));

  // Source-filtered recent sightings + per-source counts.
  const filteredRecent = useMemo(
    () => sourceFilter === 'all' ? recent : recent.filter((s) => sightingSourceKey(s.notes) === sourceFilter),
    [recent, sourceFilter]);
  const dashcamCount = useMemo(() => recent.filter((s) => sightingSourceKey(s.notes) === 'dashcam').length, [recent]);
  const mapSightings: MapSighting[] = useMemo(
    () => filteredRecent.map((s) => ({ id: s.id, plate: s.plate, lat: s.lat ?? null, lng: s.lng ?? null, notes: s.notes, created_at: s.created_at })),
    [filteredRecent]);

  const loadRecent = () => {
    setRecentLoading(true);
    setRecentError(null);
    apiFetch<Sighting[]>('/intel/sightings?limit=15')
      .then((r) => setRecent(Array.isArray(r) ? r : []))
      .catch((err) => {
        setRecent([]);
        setRecentError(err instanceof Error ? err.message : 'Failed to load sightings');
      })
      .finally(() => setRecentLoading(false));
  };
  const loadReview = () => {
    apiFetch<ReviewItem[]>('/alpr/captures?review=1&limit=25')
      .then((r) => setReviewQueue(Array.isArray(r) ? r : []))
      .catch(() => setReviewQueue([]));
  };
  const reviewAction = async (id: number, action: 'accept' | 'reject') => {
    setReviewBusy(id);
    try {
      const res = await apiFetch<{ hits?: Array<{ severity: string; detail: string }>; warning?: string }>(
        `/alpr/capture/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      if (action === 'accept') {
        // Confirming re-screens the plate — a STOLEN/watchlist hit MUST be shown.
        const crit = (res?.hits || []).filter((h) => h.severity === 'critical');
        if (crit.length) {
          setReviewMsg({ text: `Confirmed — HIT: ${crit.map((h) => h.detail).join('; ')}`, kind: 'warn' });
        } else if (res?.warning) {
          // Authoritative DB write failed (e.g. vehicle record upsert) but the
          // capture status was updated — surface so the officer can follow up.
          setReviewMsg({ text: `Confirmed (with warning): ${res.warning}`, kind: 'warn' });
        } else {
          setReviewMsg({ text: 'Confirmed.', kind: 'ok' });
        }
      } else {
        if (res?.warning) {
          setReviewMsg({ text: `Rejected (with warning): ${res.warning}`, kind: 'warn' });
        } else {
          setReviewMsg({ text: 'Rejected.', kind: 'ok' });
        }
      }
      loadReview(); loadRecent();
    } catch (e: any) {
      setReviewMsg({ text: `Action failed: ${e?.message || 'error'} — please retry.`, kind: 'err' });
    } finally { setReviewBusy(null); }
  };
  const toggleSel = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const bulkAction = async (action: 'confirm' | 'reject') => {
    const ids = [...selected];
    if (!ids.length || bulkBusy) return;
    setConfirmBulk(null);
    setBulkBusy(true);
    try {
      const res = await apiFetch<{ results?: Array<{ ok: boolean; status?: string }>; hits?: Array<{ severity: string; detail: string; plate: string }> }>(
        '/alpr/captures/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) });
      const results = res?.results || [];
      const ok = results.filter((r) => r.ok).length;
      const notLinked = results.filter((r) => !r.ok || r.status === 'confirmed_unlinked').length;
      const crit = (res?.hits || []).filter((h) => h.severity === 'critical');
      const baseText = `${action === 'confirm' ? 'Confirmed' : 'Rejected'} ${ok} capture${ok === 1 ? '' : 's'}`;
      const linkSuffix = action === 'confirm' && notLinked > 0 ? ` (${notLinked} not linked — review & retry)` : '';
      setReviewMsg(crit.length
        ? { text: `${action === 'confirm' ? 'Confirmed' : 'Rejected'} ${ok} — HITS: ${crit.map((h) => `${h.plate} ${h.detail}`).join('; ')}${linkSuffix}`, kind: 'warn' }
        : notLinked > 0
          ? { text: `${baseText}${linkSuffix}`, kind: 'warn' }
          : { text: `${baseText}.`, kind: 'ok' });
      setSelected(new Set());
      loadReview(); loadRecent();
    } catch (e: any) {
      setReviewMsg({ text: `Bulk ${action} failed: ${e?.message || 'error'} — please retry.`, kind: 'err' });
    } finally { setBulkBusy(false); }
  };
  useEffect(loadRecent, []);
  useEffect(loadReview, []);
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* GPS denied/unavailable — location_text still works */ },
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }, []);

  // ── Deep-link: ?capture_id= hydrates the scan tile, ?plate= opens dossier ─
  // Both are one-shot; the URL param is stripped after consumption so a refresh
  // doesn't keep re-firing. Mirrors FlexCamPage's pendingRequestIdRef pattern.
  useEffect(() => {
    const consumeParams = () => {
      if (!pendingCaptureRef.current && !pendingPlateRef.current) return;
      const next = new URLSearchParams(searchParams);
      next.delete('capture_id');
      next.delete('plate');
      setSearchParams(next, { replace: true });
    };
    const captureId = pendingCaptureRef.current;
    const plateParam = pendingPlateRef.current;
    if (plateParam && plateParam.trim()) {
      pendingPlateRef.current = null;
      setDossierPlate(plateParam.trim().toUpperCase());
    }
    if (captureId) {
      pendingCaptureRef.current = null;
      const numericId = Number(captureId);
      if (Number.isFinite(numericId) && numericId > 0) {
        setView('scan');
        apiFetch<AlprResult>(`/alpr/capture/${numericId}`)
          .then((cap) => {
            // The GET shape carries everything the scan tile needs except
            // `hits` (which is a per-screen result, not a stored field) and
            // `enrich_status` (server only emits on POST). Synthesize the
            // missing pieces so the tile renders without throwing.
            setScan({ ...(cap as any), hits: cap.hits ?? [], enrich_status: 'done' });
            if (cap.capture?.plate) setPlate(cap.capture.plate);
            addToast(`Capture #${numericId} loaded`, 'success');
            requestAnimationFrame(() => scanTileRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
          })
          .catch((e: any) => {
            const msg = `Could not open capture #${numericId}: ${e?.message || 'not found'}`;
            setScanErr(msg);
            addToast(msg, 'error');
          });
      }
    }
    consumeParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Esc smart-cascade: close-newest-open-first ─────────────────────────
  // Order: confirmDismissScan → confirmBulk → dossier → editing modal →
  //        reviewMsg banner → scan tile → scanErr.
  // Skip while typing in any field — operator may be editing notes/plate.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isTypingInField(e.target)) return;
      // ConfirmDialogs own their own Esc — short-circuit so the page cascade
      // doesn't also fire (focus is typically still on the page backdrop).
      if (confirmDismissScan) { e.stopPropagation(); setConfirmDismissScan(false); return; }
      if (confirmBulk !== null) { e.stopPropagation(); setConfirmBulk(null); return; }
      // PlateDossier and CaptureReviewEditor are modal overlays; they own
      // their own Esc handling once focus is inside them — but the cascade
      // here is the fallback for the (common) case where focus is still on
      // the page underneath.
      if (dossierPlate) { e.stopPropagation(); setDossierPlate(null); return; }
      if (editing) { e.stopPropagation(); setEditing(null); return; }
      if (reviewMsg) { e.stopPropagation(); setReviewMsg(null); return; }
      if (scanErr) { e.stopPropagation(); setScanErr(null); return; }
      if (scan) { e.stopPropagation(); setScan(null); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [confirmDismissScan, confirmBulk, dossierPlate, editing, reviewMsg, scanErr, scan]);

  // ── `N` shortcut: jump to plate input for a fresh manual entry. Keyboard
  // operators expect a quick "new entry" affordance (same convention as the
  // dispatch board's `N` for new call) — currently the only way to start a
  // manual entry on this page was to scroll/tap, awkward on mobile-keyboard.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      if (view !== 'scan') setView('scan');
      e.preventDefault();
      requestAnimationFrame(() => plateInputRef.current?.focus());
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [view]);

  // ── Court-record PDF for the currently-displayed scan tile. Pulls the
  // review history server-side so the chain-of-review is embedded in the
  // printout. Best-effort — a missing history endpoint shouldn't block the
  // print (handed off as []).
  const onPrintCapture = useCallback(async () => {
    if (!scan || pdfBusy) return;
    setPdfBusy(true);
    try {
      const history = await apiFetch<Array<{ id: number; action: string; details: string | null; created_at: string; user_name: string | null }>>(
        `/alpr/capture/${scan.id}/history`,
      ).catch(() => []);
      const capForPdf: PlateCaptureForPdf = {
        id: scan.id,
        plate: scan.capture.plate,
        state: scan.capture.state,
        make: scan.capture.make,
        model: scan.capture.model,
        color: scan.capture.color,
        year: scan.capture.year,
        vehicle_type: scan.capture.vehicleType,
        condition: scan.capture.condition ?? scan.condition,
        damage_summary: scan.capture.damageSummary ?? scan.damage_summary,
        damage_observed: scan.capture.damageObserved ?? scan.damage_observed,
        review_status: scan.capture.reviewStatus,
        accepted: scan.capture.accepted ?? scan.accepted,
        plate_confidence: scan.capture.plateConfidence ?? scan.plate_confidence,
        confidence: scan.capture.confidence,
        risk_score: scan.capture.riskScore,
        alerted: scan.capture.alerted,
        location_text: location.trim() || null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        image_url: scan.image_url,
        annotated_image_url: scan.annotated_image_url,
      };
      await openPlateCapturePdf({
        capture: capForPdf,
        hits: scan.hits,
        history: Array.isArray(history) ? history : [],
      });
    } catch (e: any) {
      setReviewMsg({ text: `Print failed: ${e?.message || 'error'}`, kind: 'err' });
    } finally {
      setPdfBusy(false);
    }
  }, [scan, pdfBusy, location, coords]);

  const submit = async () => {
    if (plate.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      const r = await apiFetch<SightResult>('/intel/sightings', {
        method: 'POST',
        body: JSON.stringify({
          plate: plate.trim(), location_text: location.trim() || undefined,
          notes: notes.trim() || undefined, lat: coords?.lat, lng: coords?.lng,
        }),
      });
      setResult(r); setScan(null);
      setPlate(''); setNotes('');
      loadRecent();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Plate submission failed', 'error');
    } finally { setBusy(false); }
  };

  // ── ALPR camera capture ──────────────────────────────────────
  const onScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ''; // allow re-selecting same file
    if (!file || scanBusy) return;
    setScanBusy(true); setScanErr(null);
    try {
      const small = await downscaleImage(file, 1600, 0.9);
      // Image dynamics for OCR accuracy: contrast-stretch + unsharp + ensure the
      // plate has enough pixels. Falls back to `small` on any canvas failure.
      const enhanced = await enhancePlateImage(small, { targetWidth: 1280, maxWidth: 1600, contrast: true, sharpen: 0.9 });
      const fd = new FormData();
      fd.append('image', enhanced, 'plate.jpg');
      fd.append('capture_reason', 'patrol_alpr');
      if (location.trim()) fd.append('location_label', location.trim());
      if (notes.trim()) fd.append('capture_notes', notes.trim());
      if (coords) { fd.append('gps_latitude', String(coords.lat)); fd.append('gps_longitude', String(coords.lng)); }
      const r = await apiPostForm<AlprResult>('/alpr/capture', fd);
      setScan(r); setResult(null);
      if (r.capture.plate) setPlate(r.capture.plate);
      loadRecent();
      // Surface non-fatal warnings (e.g. image upload / field-photo attach failed
      // but the capture itself was recorded successfully).
      if (r.warnings?.length) {
        setReviewMsg({ text: `Capture saved — warning: ${r.warnings.join(' · ')}`, kind: 'warn' });
      }
      // Background enrichment fills make/model/color a moment later — re-fetch
      // the capture up to twice. Bounded; never loops forever.
      if (r.enrich_status === 'pending') {
        for (let i = 0; i < 2; i++) {
          await new Promise((res) => setTimeout(res, 2500));
          try {
            const cap = await apiFetch<{ enrich_status?: string; capture?: AlprCapture;
              accepted?: boolean | null; condition?: string | null; damage_observed?: boolean | null;
              damage_summary?: string | null; damage_areas?: DamageArea[] }>(`/alpr/capture/${r.id}`);
            if (cap.capture) setScan((prev) => (prev && prev.id === r.id ? { ...prev, capture: cap.capture!,
              enrich_status: 'done', accepted: cap.accepted, condition: cap.condition,
              damage_observed: cap.damage_observed, damage_summary: cap.damage_summary, damage_areas: cap.damage_areas } : prev));
            if (cap.enrich_status === 'done' || cap.enrich_status === 'failed') break;
          } catch { /* transient */ }
        }
      }
    } catch (err) {
      const status = (err as { status?: number })?.status;
      // Plate reading runs on Cloudflare Workers AI (no external key/credits), so a
      // 503 here is a transient model/binding issue, not a misconfiguration.
      setScanErr(status === 503
        ? 'Plate reader temporarily unavailable — please retry.'
        : (err as Error)?.message || 'Scan failed.');
    } finally { setScanBusy(false); }
  };

  const summarize = (c: AlprCapture) =>
    [c.color, c.year, c.make, c.model].filter(Boolean).join(' ') || c.vehicleType || '—';

  return (
    <div className="p-4 space-y-4 max-w-xl mx-auto">
      <PanelTitleBar title="PLATE LOG" icon={Car}>
        <button
          type="button"
          className="toolbar-btn"
          disabled={filteredRecent.length === 0}
          onClick={() => downloadTextFile('plate-sightings.csv', plateSightingsToCsv(filteredRecent.map((s) => ({
            plate: s.plate,
            location_text: s.location_text,
            created_at: s.created_at,
            state: s.state,
            confidence: s.confidence,
          }))))}
        >CSV</button>
      </PanelTitleBar>

      {/* View toggle: live scan/manual vs. the ALPR capture gallery */}
      <div className="flex items-center gap-1">
        {([['scan', 'SCAN / LOG'], ['gallery', 'CAPTURES']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)}
            className={`flex-1 text-[10px] font-semibold tracking-wider py-1.5 border ${
              view === k ? 'border-brand-gold-500 text-brand-gold-500 bg-brand-gold-700/10' : 'border-border-default text-rmpg-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'gallery' && <AlprCaptureGallery onPlate={setDossierPlate} />}

      {view === 'scan' && (<>
      {/* ── ALPR camera capture ── */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onScanFile} />
      <button
        onClick={() => fileRef.current?.click()} disabled={scanBusy}
        className="w-full py-3 text-sm font-semibold border border-brand-gold-500 bg-brand-gold-700/10 text-brand-gold-500 flex items-center justify-center gap-2 hover:bg-brand-gold-700/20 disabled:opacity-40">
        <ScanLine className="w-5 h-5" />
        {scanBusy ? 'READING PLATE…' : 'SCAN PLATE (CAMERA)'}
      </button>
      {scanErr && (
        <div className="border border-red-600 text-red-300 text-[11px] px-3 py-2 bg-red-950/40">{scanErr}</div>
      )}

      {scan && (
        <div className="border border-border-default bg-surface-sunken">
          <div className="px-2 py-[3px] text-[9px] font-semibold text-brand-gold-500 border-b border-border-default flex items-center gap-2">
            <span>ALPR CAPTURE</span>
            {scan.capture.confidence != null && (
              <TrustBadge trust={{ trustScore: scan.capture.confidence, readCount: 1, basis: 'single read' }} />
            )}
            <button type="button" onClick={onPrintCapture} disabled={pdfBusy}
              className="ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 border border-brand-gold-500 text-brand-gold-500 hover:bg-brand-gold-700/10 disabled:opacity-40 flex items-center gap-1"
              title="Generate court-record PDF for this capture">
              <FileText className="w-3 h-3" />{pdfBusy ? '…' : 'COURT PDF'}
            </button>
            {canDelete && (
              <button type="button" onClick={() => setConfirmDismissScan(true)}
                className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-800 text-red-400 hover:bg-red-950/40"
                title="Dismiss this capture from view">
                DISMISS
              </button>
            )}
          </div>
          <div className="p-3 space-y-2">
            <HitBanners hits={scan.hits} />
            <div className="flex items-start gap-3">
              {(scan.annotated_image_url || scan.image_url) && (
                <img
                  src={authedImageUrl(scan.annotated_image_url || scan.image_url)}
                  alt="ALPR capture"
                  className="w-24 h-24 object-cover border border-border-default shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-2xl tracking-[0.2em] text-rmpg-100 font-semibold">{scan.capture.plate || '—'}</div>
                <div className="text-[11px] text-rmpg-400 mt-1">
                  {scan.capture.state ? `${scan.capture.state} · ` : ''}{summarize(scan.capture)}
                </div>
                {(scan.capture.condition || scan.damage_summary || (scan.damage_areas && scan.damage_areas.length > 0)) && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-2">
                      {scan.capture.condition && (
                        <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 border ${conditionBadgeClass(scan.capture.condition)}`}>
                          {scan.capture.condition}
                        </span>
                      )}
                      {scan.damage_summary && <span className="text-[11px] text-rmpg-300">{scan.damage_summary}</span>}
                    </div>
                    {scan.damage_areas && scan.damage_areas.length > 0 && (
                      <ul className="text-[10px] text-rmpg-400 pl-4 list-disc">
                        {scan.damage_areas.map((d, di) => (
                          <li key={di}>{[d.severity, d.panel, d.type].filter(Boolean).join(' ')}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {scan.accepted === false && scan.enrich_status !== 'pending' && (
                  <div className="text-[10px] text-yellow-400 mt-1 border border-yellow-800 bg-yellow-950/40 px-1.5 py-1">
                    Low-confidence read — held for review, not recorded as confirmed.
                  </div>
                )}
                {scan.capture.reviewStatus && scan.accepted !== false && (
                  <div className="text-[10px] text-rmpg-400 mt-1">Review: {reviewStatusLabel(scan.capture.reviewStatus)}</div>
                )}
                {!scan.hits.length && (
                  <div className="text-[11px] text-rmpg-400 mt-1">No hits — sighting logged.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual entry result ── */}
      {result && <HitBanners hits={result.hits} />}
      {result && !result.hits.length && (
        <div className="border border-border-default text-[11px] text-rmpg-400 px-3 py-1">
          {result.plate}: no hits{result.vehicle ? ` — ${[result.vehicle.color, result.vehicle.year, result.vehicle.make, result.vehicle.model].filter(Boolean).join(' ')} on file` : ' (plate not on file — sighting logged)'}
        </div>
      )}
      {result?.plate && (
        <div className="px-3">
          <CarxeLookupPanel mode="plate" plate={result.plate} />
        </div>
      )}

      <div className="text-[9px] text-rmpg-500 uppercase tracking-wider text-center">— or enter manually —</div>

      <input
        ref={plateInputRef}
        value={plate}
        onChange={(e) => setPlate(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="PLATE (/)"
        aria-label="Plate number (press N anywhere on the page to focus this field)"
        className="w-full bg-surface-overlay border border-border-default px-3 py-3 text-2xl tracking-[0.3em] text-center text-rmpg-100 font-semibold focus:border-brand-gold-500 outline-none uppercase"
      />
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-rmpg-400 shrink-0" />
        <input
          value={location} onChange={(e) => setLocation(e.target.value)}
          placeholder={coords ? `GPS captured (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}) — add detail` : 'Location'}
          className="flex-1 bg-surface-overlay border border-border-default px-2 py-1 text-[11px] text-rmpg-200 focus:border-brand-gold-500 outline-none"
        />
      </div>
      <input
        value={notes} onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Notes (optional)"
        className="w-full bg-surface-overlay border border-border-default px-2 py-1 text-[11px] text-rmpg-200 focus:border-brand-gold-500 outline-none"
      />
      <button
        onClick={submit} disabled={busy || plate.trim().length < 2}
        className="w-full py-2 text-sm font-semibold border border-brand-gold-500 text-brand-gold-500 hover:bg-surface-raised disabled:opacity-40">
        {busy ? 'CHECKING…' : 'LOG + CHECK'}
      </button>

      {reviewMsg && (
        <div className={`text-[11px] px-2 py-1.5 border flex items-center justify-between ${
          reviewMsg.kind === 'err' ? 'border-red-700 bg-red-950/50 text-red-300'
          : reviewMsg.kind === 'warn' ? 'border-yellow-700 bg-yellow-950/50 text-yellow-200'
          : 'border-rmpg-700 bg-surface-base text-rmpg-300'}`}>
          <span>{reviewMsg.text}</span>
          <button type="button" onClick={() => setReviewMsg(null)} className="text-current opacity-70 ml-2" aria-label="Dismiss">×</button>
        </div>
      )}
      {reviewQueue.length > 0 && (
        <div className="bg-surface-base border border-yellow-800">
          <div className="px-2 py-[3px] text-[9px] font-semibold text-yellow-400 border-b border-yellow-900 flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox"
                checked={selected.size > 0 && selected.size === reviewQueue.length}
                ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < reviewQueue.length; }}
                onChange={(e) => setSelected(e.target.checked ? new Set(reviewQueue.map((q) => q.id)) : new Set())}
                className="accent-brand-gold-500" />
              <span>NEEDS REVIEW · low-confidence (&lt;85%)</span>
            </label>
            <span>{reviewQueue.length}</span>
          </div>
          {selected.size > 0 && (
            <div className="px-2 py-1.5 border-b border-yellow-900 bg-brand-gold-700/10 flex items-center gap-2">
              <span className="text-[10px] text-brand-gold-500 font-semibold flex-1">{selected.size} selected</span>
              {canManage && (
                <>
                  <button type="button" disabled={bulkBusy} onClick={() => setConfirmBulk('confirm')}
                    className="text-[10px] font-bold uppercase px-2 py-1 border border-green-700 text-green-400 hover:bg-green-950 disabled:opacity-40">
                    {bulkBusy ? '…' : `Confirm ${selected.size}`}
                  </button>
                  <button type="button" disabled={bulkBusy} onClick={() => setConfirmBulk('reject')}
                    className="text-[10px] font-bold uppercase px-2 py-1 border border-red-800 text-red-400 hover:bg-red-950 disabled:opacity-40">
                    {bulkBusy ? '…' : `Reject ${selected.size}`}
                  </button>
                </>
              )}
            </div>
          )}
          {reviewQueue.map((q) => (
            <div key={q.id} className={`px-2 py-1.5 border-b border-border-default last:border-b-0 flex items-center gap-2 ${selected.has(q.id) ? 'bg-brand-gold-700/5' : ''}`}>
              <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggleSel(q.id)}
                className="accent-brand-gold-500 shrink-0" aria-label={`Select ${q.plate || 'capture'}`} />
              {q.image_url && (
                <img src={authedImageUrl(q.image_url)} alt="" className="w-10 h-10 object-cover border border-border-default shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm tracking-[0.15em] text-rmpg-100 font-semibold">
                  {q.plate || '—'}
                  {q.plate_confidence != null && (
                    <span className="ml-2 tracking-normal">
                      <TrustBadge trust={{ trustScore: q.plate_confidence, readCount: 1, basis: 'single read' }} />
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-rmpg-400 flex items-center gap-1.5 flex-wrap">
                  {q.state && <span>{q.state}</span>}
                  {q.condition && (
                    <span className={`text-[9px] uppercase font-bold px-1 border ${conditionBadgeClass(q.condition)}`}>{q.condition}</span>
                  )}
                  {q.damage_summary && <span className="truncate">{q.damage_summary}</span>}
                  {!q.state && !q.condition && !q.damage_summary && <span>no attributes</span>}
                </div>
              </div>
              <button type="button" disabled={reviewBusy === q.id} onClick={() => setEditing(q as EditableCapture)}
                className="text-[10px] font-bold uppercase px-2 py-1 border border-brand-gold-500 text-brand-gold-500 hover:bg-brand-gold-700/10 disabled:opacity-40">
                Edit
              </button>
              {canManage && (
                <>
                  <button type="button" disabled={reviewBusy === q.id} onClick={() => reviewAction(q.id, 'accept')}
                    className="text-[10px] font-bold uppercase px-2 py-1 border border-green-700 text-green-400 hover:bg-green-950 disabled:opacity-40">
                    Confirm
                  </button>
                  <button type="button" disabled={reviewBusy === q.id} onClick={() => reviewAction(q.id, 'reject')}
                    className="text-[10px] font-bold uppercase px-2 py-1 border border-red-800 text-red-400 hover:bg-red-950 disabled:opacity-40">
                    Reject
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── ClearPath dashcam integration ── */}
      <ClearPathDashcamPanel dashcamCount={dashcamCount} />

      {/* ── Recent sightings: source filter + map toggle + tappable rows ── */}
      <div className="bg-surface-base border border-border-default">
        <div className="px-2 py-[3px] border-b border-border-default flex items-center justify-between gap-2">
          <span className="text-[9px] font-semibold text-brand-gold-500">RECENT SIGHTINGS</span>
          <div className="flex items-center gap-1">
            {(['all', ...ALL_SOURCES.map((s) => s.key)] as const).map((k) => (
              <button key={k} type="button" onClick={() => setSourceFilter(k)}
                className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border tracking-wide ${
                  sourceFilter === k ? 'border-brand-gold-500 text-brand-gold-500 bg-brand-gold-700/10' : 'border-border-default text-rmpg-500'}`}>
                {k === 'all' ? 'ALL' : sightingSource(k === 'dashcam' ? 'ClearPath dashcam' : k === 'camera' ? 'ALPR' : '').label}
              </button>
            ))}
            <button type="button" onClick={() => setShowMap((v) => !v)} title="Toggle map"
              className={`ml-1 p-0.5 border ${showMap ? 'border-brand-gold-500 text-brand-gold-500' : 'border-border-default text-rmpg-500'}`}>
              <MapIcon className="w-3 h-3" />
            </button>
          </div>
        </div>

        {showMap && <div className="p-1.5 border-b border-border-default"><SightingsMap sightings={mapSightings} height={220} onPick={setDossierPlate} /></div>}

        {recentError && (
          <div className="p-2 text-[11px] text-red-400 flex items-center justify-between">
            <span>{recentError}</span>
            <button type="button" className="toolbar-btn" onClick={() => { loadRecent(); }}>Retry</button>
          </div>
        )}
        {recentLoading && (
          <div className="p-2 text-[11px] text-rmpg-400">Loading sightings…</div>
        )}
        {!recentLoading && filteredRecent.length === 0 && recent.length === 0 && (
          <div className="p-2 text-[11px] text-rmpg-400">No sightings recorded yet.</div>
        )}
        {!recentLoading && filteredRecent.length === 0 && recent.length > 0 && (
          <div className="p-2 text-[11px] text-rmpg-400">No sightings for this source filter.</div>
        )}
        {filteredRecent.map((s) => {
          const src = sightingSource(s.notes);
          return (
            <button key={s.id} type="button" onClick={() => setDossierPlate(s.plate)}
              className="w-full px-2 py-[3px] text-[11px] text-rmpg-200 flex items-center gap-2 border-b border-border-default last:border-b-0 hover:bg-surface-raised text-left">
              <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border shrink-0 ${src.badgeClass}`}>{src.label}</span>
              <span className="text-brand-gold-500 w-20 shrink-0 font-medium tracking-wide">{s.plate}</span>
              <span className="text-rmpg-400 min-w-0 flex-1 truncate">{s.location_text || s.notes || ''}</span>
              <span className="text-rmpg-500 shrink-0">{String(s.created_at).slice(5, 16)}</span>
            </button>
          );
        })}
      </div>
      </>)}

      {dossierPlate && <PlateDossier plate={dossierPlate} onClose={() => setDossierPlate(null)} />}
      {editing && (
        <CaptureReviewEditor
          capture={editing}
          onClose={() => setEditing(null)}
          onSaved={(m) => { setReviewMsg(m); loadReview(); loadRecent(); }}
        />
      )}

      {/* Bulk confirm/reject confirmation dialog */}
      <ConfirmDialog
        isOpen={confirmBulk !== null}
        onClose={() => setConfirmBulk(null)}
        onConfirm={() => confirmBulk && bulkAction(confirmBulk)}
        title={confirmBulk === 'confirm' ? 'Confirm captures' : 'Reject captures'}
        message={
          confirmBulk === 'confirm'
            ? `Confirm ${selected.size} capture${selected.size === 1 ? '' : 's'}? Each will be re-screened for hits.`
            : `Reject ${selected.size} capture${selected.size === 1 ? '' : 's'}? This marks them as unverified and removes them from the review queue.`
        }
        confirmLabel={confirmBulk === 'confirm' ? 'Confirm All' : 'Reject All'}
        confirmVariant={confirmBulk === 'reject' ? 'danger' : 'default'}
        isLoading={bulkBusy}
      />
    </div>
  );
}
