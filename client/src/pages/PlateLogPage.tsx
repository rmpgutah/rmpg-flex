// Patrol plate/sighting log (Intel Wave 1) + ALPR camera capture.
// Mobile-first: tap SCAN to photograph a plate — the Roboflow "ALPR
// Vehicle Details Capture" workflow reads plate + vehicle details, which
// flow through the SAME cross-hit screening as a manual entry (STOLEN /
// watchlist / owner-warrant hits render as full-width red banners). Manual
// big-plate entry remains for when there's no camera or the read is poor.
// Every sighting is stored, building a searchable per-plate history.
import { useEffect, useRef, useState } from 'react';
import { Car, MapPin, ScanLine } from 'lucide-react';
import { apiFetch, apiPostForm, authedImageUrl } from '../hooks/useApi';
import { downscaleImage } from '../utils/downscaleImage';
import PanelTitleBar from '../components/PanelTitleBar';

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
}

/** A held (sub-85%) capture awaiting officer review. */
interface ReviewItem {
  id: number; plate: string | null; state?: string | null; condition?: string | null;
  damage_summary?: string | null; plate_confidence?: number | null;
  image_url?: string | null; created_at?: string;
}

/** Tailwind classes for a condition badge (clean→salvage). */
function conditionBadgeClass(condition?: string | null): string {
  switch ((condition || '').toLowerCase()) {
    case 'clean': return 'bg-green-900/40 text-green-300 border-green-700';
    case 'minor': return 'bg-yellow-900/30 text-yellow-300 border-yellow-700';
    case 'moderate': return 'bg-orange-900/30 text-orange-300 border-orange-700';
    case 'heavy': case 'salvage': return 'bg-red-900/40 text-red-300 border-red-700';
    default: return 'bg-neutral-800 text-neutral-300 border-neutral-600';
  }
}
interface Sighting {
  id: number; plate: string; location_text: string | null; notes: string | null; created_at: string;
}

// Shared hit banners — identical styling for manual + ALPR results.
function HitBanners({ hits }: { hits: ScreenHit[] }) {
  return (
    <>
      {hits.filter((h) => h.severity === 'critical').map((h) => (
        <div key={h.detail} className="bg-red-950 border border-red-600 text-red-300 text-sm font-semibold px-3 py-2">
          ⚠ {h.detail}
        </div>
      ))}
      {hits.filter((h) => h.severity === 'warning').map((h) => (
        <div key={h.detail} className="border border-[#d4a017] text-[#d4a017] text-[11px] px-3 py-1">
          {h.detail}
        </div>
      ))}
    </>
  );
}

export default function PlateLogPage() {
  const [plate, setPlate] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [result, setResult] = useState<SightResult | null>(null);
  const [recent, setRecent] = useState<Sighting[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scan, setScan] = useState<AlprResult | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[]>([]);
  const [reviewBusy, setReviewBusy] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadRecent = () => {
    apiFetch<Sighting[]>('/intel/sightings?limit=15')
      .then((r) => setRecent(Array.isArray(r) ? r : []))
      .catch(() => setRecent([]));
  };
  const loadReview = () => {
    apiFetch<ReviewItem[]>('/alpr/captures?review=1&limit=25')
      .then((r) => setReviewQueue(Array.isArray(r) ? r : []))
      .catch(() => setReviewQueue([]));
  };
  const reviewAction = async (id: number, action: 'accept' | 'reject') => {
    setReviewBusy(id);
    try {
      await apiFetch(`/alpr/capture/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      loadReview(); loadRecent();
    } catch (e) { console.error(e); }
    finally { setReviewBusy(null); }
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
    } catch (e) { console.error(e); }
    finally { setBusy(false); }
  };

  // ── ALPR camera capture ──────────────────────────────────────
  const onScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ''; // allow re-selecting same file
    if (!file || scanBusy) return;
    setScanBusy(true); setScanErr(null);
    try {
      const small = await downscaleImage(file, 1280, 0.8);
      const fd = new FormData();
      fd.append('image', small, 'plate.jpg');
      fd.append('capture_reason', 'patrol_alpr');
      if (location.trim()) fd.append('location_label', location.trim());
      if (notes.trim()) fd.append('capture_notes', notes.trim());
      if (coords) { fd.append('gps_latitude', String(coords.lat)); fd.append('gps_longitude', String(coords.lng)); }
      const r = await apiPostForm<AlprResult>('/alpr/capture', fd);
      setScan(r); setResult(null);
      if (r.capture.plate) setPlate(r.capture.plate);
      loadRecent();
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
      setScanErr(status === 503
        ? 'ALPR is not configured on the server (ROBOFLOW_API_KEY missing).'
        : (err as Error)?.message || 'Scan failed.');
    } finally { setScanBusy(false); }
  };

  const summarize = (c: AlprCapture) =>
    [c.color, c.year, c.make, c.model].filter(Boolean).join(' ') || c.vehicleType || '—';

  return (
    <div className="p-4 space-y-4 max-w-xl mx-auto">
      <PanelTitleBar title="PLATE LOG" icon={Car} />

      {/* ── ALPR camera capture ── */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onScanFile} />
      <button
        onClick={() => fileRef.current?.click()} disabled={scanBusy}
        className="w-full py-3 text-sm font-semibold border border-[#d4a017] bg-[#1a1400] text-[#d4a017] flex items-center justify-center gap-2 hover:bg-[#241d00] disabled:opacity-40">
        <ScanLine className="w-5 h-5" />
        {scanBusy ? 'READING PLATE…' : 'SCAN PLATE (CAMERA)'}
      </button>
      {scanErr && (
        <div className="border border-red-600 text-red-300 text-[11px] px-3 py-2 bg-red-950/40">{scanErr}</div>
      )}

      {scan && (
        <div className="border border-[#222222] bg-[#0b0b0b]">
          <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-[#1a1a1a]">
            ALPR CAPTURE{scan.capture.confidence != null ? ` — ${Math.round(scan.capture.confidence * 100)}% confidence` : ''}
          </div>
          <div className="p-3 space-y-2">
            <HitBanners hits={scan.hits} />
            <div className="flex items-start gap-3">
              {(scan.annotated_image_url || scan.image_url) && (
                <img
                  src={authedImageUrl(scan.annotated_image_url || scan.image_url)}
                  alt="ALPR capture"
                  className="w-24 h-24 object-cover border border-[#222222] shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-2xl tracking-[0.2em] text-white font-semibold">{scan.capture.plate || '—'}</div>
                <div className="text-[11px] text-[#888888] mt-1">
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
                      {scan.damage_summary && <span className="text-[11px] text-[#aaaaaa]">{scan.damage_summary}</span>}
                    </div>
                    {scan.damage_areas && scan.damage_areas.length > 0 && (
                      <ul className="text-[10px] text-[#888888] pl-4 list-disc">
                        {scan.damage_areas.map((d, di) => (
                          <li key={di}>{[d.severity, d.panel, d.type].filter(Boolean).join(' ')}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {scan.accepted === false && scan.enrich_status !== 'pending' && (
                  <div className="text-[10px] text-yellow-400 mt-1 border border-yellow-800 bg-yellow-950/40 px-1.5 py-1">
                    Low-confidence read{scan.plate_confidence != null ? ` (${Math.round(scan.plate_confidence * 100)}%)` : ''} — held for review, not recorded as confirmed.
                  </div>
                )}
                {scan.capture.reviewStatus && scan.accepted !== false && (
                  <div className="text-[10px] text-[#888888] mt-1">Review: {scan.capture.reviewStatus}</div>
                )}
                {!scan.hits.length && (
                  <div className="text-[11px] text-[#888888] mt-1">No hits — sighting logged.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual entry result ── */}
      {result && <HitBanners hits={result.hits} />}
      {result && !result.hits.length && (
        <div className="border border-[#222222] text-[11px] text-[#888888] px-3 py-1">
          {result.plate}: no hits{result.vehicle ? ` — ${[result.vehicle.color, result.vehicle.year, result.vehicle.make, result.vehicle.model].filter(Boolean).join(' ')} on file` : ' (plate not on file — sighting logged)'}
        </div>
      )}

      <div className="text-[9px] text-[#666666] uppercase tracking-wider text-center">— or enter manually —</div>

      <input
        value={plate}
        onChange={(e) => setPlate(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="PLATE"
        className="w-full bg-[#050505] border border-[#222222] px-3 py-3 text-2xl tracking-[0.3em] text-center text-white font-semibold focus:border-[#d4a017] outline-none uppercase"
      />
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-[#888888] shrink-0" />
        <input
          value={location} onChange={(e) => setLocation(e.target.value)}
          placeholder={coords ? `GPS captured (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}) — add detail` : 'Location'}
          className="flex-1 bg-[#050505] border border-[#222222] px-2 py-1 text-[11px] text-gray-200 focus:border-[#d4a017] outline-none"
        />
      </div>
      <input
        value={notes} onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Notes (optional)"
        className="w-full bg-[#050505] border border-[#222222] px-2 py-1 text-[11px] text-gray-200 focus:border-[#d4a017] outline-none"
      />
      <button
        onClick={submit} disabled={busy || plate.trim().length < 2}
        className="w-full py-2 text-sm font-semibold border border-[#d4a017] text-[#d4a017] hover:bg-[#1a1a1a] disabled:opacity-40">
        {busy ? 'CHECKING…' : 'LOG + CHECK'}
      </button>

      {reviewQueue.length > 0 && (
        <div className="bg-[#141414] border border-yellow-800">
          <div className="px-2 py-[3px] text-[9px] font-semibold text-yellow-400 border-b border-yellow-900 flex items-center justify-between">
            <span>NEEDS REVIEW · low-confidence (&lt;85%)</span>
            <span>{reviewQueue.length}</span>
          </div>
          {reviewQueue.map((q) => (
            <div key={q.id} className="px-2 py-1.5 border-b border-[#1a1a1a] last:border-b-0 flex items-center gap-2">
              {q.image_url && (
                <img src={authedImageUrl(q.image_url)} alt="" className="w-10 h-10 object-cover border border-[#222] shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm tracking-[0.15em] text-white font-semibold">
                  {q.plate || '—'}
                  {q.plate_confidence != null && <span className="text-[10px] text-yellow-500 ml-2 tracking-normal">{Math.round(q.plate_confidence * 100)}%</span>}
                </div>
                <div className="text-[10px] text-[#888888] truncate">
                  {[q.state, q.condition, q.damage_summary].filter(Boolean).join(' · ') || 'no attributes'}
                </div>
              </div>
              <button type="button" disabled={reviewBusy === q.id} onClick={() => reviewAction(q.id, 'accept')}
                className="text-[10px] font-bold uppercase px-2 py-1 border border-green-700 text-green-400 hover:bg-green-950 disabled:opacity-40">
                Confirm
              </button>
              <button type="button" disabled={reviewBusy === q.id} onClick={() => reviewAction(q.id, 'reject')}
                className="text-[10px] font-bold uppercase px-2 py-1 border border-red-800 text-red-400 hover:bg-red-950 disabled:opacity-40">
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[#141414] border border-[#222222]">
        <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-[#1a1a1a]">RECENT SIGHTINGS</div>
        {recent.length === 0 && <div className="p-2 text-[11px] text-[#888888]">None yet.</div>}
        {recent.map((s) => (
          <div key={s.id} className="px-2 py-[2px] text-[11px] text-gray-200 flex gap-2 border-b border-[#1a1a1a] last:border-b-0">
            <span className="text-[#d4a017] w-24 shrink-0">{s.plate}</span>
            <span className="text-[#888888] flex-1 truncate">{s.location_text || ''} {s.notes || ''}</span>
            <span className="text-[#888888]">{String(s.created_at).slice(5, 16)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
