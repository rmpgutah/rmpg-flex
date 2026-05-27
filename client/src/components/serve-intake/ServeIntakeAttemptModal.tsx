// ============================================================
// RMPG Flex — Serve Intake: log a service attempt
// ============================================================
// Slim modal opened from the intake success card. Lets the officer
// log a single service attempt against a serve_queue entry without
// going through the full ServeAttemptModal wizard (which targets
// the legacy /api/process-server endpoint).
//
// Flow:
//   1. Officer picks a result (served / no_answer / refused / etc.).
//   2. Optionally adds attempt_type (personal / substitute / posting / mail),
//      free-form notes, and captures GPS via the browser.
//   3. POST /api/serve-intake/:id/attempts (the handler auto-bumps
//      attempt_count and transitions queue status).
//   4. Server response is shown to officer + the diligence helper
//      (serveIntakeDiligence.ts) suggests when to come back next.
//
// Photo + signature capture are intentionally deferred — adding them
// requires R2 upload wiring + SignaturePad reuse. Officers can edit
// the attempt later with those once a /:id/attempts/:attemptId PATCH
// route exists. For now, notes carry that information.
// ============================================================

import { useState, useCallback, useEffect } from 'react';
import { X, MapPin, Send, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import IconButton from '../IconButton';
import {
  type AttemptResult,
  type AttemptWindow,
  nextAttemptWindow,
} from '../../utils/serveIntakeDiligence';

interface ServeIntakeAttemptModalProps {
  isOpen: boolean;
  onClose: () => void;
  queueId: number;
  recipientName: string;
  recipientAddress: string;
  callNumber?: string | null;
  /** Called with the server's response on successful submit. */
  onSuccess?: (resp: { id: number; attempt_number: number; queue_status: string }) => void;
}

// Result options — labels match the migration's CHECK constraint values.
const RESULTS: { value: AttemptResult; label: string; tone: 'good' | 'neutral' | 'bad' }[] = [
  { value: 'served',      label: 'Served (personal)',      tone: 'good' },
  { value: 'sub_served',  label: 'Substitute served',      tone: 'good' },
  { value: 'posted',      label: 'Posted & mailed',        tone: 'good' },
  { value: 'no_answer',   label: 'No answer at door',      tone: 'neutral' },
  { value: 'refused',     label: 'Refused service',        tone: 'neutral' },
  { value: 'bad_address', label: 'Bad address',            tone: 'bad' },
  { value: 'moved',       label: 'Moved away',             tone: 'bad' },
  { value: 'deceased',    label: 'Recipient deceased',     tone: 'bad' },
  { value: 'other',       label: 'Other',                  tone: 'neutral' },
];

const ATTEMPT_TYPES = [
  { value: 'personal',   label: 'Personal' },
  { value: 'substitute', label: 'Substitute' },
  { value: 'posting',    label: 'Posting' },
  { value: 'mail',       label: 'Mail' },
];

function toneClass(tone: 'good' | 'neutral' | 'bad'): string {
  switch (tone) {
    case 'good':    return 'border-green-700/50 text-green-300 hover:bg-green-900/30';
    case 'bad':     return 'border-red-700/50 text-red-300 hover:bg-red-900/30';
    case 'neutral': return 'border-amber-700/50 text-amber-300 hover:bg-amber-900/30';
  }
}

export default function ServeIntakeAttemptModal({
  isOpen,
  onClose,
  queueId,
  recipientName,
  recipientAddress,
  callNumber,
  onSuccess,
}: ServeIntakeAttemptModalProps) {
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [attemptType, setAttemptType] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [gps, setGps] = useState<{ lat: number | null; lng: number | null; loading: boolean; error: string | null }>({
    lat: null, lng: null, loading: false, error: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedWindow, setSubmittedWindow] = useState<AttemptWindow | null>(null);
  const [serverResp, setServerResp] = useState<{ id: number; attempt_number: number; queue_status: string } | null>(null);

  // Auto-acquire GPS when the modal opens — most attempts are logged
  // while standing at the address, so GPS is useful telemetry.
  useEffect(() => {
    if (!isOpen) return;
    setGps((s) => ({ ...s, loading: true, error: null }));
    if (!('geolocation' in navigator)) {
      setGps({ lat: null, lng: null, loading: false, error: 'Geolocation not available.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, loading: false, error: null }),
      (err) => setGps({ lat: null, lng: null, loading: false, error: err.message }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    if (!result) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = localStorage.getItem('rmpg_token');
      const resp = await fetch(`/api/serve-intake/${queueId}/attempts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          result,
          attempt_type: attemptType || null,
          notes: notes || null,
          latitude: gps.lat,
          longitude: gps.lng,
        }),
      });
      if (!resp.ok) {
        throw new Error(`Server returned ${resp.status}: ${await resp.text().catch(() => '')}`);
      }
      const body = await resp.json() as { id: number; attempt_number: number; queue_status: string };
      setServerResp(body);
      // Compute the diligence recommendation from the user-written helper.
      const now = new Date();
      setSubmittedWindow(nextAttemptWindow(result, body.attempt_number, now.getHours(), now.getDay()));
      onSuccess?.(body);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to log attempt');
    }
    setSubmitting(false);
  }, [result, attemptType, notes, gps, queueId, onSuccess]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface-base border border-[#222] rounded-sm w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222] sticky top-0 bg-surface-base">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-rmpg-500 font-bold">Log Service Attempt</div>
            <div className="text-sm text-white font-bold truncate">{recipientName}</div>
            <div className="text-[10px] text-rmpg-400 truncate">
              {recipientAddress}
              {callNumber && <span className="ml-2 text-brand-400">· {callNumber}</span>}
            </div>
          </div>
          <IconButton onClick={onClose} aria-label="Close attempt modal">
            <X className="w-4 h-4" />
          </IconButton>
        </div>

        {/* After-submit panel */}
        {serverResp && (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="w-5 h-5" />
              <div className="text-sm font-bold">
                Attempt #{serverResp.attempt_number} logged · Queue status: {serverResp.queue_status}
              </div>
            </div>
            {submittedWindow && !submittedWindow.terminal && (
              <div className="border border-amber-700/50 bg-amber-900/20 rounded-sm p-3 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">Suggested next attempt</div>
                <div className="text-sm text-white">
                  {submittedWindow.dayOffset === 0 ? 'Later today'
                    : submittedWindow.dayOffset === 1 ? 'Tomorrow'
                    : `In ${submittedWindow.dayOffset} days`}
                  {submittedWindow.window ? ` — ${submittedWindow.window}` : ''}
                </div>
                <div className="text-[11px] text-rmpg-400 italic">{submittedWindow.reasoning}</div>
              </div>
            )}
            {submittedWindow?.terminal && (
              <div className="border border-rmpg-700 bg-surface-raised rounded-sm p-3">
                <div className="text-[11px] text-rmpg-400 italic">{submittedWindow.reasoning}</div>
              </div>
            )}
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs uppercase rounded-sm"
            >
              Close
            </button>
          </div>
        )}

        {/* Form */}
        {!serverResp && (
          <div className="p-4 space-y-4">
            {/* Result */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2">Result *</div>
              <div className="grid grid-cols-3 gap-1.5">
                {RESULTS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setResult(r.value)}
                    className={`text-[10px] font-bold px-2 py-2 border rounded-sm transition-colors ${
                      result === r.value
                        ? `${toneClass(r.tone)} bg-${r.tone === 'good' ? 'green' : r.tone === 'bad' ? 'red' : 'amber'}-900/40`
                        : `${toneClass(r.tone)} opacity-60`
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Attempt type (optional) */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2">Type</div>
              <div className="flex gap-1.5">
                {ATTEMPT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setAttemptType(attemptType === t.value ? '' : t.value)}
                    className={`flex-1 text-[10px] font-bold px-2 py-1.5 border rounded-sm transition-colors ${
                      attemptType === t.value
                        ? 'border-brand-500 bg-brand-900/40 text-brand-300'
                        : 'border-[#2e2e2e] text-rmpg-400 hover:bg-surface-raised'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2">Notes</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Description, recipient demographics, witness, etc."
                className="w-full bg-surface-sunken border border-[#2e2e2e] rounded-sm px-2 py-1.5 text-xs text-white placeholder:text-rmpg-600 focus:outline-none focus:border-brand-500"
              />
            </div>

            {/* GPS state */}
            <div className="flex items-center gap-2 text-[10px] text-rmpg-400">
              <MapPin className="w-3.5 h-3.5" />
              {gps.loading && <span><Loader2 className="w-3 h-3 inline animate-spin" /> Acquiring GPS…</span>}
              {!gps.loading && gps.lat != null && (
                <span className="text-green-400 font-mono">
                  {gps.lat.toFixed(5)}, {gps.lng?.toFixed(5)}
                </span>
              )}
              {!gps.loading && gps.error && (
                <span className="text-amber-400">GPS unavailable: {gps.error}</span>
              )}
            </div>

            {submitError && (
              <div className="flex items-center gap-2 text-red-400 text-xs">
                <AlertTriangle className="w-4 h-4" />
                {submitError}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 border border-[#2e2e2e] text-rmpg-400 hover:bg-surface-raised text-xs font-bold uppercase rounded-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!result || submitting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:bg-rmpg-800 disabled:text-rmpg-600 text-white font-bold text-xs uppercase rounded-sm transition-colors"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                ) : (
                  <><Send className="w-4 h-4" /> Log Attempt</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
