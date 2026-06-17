// MobileShiftPage — phone-first vehicle walkthrough opened by the ShiftCard's
// QR. The :token path param is the credential (resolves to an OPEN time_entry
// on the server; auto-dies at clock-out). No JWT — the page is unauthenticated
// app-wise on purpose, so the officer's personal phone scanning a QR Just
// Works without re-logging-in.
//
// Phase model: 'pre' until the pre-shift inspection is marked complete, then
// 'post' until clock-out; 'done' once both are submitted. The active phase
// determines which form is rendered.
//
// Photos: captured via <input type="file" capture="environment"> (opens the
// rear camera on iOS+Android), resized client-side to ≤1600px / ~0.7 quality
// JPEG before upload. Workers have a 100 MB request cap and we want this to
// work on cellular, so server-side resize is the wrong altitude.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

// ── Inspection scope (defaults) ─────────────────────────────────────────────
// 4-side exterior + odometer + fuel-gauge close-up. Each slot can hold one
// image. The labels appear in the UI; the slot keys feed into the R2 key.
const PHOTO_SLOTS: { key: string; label: string }[] = [
  { key: 'front',     label: 'Front' },
  { key: 'driver',    label: "Driver" },
  { key: 'passenger', label: 'Passenger' },
  { key: 'rear',      label: 'Rear' },
  { key: 'odometer',  label: 'Odometer' },
  { key: 'fuel',      label: 'Fuel gauge' },
];

const FUEL_LEVELS = ['E', '1/4', '1/2', '3/4', 'F'] as const;
type FuelLevel = typeof FUEL_LEVELS[number];

const EQUIPMENT_ITEMS: { key: string; label: string }[] = [
  { key: 'radio',      label: 'Radio' },
  { key: 'body_cam',   label: 'Body cam' },
  { key: 'dash_cam',   label: 'Dash cam' },
  { key: 'light_bar',  label: 'Light bar' },
  { key: 'siren',      label: 'Siren' },
  { key: 'aed',        label: 'AED' },
  { key: 'first_aid',  label: 'First aid kit' },
  { key: 'weapons_rack', label: 'Weapons rack' },
];
type EquipmentState = 'ok' | 'missing' | 'damaged';

// ── Types matching /api/inspections/by-token/:token response ────────────────
interface InspectionRow {
  id?: number;
  fuel_level?: string | null;
  odometer?: number | null;
  equipment_json?: string | null;
  damage_notes?: string | null;
  photo_keys_json?: string | null;
  exterior_ok?: number | null;
  notes?: string | null;
  completed_at?: string | null;
}
interface ShiftContext {
  time_entry_id: number;
  clock_in: string | null;
  starting_mileage: number | null;
  officer: { id: number; full_name: string; badge_number: string | null } | null;
  unit: { id: number; call_sign: string } | null;
  vehicle: { id: number; vehicle_number: string | null; vehicle_name: string | null; make: string | null; model: string | null } | null;
  pre_inspection: InspectionRow | null;
  post_inspection: InspectionRow | null;
  active_phase: 'pre' | 'post' | 'done';
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function resizeImageToJpeg(file: File, maxDim = 1600, quality = 0.72): Promise<Blob> {
  // Load → draw to canvas at scaled dims → toBlob('image/jpeg'). Falls back to
  // the original file if anything in the canvas pipeline throws (some Android
  // browsers reject 4K HEIC frames). The server still has a 6 MB ceiling.
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/jpeg', quality));
    return blob;
  } catch (err) {
    console.warn('[Inspection] resize failed — uploading original', err);
    return file;
  }
}

function parseEquipment(raw: string | null | undefined): Record<string, EquipmentState> {
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}
function parsePhotoKeys(raw: string | null | undefined): Record<string, string> {
  // Stored shape is either an array of keys OR a map {slot: key}. We standardize
  // to a slot-keyed map on the client; rows older than this code might be arrays.
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const k of v as string[]) {
        const slot = k.split('/').slice(-1)[0].split('-')[0];
        out[slot] = k;
      }
      return out;
    }
    return v || {};
  } catch { return {}; }
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function MobileShiftPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  // Per-phase form state. Initialized from the server row (resume in progress)
  // and merged back on save.
  const [fuel, setFuel] = useState<FuelLevel | ''>('');
  const [odometer, setOdometer] = useState('');
  const [equipment, setEquipment] = useState<Record<string, EquipmentState>>({});
  const [damage, setDamage] = useState('');
  const [photos, setPhotos] = useState<Record<string, string>>({}); // slot → R2 key
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const apiBase = useMemo(() => `/api/inspections/by-token/${encodeURIComponent(token)}`, [token]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(apiBase);
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error || `Failed (${res.status})`);
      }
      const data: ShiftContext = await res.json();
      setCtx(data);
      const row = data.active_phase === 'post' ? data.post_inspection : data.pre_inspection;
      setFuel(((row?.fuel_level as FuelLevel) ?? '') as FuelLevel | '');
      setOdometer(row?.odometer != null ? String(row.odometer) : '');
      setEquipment(parseEquipment(row?.equipment_json));
      setDamage(row?.damage_notes ?? '');
      setPhotos(parsePhotoKeys(row?.photo_keys_json));
    } catch (e: any) {
      setError(e?.message || 'Failed to load shift');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { void load(); }, [load]);

  const activePhase = ctx?.active_phase ?? 'pre';
  const isDone = activePhase === 'done';

  const handlePhoto = useCallback(async (slot: string, file: File) => {
    if (!ctx || isDone) return;
    setUploading(slot);
    setError(null);
    try {
      const blob = await resizeImageToJpeg(file);
      const res = await fetch(`${apiBase}/photos?phase=${activePhase}&slot=${encodeURIComponent(slot)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error || `Upload failed (${res.status})`);
      }
      const data: { key: string } = await res.json();
      setPhotos((p) => ({ ...p, [slot]: data.key }));
    } catch (e: any) {
      setError(e?.message || 'Photo upload failed');
    } finally {
      setUploading(null);
    }
  }, [apiBase, activePhase, ctx, isDone]);

  const setEquipState = (key: string, state: EquipmentState) => {
    setEquipment((e) => ({ ...e, [key]: state }));
  };

  const submit = useCallback(async (markComplete: boolean) => {
    if (!ctx || isDone || saving) return;
    setSaving(true);
    setError(null);
    try {
      const odoNum = parseFloat(odometer);
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase: activePhase,
          fuel_level: fuel || null,
          odometer: Number.isFinite(odoNum) && odoNum > 0 ? odoNum : null,
          equipment,
          damage_notes: damage || null,
          photo_keys: photos,
          exterior_ok: Object.values(equipment).every((s) => s !== 'damaged'),
          completed: markComplete,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [apiBase, activePhase, ctx, isDone, saving, fuel, odometer, equipment, damage, photos, load]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return <Frame><div className="text-rmpg-400 text-sm">Loading shift…</div></Frame>;
  }
  if (!ctx) {
    return <Frame>
      <div className="text-red-400 text-sm">{error || 'Shift not found.'}</div>
      <div className="text-rmpg-500 text-xs mt-2">This QR may have expired (shift ended) or never started. Ask dispatch for a new code.</div>
    </Frame>;
  }

  const headerTitle = activePhase === 'post' ? 'POST-SHIFT REVIEW'
                    : activePhase === 'done' ? 'INSPECTION COMPLETE'
                    : 'PRE-SHIFT WALKTHROUGH';

  return (
    <Frame>
      <header className="mb-3">
        <div className="text-[#d4a017] text-[10px] font-bold tracking-widest">{headerTitle}</div>
        <div className="text-rmpg-100 text-base font-bold mt-1">
          {ctx.unit?.call_sign ?? '—'} · {ctx.vehicle?.vehicle_number ?? ctx.vehicle?.vehicle_name ?? '—'}
        </div>
        <div className="text-rmpg-500 text-xs">{ctx.officer?.full_name ?? '—'}</div>
      </header>

      {error && <div className="mb-3 border border-red-700 bg-red-950/40 text-red-300 text-xs p-2">{error}</div>}

      {isDone ? (
        <DoneView ctx={ctx} />
      ) : (
        <>
          {/* PHOTOS — 2-up grid, big tap targets for thumbs */}
          <Section title="Photos">
            <div className="grid grid-cols-2 gap-2">
              {PHOTO_SLOTS.map((slot) => {
                const has = !!photos[slot.key];
                return (
                  <label key={slot.key}
                    className={[
                      'relative block border min-h-[96px] p-2 text-center cursor-pointer touch-manipulation',
                      has ? 'border-[#d4a017] bg-[#1a1a0d]' : 'border-[#222] bg-[#0d0d0d]',
                    ].join(' ')}>
                    <input
                      ref={(el) => { fileInputs.current[slot.key] = el; }}
                      type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhoto(slot.key, f); e.target.value = ''; }}
                    />
                    <div className="text-[10px] uppercase tracking-widest text-rmpg-400 mb-1">{slot.label}</div>
                    <div className={['text-xs font-bold', has ? 'text-[#d4a017]' : 'text-rmpg-500'].join(' ')}>
                      {uploading === slot.key ? 'Uploading…' : has ? '✓ Captured · retake' : 'Tap to capture'}
                    </div>
                  </label>
                );
              })}
            </div>
          </Section>

          {/* FUEL */}
          <Section title="Fuel level">
            <div className="grid grid-cols-5 grid-keep gap-1">
              {FUEL_LEVELS.map((lvl) => (
                <button key={lvl} type="button"
                  onClick={() => setFuel(lvl)}
                  className={[
                    'h-12 border text-sm font-bold touch-manipulation',
                    fuel === lvl ? 'border-[#d4a017] bg-[#1a1a0d] text-[#d4a017]' : 'border-[#222] bg-[#0d0d0d] text-rmpg-300',
                  ].join(' ')}>{lvl}</button>
              ))}
            </div>
          </Section>

          {/* ODOMETER */}
          <Section title={activePhase === 'post' ? 'Ending odometer' : 'Starting odometer'}>
            <input type="number" inputMode="numeric" min={0} step="0.1"
              value={odometer} onChange={(e) => setOdometer(e.target.value)}
              placeholder="e.g. 45230"
              className="w-full h-12 bg-[#0d0d0d] border border-[#222] text-rmpg-100 text-base font-mono px-3 focus:border-[#d4a017] outline-none" />
            {activePhase === 'post' && ctx.starting_mileage != null && (
              <div className="mt-1 text-[10px] text-rmpg-500">Started at {ctx.starting_mileage.toLocaleString()}</div>
            )}
          </Section>

          {/* EQUIPMENT — three-state per item */}
          <Section title="Equipment">
            <div className="space-y-1">
              {EQUIPMENT_ITEMS.map((it) => {
                const cur = equipment[it.key];
                return (
                  <div key={it.key} className="flex items-center justify-between gap-2 border border-[#1a1a1a] bg-[#0d0d0d] px-2 py-1.5">
                    <span className="text-gray-200 text-sm flex-1 truncate">{it.label}</span>
                    {(['ok', 'missing', 'damaged'] as EquipmentState[]).map((s) => (
                      <button key={s} type="button" onClick={() => setEquipState(it.key, s)}
                        className={[
                          'min-w-[56px] h-9 border text-[10px] uppercase tracking-wider font-bold',
                          cur === s
                            ? s === 'ok' ? 'border-green-600 bg-green-950/40 text-green-300'
                              : s === 'missing' ? 'border-amber-600 bg-amber-950/40 text-amber-300'
                              : 'border-red-700 bg-red-950/40 text-red-300'
                            : 'border-[#222] bg-[#0d0d0d] text-rmpg-500',
                        ].join(' ')}>{s}</button>
                    ))}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* DAMAGE / NOTES */}
          <Section title="Damage / notes">
            <textarea value={damage} onChange={(e) => setDamage(e.target.value)}
              rows={3} maxLength={1000}
              placeholder="Any new dents, broken lights, fluid leaks, missing items, etc."
              className="w-full bg-[#0d0d0d] border border-[#222] text-rmpg-100 text-sm p-2 focus:border-[#d4a017] outline-none" />
          </Section>

          {/* SUBMIT */}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => submit(false)} disabled={saving}
              className="flex-1 h-12 bg-[#1a1a1a] border border-[#222] text-rmpg-300 text-xs uppercase tracking-widest font-bold disabled:opacity-50">
              Save progress
            </button>
            <button type="button" onClick={() => submit(true)} disabled={saving}
              className="flex-1 h-12 bg-[#1a1a0d] border border-[#d4a017] text-[#d4a017] text-xs uppercase tracking-widest font-bold disabled:opacity-50">
              {saving ? 'Saving…' : (activePhase === 'post' ? 'Finish review' : 'Complete pre-shift')}
            </button>
          </div>
        </>
      )}
    </Frame>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-rmpg-100">
      <div className="max-w-[480px] mx-auto p-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <div className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-1">{title}</div>
      {children}
    </section>
  );
}

function DoneView({ ctx }: { ctx: ShiftContext }) {
  const pre = ctx.pre_inspection, post = ctx.post_inspection;
  const miles = pre?.odometer != null && post?.odometer != null
    ? Math.max(0, (post.odometer as number) - (pre.odometer as number)) : null;
  return (
    <div className="space-y-3">
      <div className="border border-[#d4a017] bg-[#1a1a0d] p-3 text-center">
        <div className="text-[#d4a017] text-xs uppercase tracking-widest font-bold">All clear</div>
        <div className="text-rmpg-300 text-[11px] mt-1">Pre-shift and post-shift inspection submitted.</div>
      </div>
      {miles != null && (
        <div className="border border-[#222] bg-[#0d0d0d] p-3">
          <div className="text-rmpg-500 text-[10px] uppercase">Total miles this shift</div>
          <div className="text-rmpg-100 text-2xl font-mono font-bold">{miles.toFixed(1)}</div>
        </div>
      )}
    </div>
  );
}
