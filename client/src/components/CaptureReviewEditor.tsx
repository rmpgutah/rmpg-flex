// Shared advanced review/edit/verify editor for an ALPR capture.
// Used by BOTH the SCAN/LOG "needs review" queue (PlateLogPage) and the CAPTURES
// gallery (AlprCaptureGallery). Pre-fills from the capture row, lets an officer
// correct plate/state/make/model/color/year/condition/damage, then Confirm /
// Save / Reject via POST /alpr/capture/:id/verify. Re-editing an already-decided
// capture requires a reason (the "change function"). Modal on desktop, full sheet
// on mobile (same fixed-overlay pattern as VehicleDossier).
import { useEffect, useMemo, useState } from 'react';
import { X, ShieldCheck, Save, Ban, History } from 'lucide-react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import {
  formFromCapture, plateError, buildVerifyBody, CONDITIONS,
  type CaptureEditForm,
} from '../utils/captureEdit';

/** The minimum a capture must carry for the editor. */
export interface EditableCapture {
  id: number;
  plate?: string | null; state?: string | null; make?: string | null; model?: string | null;
  color?: string | null; year?: number | null; vehicle_type?: string | null; vehicleType?: string | null;
  condition?: string | null; damage_summary?: string | null; damageSummary?: string | null;
  review_status?: string | null; plate_confidence?: number | null;
  image_url?: string | null; annotated_image_url?: string | null;
}

interface VerifyResponse { success?: boolean; hits?: Array<{ severity: string; detail: string }>; error?: string }
interface HistoryRow { id: number; action: string; details: string | null; created_at: string; user_name: string | null }

const FIELD = 'bg-surface-overlay border border-border-default px-2 py-1.5 text-[12px] text-rmpg-200 focus:border-accent-gold-300 outline-none w-full';
const LABEL = 'text-[9px] uppercase tracking-wider text-fg-muted mb-0.5 block';

export default function CaptureReviewEditor({
  capture, onClose, onSaved,
}: {
  capture: EditableCapture;
  onClose: () => void;
  onSaved?: (msg: { text: string; kind: 'ok' | 'warn' | 'err' }) => void;
}) {
  const original = useMemo(() => formFromCapture(capture), [capture]);
  const [form, setForm] = useState<CaptureEditForm>(original);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<null | 'confirm' | 'save' | 'reject'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    apiFetch<HistoryRow[]>(`/alpr/capture/${capture.id}/history`)
      .then((r) => setHistory(Array.isArray(r) ? r : []))
      .catch(() => setHistory([]));
  }, [capture.id]);

  const wasDecided = capture.review_status === 'confirmed' || capture.review_status === 'confirmed_unlinked' || capture.review_status === 'rejected';
  const img = capture.annotated_image_url || capture.image_url;
  const pErr = plateError(form.plate);
  const set = (k: keyof CaptureEditForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (action: 'confirm' | 'save' | 'reject') => {
    setErr(null);
    if (action !== 'reject' && pErr) { setErr(pErr); return; }
    if (wasDecided && !reason.trim()) { setErr('A reason is required to change an already-reviewed capture.'); return; }
    setBusy(action);
    try {
      const body: Record<string, unknown> = { action, ...buildVerifyBody(original, form) };
      if (wasDecided) body.reason = reason.trim();
      const res = await apiFetch<VerifyResponse>(`/alpr/capture/${capture.id}/verify`, {
        method: 'POST', body: JSON.stringify(body),
      });
      const crit = (res?.hits || []).filter((h) => h.severity === 'critical');
      if (action === 'confirm') {
        onSaved?.(crit.length
          ? { text: `Verified — HIT: ${crit.map((h) => h.detail).join('; ')}`, kind: 'warn' }
          : { text: 'Verified.', kind: 'ok' });
      } else if (action === 'reject') {
        onSaved?.({ text: 'Rejected.', kind: 'ok' });
      } else {
        onSaved?.({ text: 'Saved.', kind: 'ok' });
      }
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Action failed — please retry.');
    } finally { setBusy(null); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface-sunken border border-border-default w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
        <div className="px-3 py-2 border-b border-border-default flex items-center justify-between sticky top-0 bg-surface-sunken">
          <span className="text-[10px] font-semibold tracking-wider text-[color:var(--field-label-color)]">
            REVIEW &amp; VERIFY{wasDecided ? ' · CHANGE' : ''}
          </span>
          <button type="button" onClick={onClose} className="text-fg-muted hover:text-rmpg-100" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-3">
          {img && (
            <img src={authedImageUrl(img)} alt="capture" className="w-full max-h-48 object-contain bg-black border border-border-default" />
          )}

          {/* Plate — the headline correction. */}
          <div>
            <label className={LABEL}>Plate{capture.plate_confidence != null && (
              <span className="text-yellow-500 ml-1">{Math.round(capture.plate_confidence * 100)}% trust</span>
            )}</label>
            <input
              value={form.plate}
              onChange={(e) => set('plate', e.target.value.toUpperCase())}
              className={`${FIELD} text-xl tracking-[0.2em] text-center font-semibold ${pErr ? 'border-red-700' : ''}`}
              placeholder="PLATE" />
            {pErr && <div className="text-[10px] text-red-400 mt-0.5">{pErr}</div>}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={LABEL}>State</label>
              <input value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} maxLength={3} className={FIELD} placeholder="UT" />
            </div>
            <div>
              <label className={LABEL}>Year</label>
              <input value={form.year} onChange={(e) => set('year', e.target.value.replace(/[^0-9]/g, ''))} maxLength={4} className={FIELD} placeholder="2019" />
            </div>
            <div>
              <label className={LABEL}>Condition</label>
              <select value={form.condition} onChange={(e) => set('condition', e.target.value)} className={FIELD}>
                <option value="">—</option>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={LABEL}>Make</label>
              <input value={form.make} onChange={(e) => set('make', e.target.value)} className={FIELD} placeholder="Honda" />
            </div>
            <div>
              <label className={LABEL}>Model</label>
              <input value={form.model} onChange={(e) => set('model', e.target.value)} className={FIELD} placeholder="Civic" />
            </div>
            <div>
              <label className={LABEL}>Color</label>
              <input value={form.color} onChange={(e) => set('color', e.target.value)} className={FIELD} placeholder="Silver" />
            </div>
          </div>

          <div>
            <label className={LABEL}>Damage / notes</label>
            <input value={form.damage_summary} onChange={(e) => set('damage_summary', e.target.value)} className={FIELD} placeholder="e.g. rear bumper damage" />
          </div>

          {wasDecided && (
            <div>
              <label className={LABEL}>Reason for change (required)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD} placeholder="Why is this being re-verified?" />
            </div>
          )}

          {err && <div className="text-[11px] text-red-300 border border-red-700 bg-red-950/40 px-2 py-1">{err}</div>}

          {/* Verify/edit history — the audited "change function" made visible. */}
          {history && history.length > 0 && (
            <div className="border border-border-default">
              <button type="button" onClick={() => setShowHistory((v) => !v)}
                className="w-full px-2 py-1 flex items-center justify-between text-[9px] uppercase tracking-wider text-fg-muted hover:text-fg-muted">
                <span className="flex items-center gap-1"><History className="w-3 h-3" /> History ({history.length})</span>
                <span>{showHistory ? '−' : '+'}</span>
              </button>
              {showHistory && (
                <ul className="border-t border-border-default divide-y divide-[var(--border-subtle)]">
                  {history.map((h) => (
                    <li key={h.id} className="px-2 py-1 text-[10px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[color:var(--field-label-color)]">{h.user_name || 'Officer'}</span>
                        <span className="text-fg-muted">{String(h.created_at).slice(5, 16)}</span>
                      </div>
                      {h.details && <div className="text-fg-muted mt-0.5 break-words">{h.details}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" disabled={!!busy} onClick={() => submit('confirm')}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-bold uppercase py-2 border border-green-700 text-green-400 hover:bg-green-950 disabled:opacity-40">
              <ShieldCheck className="w-3.5 h-3.5" /> {busy === 'confirm' ? '…' : 'Confirm'}
            </button>
            <button type="button" disabled={!!busy} onClick={() => submit('save')}
              className="flex items-center justify-center gap-1 text-[11px] font-bold uppercase py-2 px-3 border border-accent-gold-300 text-[color:var(--field-label-color)] hover:bg-surface-deep disabled:opacity-40">
              <Save className="w-3.5 h-3.5" /> {busy === 'save' ? '…' : 'Save'}
            </button>
            <button type="button" disabled={!!busy} onClick={() => submit('reject')}
              className="flex items-center justify-center gap-1 text-[11px] font-bold uppercase py-2 px-3 border border-red-800 text-red-400 hover:bg-red-950 disabled:opacity-40">
              <Ban className="w-3.5 h-3.5" /> {busy === 'reject' ? '…' : 'Reject'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
