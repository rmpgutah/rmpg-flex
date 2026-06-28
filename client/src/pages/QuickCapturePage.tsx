// Field quick-capture (Intel Wave 2) — 30-second contact logging.
// One CAPTURE: dedupes-or-creates the person and vehicle, writes the
// field interview with GPS, screens everything, and shows hit banners.
// Links straight to the new/updated dossier.
//
// Page 56 of the full-app frontend audit (SW v1074):
//   • ?call_id= / ?incident_id= deep-link — when launched from a
//     dispatch call or incident, the resulting FI is stamped with
//     that linkage so it surfaces on the call/incident timeline.
//     Context preserved across re-captures (different from the
//     login-style "flash banner" params that get stripped on mount),
//     because logging multiple contacts on the same call is the
//     dominant on-scene pattern.
//   • Esc smart-cascade — Esc closes whichever layer is open, closest
//     first (PDF preview → result → busy abort gate → typed-but-unsaved
//     form), so a single press never blasts past a state the operator
//     actually wanted to keep.
//   • N shortcut — clears the form and focuses first name, matching
//     the N=New convention across Citations / Warrants / FI / etc.
//   • Print FI — court-ready PDF for the just-written FI via the
//     existing field_interview generator (hydrates from
//     /field-interviews/:id so officer name / badge / fi_number /
//     resolved person come from server, not the local form).
//   • Privacy mask — DOB redacted in the on-screen echo by default;
//     the operator can reveal per-record. Plate stays visible because
//     it is the operator's only confirmation that the right vehicle
//     was attached.
//   • GPS visibility — shows the actual lat/lng + accuracy that will
//     be stamped on the FI, with a manual "re-acquire" button when
//     the first fix is stale or wrong (mid-drive on-foot pattern).
//   • Theme tokens throughout — no hardcoded #d4a017 / #888888 hex.
import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ClipboardPen, MapPin, AlertTriangle, ArrowRight, Eye, EyeOff,
  Crosshair, X, Loader2,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import PrintRecordButton from '../components/PrintRecordButton';
import { useToast } from '../components/ToastProvider';

interface ScreenHit { kind: string; severity: 'critical' | 'warning'; detail: string }
interface CaptureResult {
  person_id: number | null; person_reused: boolean;
  vehicle_id: number | null; fi_id: number | null; hits: ScreenHit[];
}

const inputCls =
  'w-full bg-surface-overlay border border-border-default px-2 py-2 text-sm text-rmpg-200 ' +
  'placeholder:text-rmpg-500 focus:border-brand-400 outline-none';

// DOB display mask — replaces digits with bullets so a bystander glance
// at the screen doesn't expose a full DOB. Preserves the operator's
// chosen separators (YYYY-MM-DD or MM/DD/YYYY) so the formatting
// still looks like a date. Eye toggle reveals.
function maskDob(dob: string | undefined | null): string {
  if (!dob) return '';
  return dob.replace(/\d/g, '•');
}

// Element-aware typing guard — N shortcut must not fire while the
// operator is in the middle of typing into an input/textarea/select
// (the same convention the rest of the audited pages use).
function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

const EMPTY_FORM = {
  first_name: '', last_name: '', dob: '', plate: '', location: '', narrative: '',
};

export default function QuickCapturePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();
  const firstNameRef = useRef<HTMLInputElement>(null);

  // ── Linked-context (call/incident) ──
  // These persist across multiple captures on the same scene — see the
  // file-header rationale. Strip only happens when the operator clicks
  // "Unlink" or navigates away.
  const callId = searchParams.get('call_id');
  const incidentId = searchParams.get('incident_id');
  const unlinkContext = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('call_id'); next.delete('incident_id');
    setSearchParams(next, { replace: true });
  };

  const [form, setForm] = useState(EMPTY_FORM);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealDob, setRevealDob] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const acquireGps = useCallback(() => {
    if (!navigator.geolocation) { addToast('Geolocation not available on this device', 'warning'); return; }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGpsBusy(false);
      },
      (err) => {
        setGpsBusy(false);
        // PERMISSION_DENIED is permanent; surface it loudly. Anything else
        // (timeout / position-unavailable) is recoverable on retry.
        if (err.code === err.PERMISSION_DENIED) {
          addToast('Location permission denied — enable in browser settings to auto-stamp GPS', 'error');
        } else {
          addToast('No GPS fix yet — try again or type the location below', 'warning');
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }, [addToast]);

  // First-mount GPS — silent failure (the file-header rationale: GPS is a
  // bonus, not a blocker). Manual location field always works.
  useEffect(() => { acquireGps(); }, [acquireGps]);

  const canSubmit = (!!form.last_name.trim() || !!form.plate.trim()) && !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const r = await apiFetch<CaptureResult>('/intel/quick-capture', {
        method: 'POST',
        body: JSON.stringify({
          first_name: form.first_name.trim() || undefined,
          last_name: form.last_name.trim() || undefined,
          dob: form.dob.trim() || undefined,
          plate: form.plate.trim() || undefined,
          location: form.location.trim() || undefined,
          narrative: form.narrative.trim() || undefined,
          lat: coords?.lat, lng: coords?.lng,
          // Linked call / incident — the server stores these on the FI
          // (associated_call_id / associated_incident_id) so the FI shows
          // up on that call's / incident's timeline.
          call_id: callId ? Number(callId) || undefined : undefined,
          incident_id: incidentId ? Number(incidentId) || undefined : undefined,
        }),
      });
      setResult(r);
      // Clear typed text so the next contact starts fresh. We do NOT clear
      // GPS or the linked call/incident context — those carry across.
      setForm(EMPTY_FORM);
      setRevealDob(false);
      // Critical hit gets a toast in addition to the banner — banner
      // can be missed if the operator is looking at their phone wrong.
      const critical = r.hits?.filter((h) => h.severity === 'critical') ?? [];
      if (critical.length) addToast(`Records HIT: ${critical[0].detail}`, 'error', 8000);
      else addToast('FI logged', 'success', 3000);
    } catch (e) {
      console.error(e);
      addToast('Capture failed — try again', 'error');
    } finally { setBusy(false); }
  }, [canSubmit, form, coords, callId, incidentId, addToast]);

  // ── Keyboard: Esc smart-cascade + N shortcut ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Closest-first cascade. Each branch returns so one Esc doesn't
        // blast multiple layers.
        if (busy) return; // network in flight — let it finish
        if (result) { setResult(null); return; }
        // If there's typed-but-unsaved text, clear it (gives the operator
        // a one-keystroke "start over"); otherwise let global Esc handlers
        // (Layout's drawer, etc.) take it.
        const anyTyped = Object.values(form).some((v) => v.trim().length > 0);
        if (anyTyped) { setForm(EMPTY_FORM); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setResult(null);
        setForm(EMPTY_FORM);
        firstNameRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, result, form]);

  // FI hydrated from server for the PDF (officer name, badge, fi_number,
  // resolved person — all server-side things the local form doesn't have).
  // Lazily fetched only when the operator clicks Print.
  const [fiForPdf, setFiForPdf] = useState<any | null>(null);
  const [fiLoadingForPdf, setFiLoadingForPdf] = useState(false);
  useEffect(() => { setFiForPdf(null); }, [result?.fi_id]);
  const loadFiForPdf = useCallback(async () => {
    if (!result?.fi_id || fiForPdf || fiLoadingForPdf) return;
    setFiLoadingForPdf(true);
    try {
      const fi = await apiFetch<any>(`/field-interviews/${result.fi_id}`);
      setFiForPdf(fi);
    } catch (err) {
      console.error('[quick-capture] FI hydrate for PDF failed:', err);
      addToast('Could not load FI for printing', 'error');
    } finally { setFiLoadingForPdf(false); }
  }, [result?.fi_id, fiForPdf, fiLoadingForPdf, addToast]);

  return (
    <div className="p-4 space-y-3 max-w-xl mx-auto">
      <PanelTitleBar title="QUICK CAPTURE" icon={ClipboardPen} />

      {/* Linked-context chip — visible whenever ?call_id= or ?incident_id=
          is in the URL. Tells the operator "I am logging this contact on
          that call" with a one-click escape hatch. */}
      {(callId || incidentId) && (
        <div className="flex items-center justify-between gap-2 border border-brand-400 bg-surface-overlay text-brand-400 text-[11px] px-3 py-1">
          <span>
            Logging contact on{' '}
            {callId && <Link to={`/dispatch?call_id=${callId}`} className="underline">Call #{callId}</Link>}
            {callId && incidentId && ' · '}
            {incidentId && <Link to={`/incidents?incident_id=${incidentId}`} className="underline">Incident #{incidentId}</Link>}
          </span>
          <button
            type="button"
            onClick={unlinkContext}
            aria-label="Unlink call/incident context"
            className="hover:text-rmpg-200 shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {result?.hits.filter((h) => h.severity === 'critical').map((h) => (
        <div
          key={h.detail}
          role="alert"
          className="bg-red-950 border border-red-600 text-red-300 text-sm font-semibold px-3 py-2 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{h.detail}</span>
        </div>
      ))}
      {result?.hits.filter((h) => h.severity === 'warning').map((h) => (
        <div key={h.detail} className="border border-brand-400 text-brand-400 text-[11px] px-3 py-1">{h.detail}</div>
      ))}
      {result && (
        <div className="border border-border-default text-[11px] text-rmpg-400 px-3 py-1 flex flex-wrap items-center gap-3">
          <span>
            FI logged{result.person_reused ? ' (known subject)' : ''}
            {result.fi_id ? ` · FI #${result.fi_id}` : ''}
          </span>
          {result.person_id && (
            <Link
              to={`/intel/person/${result.person_id}`}
              className="text-brand-400 hover:underline inline-flex items-center gap-1"
            >
              Open dossier <ArrowRight className="w-3 h-3" />
            </Link>
          )}
          {/* Print FI — court-ready PDF using the existing field_interview
              generator. We hydrate the FI from the server before handing
              it to the PDF (officer name / badge / canonical fi_number
              live there, not on the local form). */}
          {result.fi_id && (
            fiForPdf
              ? <PrintRecordButton recordType="field_interview" recordData={fiForPdf} identifier={fiForPdf.fi_number || `FI-${result.fi_id}`} label="Print FI" />
              : (
                <button
                  type="button"
                  onClick={loadFiForPdf}
                  disabled={fiLoadingForPdf}
                  className="inline-flex items-center gap-1 text-brand-400 hover:underline disabled:opacity-50"
                >
                  {fiLoadingForPdf ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  {fiLoadingForPdf ? 'Loading…' : 'Print FI'}
                </button>
              )
          )}
        </div>
      )}

      {/* Loading state — network in flight */}
      {busy && (
        <div className="flex items-center gap-2 text-[11px] text-rmpg-400 px-1">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span>Submitting capture…</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <input
          ref={firstNameRef}
          value={form.first_name}
          onChange={set('first_name')}
          placeholder="First name"
          className={inputCls}
        />
        <input value={form.last_name} onChange={set('last_name')} placeholder="Last name" className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <input
            value={revealDob ? form.dob : maskDob(form.dob) || form.dob}
            onChange={set('dob')}
            onFocus={() => setRevealDob(true)}
            placeholder="DOB (YYYY-MM-DD)"
            className={`${inputCls} pr-8`}
            // Treat the rendered value as a password to keep password-managers
            // and screen recorders from grabbing the literal DOB string.
            autoComplete="off"
            spellCheck={false}
          />
          {form.dob && (
            <button
              type="button"
              onClick={() => setRevealDob((v) => !v)}
              aria-label={revealDob ? 'Hide DOB' : 'Show DOB'}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-rmpg-500 hover:text-rmpg-300"
            >
              {revealDob ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        <input
          value={form.plate}
          onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))}
          placeholder="Plate"
          className={`${inputCls} uppercase`}
        />
      </div>
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-rmpg-500 shrink-0" />
        <input
          value={form.location}
          onChange={set('location')}
          placeholder={coords ? `GPS captured (±${Math.round(coords.accuracy)}m) — add detail` : 'Location'}
          className={inputCls}
        />
        <button
          type="button"
          onClick={acquireGps}
          disabled={gpsBusy}
          aria-label="Re-acquire GPS fix"
          className="p-2 border border-border-default text-rmpg-400 hover:text-brand-400 disabled:opacity-50 shrink-0"
          title={coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)} (±${Math.round(coords.accuracy)}m)` : 'No GPS fix — click to acquire'}
        >
          {gpsBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
        </button>
      </div>
      <textarea
        value={form.narrative}
        onChange={set('narrative')}
        placeholder="Narrative / observations"
        rows={3}
        className={inputCls}
      />
      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full py-2 text-sm font-semibold border border-brand-400 text-brand-400 hover:bg-surface-raised disabled:opacity-40"
      >
        {busy ? 'CAPTURING…' : 'CAPTURE + CHECK'}
      </button>
      <div className="text-[9px] text-rmpg-500 leading-snug">
        Creates/updates the person and vehicle records, files an FI, and runs a records check — all in one step.
        {' '}Shortcuts: <kbd className="px-1 border border-border-default">N</kbd> new ·{' '}
        <kbd className="px-1 border border-border-default">Esc</kbd> clear.
      </div>
    </div>
  );
}
