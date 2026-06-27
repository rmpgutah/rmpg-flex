import React, { useState, useEffect, useCallback, useMemo } from 'react';
import RichTextArea from '../RichTextArea';
import {
  X, MapPin, FileText, Camera, Send, CheckCircle, AlertTriangle,
  Loader2, Navigation, Trash2,
} from 'lucide-react';
import SignaturePad from '../SignaturePad';
import { apiFetch } from '../../hooks/useApi';
import type { ServeJob, ServeAttemptData } from '../../types';
import {
  PSO_CATEGORIES, codesInCategory, lookupPsoCode,
  type PsoCategory,
} from '../../constants/processServiceCodes';

// ─── Types ──────────────────────────────────────────────────────────────

interface ServeAttemptModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: ServeJob;
  onSubmit: (attempt: ServeAttemptData) => Promise<{
    dueDiligenceComplete?: boolean;
    attemptNumber?: number;
    jobStatus?: string;
  }>;
  onGenerateAffidavit?: (jobId: number) => void;
}

interface GpsState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  loading: boolean;
  error: string | null;
}

type AttemptType = 'personal' | 'substitute' | 'posting' | 'failed';
type FailedReason = 'no_answer' | 'refused' | 'wrong_address' | 'moved' | 'other';

// Categories the operator can pick from in the failed-fast-path picker.
// Every category is available, but the picker auto-suggests Non-Service /
// Evasion / Administrative when the operator hasn't typed an attempt type.
const FAILED_CATEGORIES: PsoCategory['code'][] = ['PS/00', 'PS/15', 'PS/40'];
// Categories surfaced on the "successful service" picker for personal /
// substitute / posting attempt types.
const SUCCESS_CATEGORIES: Record<AttemptType, PsoCategory['code'][]> = {
  personal:   ['PS/05'],
  substitute: ['PS/10'],
  posting:    ['PS/20'],
  failed:     FAILED_CATEGORIES,
};

// Step labels are derived at render time from attemptType — failed attempts
// collapse to a 3-step flow (Location → Reason → Submit) since they're
// unsworn and skip the signature step. See computeSteps() below.
const STEPS_FULL = ['Location', 'Type', 'Documentation', 'Submit'] as const;
const STEPS_FAILED = ['Location', 'Reason', 'Submit'] as const;

// Hard cap matches the Notice-of-Attempt PDF column (MAX_NOTE_CHARS = 90
// in servePdfGenerator.ts). Going past this point silently truncates on
// the recipient-facing notice, so the modal warns at threshold rather than
// at submit time. Mirror any change to that constant.
const NOTES_CHAR_LIMIT = 90;

const AGE_RANGES = ['Under 18', '18-25', '26-35', '36-45', '46-55', '56-65', 'Over 65'];
const HAIR_COLORS = ['Black', 'Brown', 'Blonde', 'Red', 'Gray', 'White', 'Bald', 'Other'];
const RELATIONSHIPS = ['Spouse', 'Roommate', 'Coworker', 'Family Member', 'Other'];

// Build a human-readable next-attempt sentence from the picker fields.
// Returns '' when nothing is filled in so callers can no-op cleanly.
function formatNextAttempt(dateStr: string, start: string, end: string): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const dayLabel = d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });
  if (start && end) return `Will return ${dayLabel} between ${fmtHm(start)} and ${fmtHm(end)}.`;
  if (start) return `Will return ${dayLabel} at ${fmtHm(start)}.`;
  return `Will return ${dayLabel}.`;
}
function fmtHm(hm: string): string {
  // 'HH:mm' → '6:00 PM'. Returns input unchanged if it isn't a valid time.
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return hm;
  const h24 = parseInt(m[1], 10);
  const min = m[2];
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${min} ${period}`;
}

// ─── Haversine Distance ─────────────────────────────────────────────────

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServeAttemptModal({
  isOpen,
  onClose,
  job,
  onSubmit,
  onGenerateAffidavit,
}: ServeAttemptModalProps) {
  const [step, setStep] = useState(0);

  // Step 1 — GPS
  const [gps, setGps] = useState<GpsState>({
    latitude: null, longitude: null, accuracy: null,
    loading: true, error: null,
  });

  // Step 2 — Type
  const [attemptType, setAttemptType] = useState<AttemptType | null>(null);
  const [failedReason, setFailedReason] = useState<FailedReason | null>(null);
  // Free-text reason captured only when failedReason === 'other'. Persisted
  // by prepending to the notes column on submit (no dedicated column).
  const [customReason, setCustomReason] = useState('');
  // Structured PS code — the new source of truth. Picker writes here; submit
  // sends it as `disposition_code`. The server derives the legacy `result`
  // enum from the code, so we only fill `failedReason` for the legacy code
  // path (no structured pick).
  const [dispositionCode, setDispositionCode] = useState<string>('');
  // Category the operator drilled into on the structured picker. UI-only
  // state — drives which sub-codes are listed below the category buttons.
  const [pickerCategory, setPickerCategory] = useState<string | null>(null);

  // Next-attempt window — operator-set, lives on the parent serve_queue row,
  // surfaced verbatim on the Notice of Attempt PDF. The picker builds a
  // sentence; the operator can override it via the editable text field.
  const [nextAttemptDate, setNextAttemptDate] = useState('');
  const [nextAttemptStart, setNextAttemptStart] = useState('');
  const [nextAttemptEnd, setNextAttemptEnd] = useState('');
  const [nextAttemptText, setNextAttemptText] = useState('');
  // Once the user edits the text manually, stop overwriting it when they
  // tweak the picker — they may have refined the wording on purpose.
  const [nextAttemptTextDirty, setNextAttemptTextDirty] = useState(false);

  // Step 3 — Documentation
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [ageRange, setAgeRange] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [hairColor, setHairColor] = useState('');
  const [clothing, setClothing] = useState('');
  const [personServedName, setPersonServedName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [notes, setNotes] = useState('');

  // Step 4 — Signature & Submit
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    dueDiligenceComplete?: boolean;
    attemptNumber?: number;
  } | null>(null);

  // ─── GPS Acquisition ────────────────────────────────────────────────

  const acquireGps = useCallback(() => {
    setGps({ latitude: null, longitude: null, accuracy: null, loading: true, error: null });
    if (!navigator.geolocation) {
      setGps(prev => ({ ...prev, loading: false, error: 'Geolocation not available' }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          loading: false,
          error: null,
        });
      },
      (err) => {
        setGps(prev => ({ ...prev, loading: false, error: err?.message || 'GPS error' }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    if (isOpen) {
      acquireGps();
      // Reset all state on open
      setStep(0);
      setAttemptType(null);
      setFailedReason(null);
      setCustomReason('');
      setDispositionCode('');
      setPickerCategory(null);
      setNextAttemptDate('');
      setNextAttemptStart('');
      setNextAttemptEnd('');
      setNextAttemptText('');
      setNextAttemptTextDirty(false);
      setPhotos([]);
      setAgeRange('');
      setHeight('');
      setWeight('');
      setHairColor('');
      setClothing('');
      setPersonServedName('');
      setRelationship('');
      setNotes('');
      setSignature(null);
      setSubmitting(false);
      setSubmitResult(null);
    }
  }, [isOpen, acquireGps]);

  // ─── Picker context ────────────────────────────────────────────────
  // Which top-level PS categories are surfaced for the current attempt
  // type. Failed = Non-Service / Evasion / Admin; Personal / Substitute /
  // Posting = the matching service category. The operator can always drill
  // into all 10 categories via the "Show all categories" toggle below.
  const [showAllCategories, setShowAllCategories] = useState(false);
  const availableCategories = useMemo(() => {
    if (showAllCategories || !attemptType) return PSO_CATEGORIES;
    const suggested = new Set(SUCCESS_CATEGORIES[attemptType] || []);
    return PSO_CATEGORIES.filter((c) => suggested.has(c.code));
  }, [attemptType, showAllCategories]);

  // Whenever the attemptType changes, clear the picker so a stale code
  // from a different category doesn't survive the switch.
  useEffect(() => {
    setDispositionCode('');
    setPickerCategory(null);
    setShowAllCategories(false);
  }, [attemptType]);

  // ─── Next-Attempt Sentence Builder ─────────────────────────────────
  // Rebuild the editable text whenever the picker changes, unless the user
  // has already touched the textarea (then leave their wording alone).
  useEffect(() => {
    if (nextAttemptTextDirty) return;
    setNextAttemptText(formatNextAttempt(nextAttemptDate, nextAttemptStart, nextAttemptEnd));
  }, [nextAttemptDate, nextAttemptStart, nextAttemptEnd, nextAttemptTextDirty]);

  // ─── Distance Warning ───────────────────────────────────────────────

  const distanceFromAddress = (() => {
    if (!gps.latitude || !gps.longitude || !job.recipient_lat || !job.recipient_lng) return null;
    return Math.round(haversineDistance(gps.latitude, gps.longitude, job.recipient_lat, job.recipient_lng));
  })();

  const showDistanceWarning = distanceFromAddress !== null && distanceFromAddress > 200;

  // ─── Photo Upload ──────────────────────────────────────────────────

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remaining = 5 - photos.length;
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length === 0) return;

    setUploading(true);
    try {
      for (const file of toUpload) {
        const formData = new FormData();
        formData.append('file', file);
        const result = await apiFetch<{ id: string; url: string }>('/uploads', {
          method: 'POST',
          body: formData,
        });
        setPhotos(prev => [...prev, { id: result.id, url: result.url }]);
      }
    } catch {
      // upload failed silently — user can retry
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const removePhoto = (id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
  };

  // ─── Build Description String ──────────────────────────────────────

  const buildDescription = (): string => {
    const parts: string[] = [];
    if (ageRange) parts.push(`Age: ${ageRange}`);
    if (height) parts.push(`Height: ${height}`);
    if (weight) parts.push(`Weight: ${weight}`);
    if (hairColor) parts.push(`Hair: ${hairColor}`);
    if (clothing) parts.push(`Clothing: ${clothing}`);
    return parts.join(', ');
  };

  // ─── Submit ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!attemptType) return;
    setSubmitting(true);
    try {
      // When the failed reason is "Other", prepend the operator's free-text
      // explanation to the notes column so it lands on the PDF without a
      // dedicated schema column. Keep the original notes underneath.
      const composedNotes = (() => {
        const reasonPrefix = (attemptType === 'failed'
          && failedReason === 'other'
          && customReason.trim())
          ? `Reason: ${customReason.trim()}.`
          : '';
        return [reasonPrefix, (notes || '').trim()].filter(Boolean).join(' ');
      })();

      const data: ServeAttemptData = {
        attempt_type: attemptType,
        result: attemptType === 'failed'
          ? (failedReason || 'other')
          : 'served',
        latitude: gps.latitude ?? undefined,
        longitude: gps.longitude ?? undefined,
        gps_accuracy: gps.accuracy ?? undefined,
        address_verified: !showDistanceWarning,
        photo_ids: photos.map(p => p.id),
        // Failed attempts are unsworn — the wizard skips signature capture
        // entirely for them, so don't force an empty signature payload.
        signature_data: attemptType === 'failed' ? undefined : (signature ?? undefined),
        notes: composedNotes || undefined,
        next_attempt_note: nextAttemptText.trim() || undefined,
        // Structured code wins on the server — codeToLegacyResult derives the
        // CHECK-enum `result` from it. Only set when the operator actually
        // picked one (failed-fast-path picker, or the structured picker on
        // successful attempts).
        disposition_code: dispositionCode || undefined,
      };

      if (attemptType === 'personal' || attemptType === 'substitute') {
        data.person_served_description = buildDescription() || undefined;
      }
      if (attemptType === 'substitute') {
        data.person_served_name = personServedName || undefined;
        data.person_served_relationship = relationship || undefined;
      }

      const result = await onSubmit(data);
      setSubmitResult(result);
    } catch {
      // error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Failed attempts walk the 3-step fast path (Location → Reason → Submit).
  // Anything else (or before a type is picked) uses the full 4-step flow.
  // Keeping this as a runtime read means the indicator + nav both stay in
  // sync with whatever the user just picked on Step 1.
  const activeSteps: readonly string[] = attemptType === 'failed' ? STEPS_FAILED : STEPS_FULL;
  const isFailedPath = attemptType === 'failed';

  // The wizard's `step` value is the renderStep case index (0..3). For the
  // failed path, the Documentation case (step=2) is bypassed entirely, so
  // map it down to the displayed indicator position before rendering.
  const displayStep = isFailedPath ? (step === 3 ? 2 : Math.min(step, 1)) : step;

  // Step-aware forward/back: failed jumps Step 1 → Step 3, skipping Docs.
  const goNext = () => setStep((s) => (isFailedPath && s === 1 ? 3 : s + 1));
  const goBack = () => setStep((s) => (isFailedPath && s === 3 ? 1 : Math.max(0, s - 1)));

  // ─── Step Indicator ────────────────────────────────────────────────

  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-0 py-3 px-4" role="navigation" aria-label="Step progress">
      {activeSteps.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 && (
            <div className={`h-0.5 w-8 sm:w-12 transition-colors duration-300 ${i <= displayStep ? 'bg-green-500' : 'bg-rmpg-600'}`} />
          )}
          <div className="flex flex-col items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-200 ${
              i < displayStep
                ? 'bg-green-600 border-green-500 text-rmpg-100 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                : i === displayStep
                  ? 'bg-[#d4a017] border-[#d4a017] text-rmpg-100 shadow-[0_0_6px_#d4a017]'
                  : 'bg-rmpg-700 border-rmpg-500 text-rmpg-400'
            }`}>
              {i < displayStep ? <CheckCircle className="w-4 h-4" /> : i + 1}
            </div>
            <span className={`text-[10px] font-semibold transition-colors duration-200 ${
              i <= displayStep ? 'text-rmpg-200' : 'text-rmpg-500'
            }`}>{label}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );

  // ─── Attempt Type Cards ────────────────────────────────────────────

  const typeCards: {
    type: AttemptType;
    icon: React.ReactNode;
    label: string;
    desc: string;
    disabled?: boolean;
    tooltip?: string;
  }[] = [
    { type: 'personal', icon: <Send className="w-5 h-5" />, label: 'Personal Service', desc: 'Handed directly to the named person' },
    { type: 'substitute', icon: <FileText className="w-5 h-5" />, label: 'Substitute Service', desc: 'Left with another person at the address' },
    {
      type: 'posting',
      icon: <MapPin className="w-5 h-5" />,
      label: 'Posting',
      desc: 'Affixed to door/premises',
      disabled: job.attempt_count < 2,
      tooltip: job.attempt_count < 2 ? 'Requires 2+ prior failed attempts' : undefined,
    },
    { type: 'failed', icon: <X className="w-5 h-5" />, label: 'Failed Attempt', desc: 'Unable to complete service' },
  ];

  // ─── Render Steps ──────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {
      // ─── Step 1: Location ──────────────────────────────────
      case 0:
        return (
          <div className="space-y-4 p-4">
            <h3 className="text-sm font-bold text-rmpg-200 flex items-center gap-2">
              <Navigation className="w-4 h-4 text-brand-400" />
              Arrival Confirmation
            </h3>

            {gps.loading ? (
              <div className="flex flex-col items-center gap-3 py-8 text-rmpg-400">
                <div className="relative">
                  <Loader2 className="w-8 h-8 animate-spin text-[#888888]" />
                  <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-500 animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
                </div>
                <span className="text-sm">Acquiring GPS position...</span>
              </div>
            ) : gps.error ? (
              <div className="bg-red-900/30 border border-red-700 rounded-sm p-3 text-sm text-red-300">
                <p>GPS Error: {gps.error}</p>
                <button type="button"
                  onClick={acquireGps}
                  className="mt-2 px-3 py-1 text-xs bg-red-800 hover:bg-red-700 text-red-200 rounded-sm"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-surface-sunken border border-rmpg-700 rounded-[2px] p-2">
                    <div className="text-[10px] text-[#d4a017] uppercase font-semibold tracking-wider">Latitude</div>
                    <div className="text-sm text-rmpg-100 font-mono">{gps.latitude?.toFixed(6)}</div>
                  </div>
                  <div className="bg-surface-sunken border border-rmpg-700 rounded-[2px] p-2">
                    <div className="text-[10px] text-[#d4a017] uppercase font-semibold tracking-wider">Longitude</div>
                    <div className="text-sm text-rmpg-100 font-mono">{gps.longitude?.toFixed(6)}</div>
                  </div>
                  <div className="bg-surface-sunken border border-rmpg-700 rounded-[2px] p-2">
                    <div className="text-[10px] text-[#d4a017] uppercase font-semibold tracking-wider">Accuracy</div>
                    <div className="text-sm text-rmpg-100 font-mono">{gps.accuracy}m</div>
                  </div>
                </div>

                {showDistanceWarning && (
                  <div className="bg-yellow-900/30 border border-yellow-700 rounded-sm p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-yellow-300">
                      You appear to be {distanceFromAddress}m from the service address
                    </span>
                  </div>
                )}

                {distanceFromAddress !== null && !showDistanceWarning && (
                  <div className="bg-green-900/20 border border-green-800 rounded-sm p-3 flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-green-300">
                      Location verified ({distanceFromAddress}m from service address)
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button type="button"
                onClick={() => setStep(1)}
                disabled={gps.loading}
                className="px-4 py-2 text-sm font-semibold bg-[#888888] hover:bg-[#888888]/80 text-rmpg-100 rounded-[2px] disabled:opacity-40 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50 hover:shadow-[0_0_8px_rgba(212,160,23,0.25)]"
              >
                Confirm Location
              </button>
            </div>
          </div>
        );

      // ─── Step 2: Type ──────────────────────────────────────
      case 1:
        return (
          <div className="space-y-4 p-4">
            <h3 className="text-sm font-bold text-[#d4a017]">Select Attempt Type</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {typeCards.map((card) => (
                <div key={card.type} className="relative group">
                  <button type="button"
                    disabled={card.disabled}
                    onClick={() => {
                      setAttemptType(card.type);
                      if (card.type !== 'failed') setFailedReason(null);
                    }}
                    className={`w-full text-left p-3 rounded-[2px] border-2 transition-all duration-150 panel-beveled ${
                      card.disabled
                        ? 'opacity-40 cursor-not-allowed border-rmpg-700 bg-rmpg-800'
                        : attemptType === card.type
                          ? 'border-[#d4a017] bg-[#d4a017]/5 shadow-[0_0_8px_rgba(212,160,23,0.15)]'
                          : 'border-rmpg-700 bg-surface-sunken hover:border-[#d4a017] hover:bg-surface-base'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={attemptType === card.type ? 'text-brand-400' : 'text-rmpg-400'}>
                        {card.icon}
                      </span>
                      <span className="text-sm font-semibold text-rmpg-100">{card.label}</span>
                    </div>
                    <p className="text-xs text-rmpg-400">{card.desc}</p>
                  </button>
                  {card.tooltip && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-rmpg-900 text-rmpg-300 text-[10px] px-2 py-1 rounded-sm border border-rmpg-600 whitespace-nowrap z-10">
                      {card.tooltip}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {attemptType === 'failed' && (
              <div className="space-y-3">
                <PsoCodePicker
                  attemptType="failed"
                  available={availableCategories}
                  pickerCategory={pickerCategory}
                  setPickerCategory={setPickerCategory}
                  dispositionCode={dispositionCode}
                  setDispositionCode={(c) => {
                    setDispositionCode(c);
                    // Mirror the picked code into failedReason so the legacy
                    // submit path + the Review screen + the older copy that
                    // still reads `failedReason` keep working.
                    const psc = lookupPsoCode(c);
                    if (psc) {
                      const legacyMap: Record<string, FailedReason> = {
                        no_answer: 'no_answer', refused: 'refused',
                        bad_address: 'wrong_address', moved: 'moved',
                      };
                      setFailedReason((legacyMap[psc.result] as FailedReason) || 'other');
                    }
                  }}
                  showAll={showAllCategories}
                  setShowAll={setShowAllCategories}
                />

                {(dispositionCode === 'PS/00.99' || failedReason === 'other') && (
                  <div className="space-y-1">
                    <label htmlFor="ff-serveattemptmodal-other-reason" className="block text-[10px] font-semibold text-rmpg-300 uppercase">
                      Specify reason <span className="text-rmpg-500 normal-case">(prepended to notes on the notice)</span>
                    </label>
                    <input
                      id="ff-serveattemptmodal-other-reason"
                      type="text"
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value.slice(0, 60))}
                      placeholder="e.g., business closed for the day"
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-3 py-2 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888] focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                    />
                  </div>
                )}

                {/* Next-attempt scheduler — optional, only meaningful for
                    failed attempts (a successful service has no next attempt). */}
                <fieldset className="space-y-2 border border-rmpg-700 rounded-[2px] p-3">
                  <legend className="text-[10px] font-semibold text-rmpg-300 uppercase px-1">
                    Next attempt window <span className="text-rmpg-500 normal-case">(optional — shown on the notice)</span>
                  </legend>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label htmlFor="ff-na-date" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Date</label>
                      <input
                        id="ff-na-date"
                        type="date"
                        value={nextAttemptDate}
                        onChange={(e) => setNextAttemptDate(e.target.value)}
                        className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888]"
                      />
                    </div>
                    <div>
                      <label htmlFor="ff-na-start" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">From</label>
                      <input
                        id="ff-na-start"
                        type="time"
                        value={nextAttemptStart}
                        onChange={(e) => setNextAttemptStart(e.target.value)}
                        className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888]"
                      />
                    </div>
                    <div>
                      <label htmlFor="ff-na-end" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">To</label>
                      <input
                        id="ff-na-end"
                        type="time"
                        value={nextAttemptEnd}
                        onChange={(e) => setNextAttemptEnd(e.target.value)}
                        className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888]"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="ff-na-text" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">
                      Notice wording {nextAttemptTextDirty && <span className="text-[#d4a017] normal-case">(edited)</span>}
                    </label>
                    <textarea
                      id="ff-na-text"
                      value={nextAttemptText}
                      onChange={(e) => {
                        setNextAttemptText(e.target.value);
                        setNextAttemptTextDirty(true);
                      }}
                      placeholder="Auto-builds from the picker — or type your own"
                      rows={2}
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888] resize-none"
                    />
                  </div>
                </fieldset>
              </div>
            )}

            {/* Successful flows (personal/substitute/posting) get the same
                code picker, just suggesting the matching service category
                instead of the failed-attempt categories. Operator can hit
                "Show all 10 categories" to widen the picker when they need
                an edge-case code (e.g. PS/40.10 already-served confirmation). */}
            {attemptType && attemptType !== 'failed' && (
              <PsoCodePicker
                attemptType={attemptType}
                available={availableCategories}
                pickerCategory={pickerCategory}
                setPickerCategory={setPickerCategory}
                dispositionCode={dispositionCode}
                setDispositionCode={setDispositionCode}
                showAll={showAllCategories}
                setShowAll={setShowAllCategories}
              />
            )}

            <div className="flex justify-between pt-2">
              <button type="button"
                onClick={goBack}
                className="px-4 py-2 text-sm font-semibold bg-surface-raised hover:bg-surface-raised text-rmpg-200 rounded-[2px] border border-rmpg-700 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50"
              >
                Back
              </button>
              <button type="button"
                onClick={goNext}
                disabled={
                  !attemptType
                  || (attemptType === 'failed' && !dispositionCode && !failedReason)
                }
                className="px-4 py-2 text-sm font-semibold bg-[#888888] hover:bg-[#888888]/80 text-rmpg-100 rounded-[2px] disabled:opacity-40 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50 hover:shadow-[0_0_8px_rgba(212,160,23,0.25)]"
              >
                {isFailedPath ? 'Continue' : 'Next'}
              </button>
            </div>
          </div>
        );

      // ─── Step 3: Documentation ─────────────────────────────
      case 2:
        return (
          <div className="space-y-4 p-4 max-h-[60vh] overflow-y-auto scrollbar-dark">
            <h3 className="text-sm font-bold text-[#d4a017]">Documentation</h3>

            {/* Camera input */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-rmpg-300 uppercase">Photos ({photos.length}/5)</label>
              <label className={`flex items-center justify-center gap-2 px-4 py-3 rounded-sm border-2 border-dashed cursor-pointer transition-colors ${
                photos.length >= 5
                  ? 'border-rmpg-700 text-rmpg-600 cursor-not-allowed'
                  : 'border-rmpg-500 text-rmpg-300 hover:border-brand-500 hover:text-brand-300'
              }`}>
                {uploading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Camera className="w-5 h-5" />
                )}
                <span className="text-sm font-semibold">
                  {uploading ? 'Uploading...' : 'Take Photo'}
                </span>
                <input id="ff-serveattemptmodal-1"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  disabled={photos.length >= 5 || uploading}
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
              </label>

              {photos.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {photos.map((photo) => (
                    <div key={photo.id} className="relative w-16 h-16 rounded-sm border border-rmpg-600 overflow-hidden group">
                      <img src={photo.url} alt="Attempt photo" className="w-full h-full object-cover" />
                      <button type="button"
                        onClick={() => removePhoto(photo.id)}
                        className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-700 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-rmpg-100" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Physical description for personal/substitute */}
            {(attemptType === 'personal' || attemptType === 'substitute') && (
              <fieldset className="space-y-3 border border-rmpg-700 rounded-[2px] p-3">
                <legend className="text-xs font-semibold text-rmpg-300 uppercase px-1">Physical Description</legend>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ff-serveattemptmodal-2" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Age Range</label>
                    <select id="ff-serveattemptmodal-2"
                      value={ageRange}
                      onChange={(e) => setAgeRange(e.target.value)}
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888] focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                    >
                      <option value="">Select...</option>
                      {AGE_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ff-serveattemptmodal-3" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Hair Color</label>
                    <select id="ff-serveattemptmodal-3"
                      value={hairColor}
                      onChange={(e) => setHairColor(e.target.value)}
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888] focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                    >
                      <option value="">Select...</option>
                      {HAIR_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ff-serveattemptmodal-4" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Height</label>
                    <input id="ff-serveattemptmodal-4"
                      type="text"
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                      placeholder="e.g., 5'10"
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888] focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                    />
                  </div>
                  <div>
                    <label htmlFor="ff-serveattemptmodal-5" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Weight</label>
                    <input id="ff-serveattemptmodal-5"
                      type="text"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      placeholder="e.g., 180 lbs"
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888] focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="ff-serveattemptmodal-6" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Clothing Description</label>
                  <input id="ff-serveattemptmodal-6"
                    type="text"
                    value={clothing}
                    onChange={(e) => setClothing(e.target.value)}
                    placeholder="Describe clothing worn"
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888] focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                  />
                </div>
              </fieldset>
            )}

            {/* Substitute-only fields */}
            {attemptType === 'substitute' && (
              <fieldset className="space-y-3 border border-rmpg-700 rounded-[2px] p-3">
                <legend className="text-xs font-semibold text-rmpg-300 uppercase px-1">Person Served</legend>
                <div>
                  <label htmlFor="ff-serveattemptmodal-7" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">
                    Name <span className="text-red-400">*</span>
                  </label>
                  <input id="ff-serveattemptmodal-7"
                    type="text"
                    value={personServedName}
                    onChange={(e) => setPersonServedName(e.target.value)}
                    placeholder="Full name of person served"
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888] focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="ff-serveattemptmodal-8" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Relationship</label>
                  <select id="ff-serveattemptmodal-8"
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[#888888] focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                  >
                    <option value="">Select...</option>
                    {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </fieldset>
            )}

            {/* Notes — with live char counter against the PDF table limit */}
            <NotesField value={notes} onChange={setNotes} />

            <div className="flex justify-between pt-2">
              <button type="button"
                onClick={goBack}
                className="px-4 py-2 text-sm font-semibold bg-surface-raised hover:bg-surface-raised text-rmpg-200 rounded-[2px] border border-rmpg-700 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50"
              >
                Back
              </button>
              <button type="button"
                onClick={goNext}
                disabled={attemptType === 'substitute' && !personServedName.trim()}
                className="px-4 py-2 text-sm font-semibold bg-[#888888] hover:bg-[#888888]/80 text-rmpg-100 rounded-[2px] disabled:opacity-40 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50 hover:shadow-[0_0_8px_rgba(212,160,23,0.25)]"
              >
                Next
              </button>
            </div>
          </div>
        );

      // ─── Step 4: Review & Signature (or fast-path Submit for failed) ─
      case 3:
        return (
          <div className="space-y-4 p-4 max-h-[60vh] overflow-y-auto scrollbar-dark">
            {submitResult ? (
              // Post-submit result
              <div className="space-y-4 text-center py-4">
                <CheckCircle className="w-12 h-12 text-green-400 mx-auto" />
                <h3 className="text-sm font-bold text-rmpg-100">
                  Attempt #{submitResult.attemptNumber} Recorded
                </h3>
                {submitResult.dueDiligenceComplete && (
                  <div className="bg-green-900/30 border border-green-700 rounded-sm p-3 space-y-2">
                    <p className="text-sm text-green-300 font-semibold">
                      Due Diligence Complete -- 3 attempts recorded
                    </p>
                    {onGenerateAffidavit && (
                      <button type="button"
                        onClick={() => onGenerateAffidavit(job.id)}
                        className="px-4 py-2 text-sm font-semibold bg-green-700 hover:bg-green-600 text-rmpg-100 rounded-sm transition-colors"
                      >
                        Generate Affidavit of Non-Service
                      </button>
                    )}
                  </div>
                )}
                <button type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-semibold bg-surface-raised hover:bg-surface-raised text-rmpg-200 rounded-[2px] border border-rmpg-700 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-bold text-[#d4a017]">Review & Submit</h3>

                {/* Summary card */}
                <div className="bg-surface-sunken border border-rmpg-700 rounded-[2px] p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-rmpg-400">Recipient</span>
                    <span className="text-rmpg-100 font-semibold">{job.recipient_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rmpg-400">Type</span>
                    <span className="text-rmpg-100 capitalize">{attemptType?.replace(/_/g, ' ')}</span>
                  </div>
                  {attemptType === 'failed' && failedReason && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Reason</span>
                      <span className="text-rmpg-100 capitalize">
                        {failedReason === 'other' && customReason.trim()
                          ? customReason.trim()
                          : failedReason.replace(/_/g, ' ')}
                      </span>
                    </div>
                  )}
                  {nextAttemptText.trim() && (
                    <div>
                      <span className="text-rmpg-400 text-xs">Next attempt (on notice):</span>
                      <p className="text-rmpg-200 text-xs mt-0.5 italic">{nextAttemptText.trim()}</p>
                    </div>
                  )}
                  {gps.latitude != null && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">GPS</span>
                      <span className="text-rmpg-100 font-mono text-xs">
                        {gps.latitude?.toFixed(6)}, {gps.longitude?.toFixed(6)} ({gps.accuracy}m)
                      </span>
                    </div>
                  )}
                  {distanceFromAddress !== null && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Distance</span>
                      <span className={`font-semibold ${showDistanceWarning ? 'text-yellow-400' : 'text-green-400'}`}>
                        {distanceFromAddress}m from address
                      </span>
                    </div>
                  )}
                  {photos.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Photos</span>
                      <span className="text-rmpg-100">{photos.length} attached</span>
                    </div>
                  )}
                  {attemptType === 'substitute' && personServedName && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Served to</span>
                      <span className="text-rmpg-100">{personServedName}{relationship ? ` (${relationship})` : ''}</span>
                    </div>
                  )}
                  {buildDescription() && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Description</span>
                      <span className="text-rmpg-100 text-xs text-right max-w-[60%]">{buildDescription()}</span>
                    </div>
                  )}
                  {notes && (
                    <div>
                      <span className="text-rmpg-400 text-xs">Notes:</span>
                      <p className="text-rmpg-200 text-xs mt-0.5">{notes}</p>
                    </div>
                  )}
                </div>

                {/* Failed fast-path: Documentation step is skipped, so put
                    the notes + photos inline here. Successful flows
                    captured these on Step 2 (Documentation) already. */}
                {isFailedPath && (
                  <>
                    <NotesField value={notes} onChange={setNotes} />
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-rmpg-300 uppercase">
                        Photos ({photos.length}/5) <span className="text-rmpg-500 normal-case">(optional)</span>
                      </label>
                      <label className={`flex items-center justify-center gap-2 px-3 py-2 rounded-sm border-2 border-dashed cursor-pointer transition-colors ${
                        photos.length >= 5
                          ? 'border-rmpg-700 text-rmpg-600 cursor-not-allowed'
                          : 'border-rmpg-500 text-rmpg-300 hover:border-brand-500 hover:text-brand-300'
                      }`}>
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                        <span className="text-xs font-semibold">
                          {uploading ? 'Uploading…' : 'Take Photo'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          multiple
                          disabled={photos.length >= 5 || uploading}
                          onChange={handlePhotoCapture}
                          className="hidden"
                        />
                      </label>
                      {photos.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {photos.map((p) => (
                            <div key={p.id} className="relative w-14 h-14 rounded-sm border border-rmpg-600 overflow-hidden">
                              <img src={p.url} alt="" className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => removePhoto(p.id)}
                                className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-700 rounded-full flex items-center justify-center"
                                aria-label="Remove photo"
                              >
                                <Trash2 className="w-2.5 h-2.5 text-rmpg-100" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Signature — only meaningful for sworn (successful)
                    services. Failed attempts are unsworn notices and do
                    not need an officer signature on the wizard. */}
                {!isFailedPath && (
                  <SignaturePad
                    value={signature}
                    onChange={setSignature}
                    width={300}
                    height={150}
                    label="Officer Signature"
                  />
                )}

                <div className="flex justify-between pt-2">
                  <button type="button"
                    onClick={goBack}
                    className="px-4 py-2 text-sm font-semibold bg-surface-raised hover:bg-surface-raised text-rmpg-200 rounded-[2px] border border-rmpg-700 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50"
                  >
                    Back
                  </button>
                  <button type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="px-4 py-2 text-sm font-semibold bg-[#d4a017] hover:bg-[#d4a017]/80 text-rmpg-100 rounded-[2px] disabled:opacity-40 transition-all duration-150 flex items-center gap-2 focus:outline-none focus:ring-1 focus:ring-[#d4a017]/50 hover:shadow-[0_0_8px_rgba(212,160,23,0.3)]"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {isFailedPath ? 'Record Failed Attempt' : 'Record Service'}
                  </button>
                </div>
              </>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // ─── Modal Shell ───────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-label="Document Service Attempt">
      <div className="bg-surface-base panel-beveled rounded-[2px] w-full max-w-lg mx-4 max-h-[90vh] flex flex-col shadow-md animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-sunken">
          <h2 className="text-sm font-bold text-rmpg-100 tracking-wide">
            Document Service Attempt — {job.recipient_name}
          </h2>
          <button type="button"
            onClick={onClose}
            className="text-rmpg-400 hover:text-rmpg-200 transition-colors p-1 rounded-[2px] hover:bg-surface-raised focus:outline-none focus:ring-1 focus:ring-[#888888]/50"
            aria-label="Close modal">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator />

        {/* Step content */}
        <div className="flex-1 overflow-hidden">
          {renderStep()}
        </div>
      </div>
    </div>
  );
}

// ─── NotesField ─────────────────────────────────────────────────────────
// Notes go into the `notes` column AND onto the Notice-of-Attempt PDF
// table — which silently truncates at NOTES_CHAR_LIMIT. The counter
// surfaces that limit so the operator doesn't lose the tail of a long
// observation when the notice is generated.
function NotesField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const len = value.length;
  const over = len > NOTES_CHAR_LIMIT;
  const near = !over && len > NOTES_CHAR_LIMIT - 15;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label htmlFor="ff-serveattemptmodal-notes" className="block text-xs font-semibold text-rmpg-300 uppercase">Notes</label>
        <span className={`text-[10px] font-mono ${over ? 'text-red-400' : near ? 'text-yellow-400' : 'text-rmpg-500'}`}>
          {len} / {NOTES_CHAR_LIMIT} on notice{over ? ' — will truncate' : ''}
        </span>
      </div>
      <RichTextArea
        id="ff-serveattemptmodal-notes"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Observations about the location, people present, etc."
        rows={3}
        className={`w-full bg-rmpg-800 border rounded-[2px] px-3 py-2 text-sm text-rmpg-100 focus:outline-none focus:ring-1 transition-colors resize-none ${
          over ? 'border-red-600 focus:border-red-500 focus:ring-red-500/40'
            : 'border-rmpg-600 focus:border-[#888888] focus:ring-[#888888]/40'
        }`}
      />
    </div>
  );
}

// ─── PsoCodePicker ──────────────────────────────────────────────────────
// Two-step structured picker: category → sub-code. The category buttons
// show the PS/XX prefix + label; selecting one expands the sub-code list
// below. Visually tuned to match the rest of the modal (steel-blue surfaces,
// gold accent for the active item, gray border otherwise).
function PsoCodePicker({
  attemptType, available, pickerCategory, setPickerCategory,
  dispositionCode, setDispositionCode, showAll, setShowAll,
}: {
  attemptType: AttemptType;
  available: PsoCategory[];
  pickerCategory: string | null;
  setPickerCategory: (c: string | null) => void;
  dispositionCode: string;
  setDispositionCode: (c: string) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
}) {
  // When a code is already picked, jump the category view back to its
  // parent so the operator sees the active state on first render.
  useEffect(() => {
    if (dispositionCode && !pickerCategory) {
      const psc = lookupPsoCode(dispositionCode);
      if (psc) setPickerCategory(psc.category);
    }
  }, [dispositionCode, pickerCategory, setPickerCategory]);

  const subCodes = pickerCategory ? codesInCategory(pickerCategory) : [];

  const toneClass = (tone: PsoCategory['tone'], active: boolean): string => {
    if (active) return 'border-[#d4a017] bg-[#d4a017]/10 text-rmpg-100 shadow-[0_0_6px_rgba(212,160,23,0.2)]';
    switch (tone) {
      case 'success': return 'border-rmpg-700 bg-surface-sunken hover:border-green-500 text-rmpg-200';
      case 'attempt': return 'border-rmpg-700 bg-surface-sunken hover:border-yellow-500 text-rmpg-200';
      case 'danger':  return 'border-rmpg-700 bg-surface-sunken hover:border-red-500 text-rmpg-200';
      case 'admin':   return 'border-rmpg-700 bg-surface-sunken hover:border-blue-500 text-rmpg-200';
      case 'pending': return 'border-rmpg-700 bg-surface-sunken hover:border-rmpg-400 text-rmpg-200';
    }
  };

  return (
    <fieldset className="space-y-3 border border-rmpg-700 rounded-[2px] p-3">
      <legend className="text-[10px] font-semibold text-rmpg-300 uppercase px-1">
        Disposition code <span className="text-rmpg-500 normal-case">— structured PS code (printed on the notice)</span>
      </legend>

      {/* Category row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {available.map((cat) => (
          <button
            key={cat.code}
            type="button"
            onClick={() => setPickerCategory(cat.code === pickerCategory ? null : cat.code)}
            className={`text-left p-2 rounded-[2px] border-2 transition-all duration-150 ${toneClass(cat.tone, pickerCategory === cat.code)}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono font-bold text-[#d4a017]">{cat.code}</span>
              {cat.isService && <span className="text-[9px] uppercase text-green-400">Completion</span>}
            </div>
            <div className="text-xs font-semibold leading-tight">{cat.label}</div>
            <div className="text-[10px] text-rmpg-400 leading-tight mt-0.5">{cat.description}</div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowAll(!showAll)}
        className="text-[10px] uppercase tracking-wider text-rmpg-400 hover:text-[#d4a017] transition-colors"
      >
        {showAll
          ? `Show only suggested for ${attemptType}`
          : 'Show all 10 categories (mail, publication, court-ordered, admin…)'}
      </button>

      {/* Sub-code list */}
      {pickerCategory && (
        <div className="space-y-1 mt-1 max-h-48 overflow-y-auto scrollbar-dark border-t border-rmpg-700 pt-2">
          {subCodes.map((c) => (
            <label
              key={c.code}
              htmlFor={`ff-psocode-${c.code}`}
              className={`flex items-start gap-2 p-1.5 rounded-[2px] cursor-pointer transition-colors ${
                dispositionCode === c.code
                  ? 'bg-[#d4a017]/10 border-l-2 border-[#d4a017]'
                  : 'hover:bg-surface-raised border-l-2 border-transparent'
              }`}
            >
              <input
                id={`ff-psocode-${c.code}`}
                type="radio"
                name="pso-code"
                value={c.code}
                checked={dispositionCode === c.code}
                onChange={() => setDispositionCode(c.code)}
                className="mt-0.5 accent-[#d4a017]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-mono font-bold text-[#d4a017]">{c.code}</span>
                  <span className="text-xs font-semibold text-rmpg-100">{c.label}</span>
                </div>
                {c.hint && <div className="text-[10px] text-rmpg-400 italic">{c.hint}</div>}
              </div>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
