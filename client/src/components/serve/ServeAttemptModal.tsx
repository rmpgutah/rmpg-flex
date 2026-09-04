import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import RichTextArea from '../RichTextArea';
import {
  X, MapPin, FileText, Camera, Send, CheckCircle, AlertTriangle,
  Loader2, Navigation, Trash2, Clock, Volume2, Upload,
} from 'lucide-react';
import SignaturePad from '../SignaturePad';
import { apiFetch, apiPostForm, authedImageUrl } from '../../hooks/useApi';
import { useFormDraft } from '../../hooks/useFormDraft';
import type { ServeJob, ServeAttemptData } from '../../types';
import { parseServeJobMeta } from '../../utils/serveJobIntake';
import ServeJobOpsPanel from './ServeJobOpsPanel';
import ServeReceiptActions from './ServeReceiptActions';
import {
  PSO_CATEGORIES, codesInCategory, lookupPsoCode,
  type PsoCategory,
} from '../../constants/processServiceCodes';
import { toDisplayLabel } from '../../utils/formatters';
import {
  defaultPsCodeForFailedReason,
  normalizeServeAttemptResult,
} from '../../utils/serveAttemptNormalize';
import {
  inferServeFileKind,
  SERVE_ATTEMPT_FILE_ACCEPT,
  SERVE_DOCUMENT_TYPE_LABELS,
  SERVE_DOCUMENT_TYPES,
} from '../../utils/serveAttemptFileMeta';
import { useNavTrip } from '../../context/NavTripContext';

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

// ─── Draft-persisted text/dropdown fields ────────────────────────────────
// GPS, photos, signature, and transient UI state (step, picker category)
// are intentionally excluded — they're not typed text at risk of loss, and
// GPS/photos re-acquire fresh on next open anyway.
interface AttemptDraftForm {
  attemptType: AttemptType | null;
  failedReason: FailedReason | null;
  customReason: string;
  dispositionCode: string;
  nextAttemptDate: string;
  nextAttemptStart: string;
  nextAttemptEnd: string;
  nextAttemptText: string;
  nextAttemptTextDirty: boolean;
  ageRange: string;
  height: string;
  weight: string;
  hairColor: string;
  clothing: string;
  personServedName: string;
  relationship: string;
  notes: string;
}

const EMPTY_ATTEMPT_DRAFT: AttemptDraftForm = {
  attemptType: null,
  failedReason: null,
  customReason: '',
  dispositionCode: '',
  nextAttemptDate: '',
  nextAttemptStart: '',
  nextAttemptEnd: '',
  nextAttemptText: '',
  nextAttemptTextDirty: false,
  ageRange: '',
  height: '',
  weight: '',
  hairColor: '',
  clothing: '',
  personServedName: '',
  relationship: '',
  notes: '',
};

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

/** Map the app-wide GPS tracker fix into modal state, or null when no fix yet. */
function gpsFromTracker(tracker: {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
} | null | undefined): GpsState | null {
  if (!tracker || tracker.latitude == null || tracker.longitude == null) return null;
  return {
    latitude: tracker.latitude,
    longitude: tracker.longitude,
    accuracy: tracker.accuracy != null ? Math.round(tracker.accuracy) : null,
    loading: false,
    error: null,
  };
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServeAttemptModal({
  isOpen,
  onClose,
  job,
  onSubmit,
  onGenerateAffidavit,
}: ServeAttemptModalProps) {
  const navTrip = useNavTrip();
  const liveGpsRef = useRef(navTrip?.gps);
  liveGpsRef.current = navTrip?.gps;

  const [step, setStep] = useState(0);

  // Step 1 — GPS
  const [gps, setGps] = useState<GpsState>({
    latitude: null, longitude: null, accuracy: null,
    loading: true, error: null,
  });
  const [gpsRetryCount, setGpsRetryCount] = useState(0);
  const acquireGenRef = useRef(0);
  const arrivedAtRef = useRef<string | null>(null);

  // Text/dropdown fields — draft-persisted so an in-progress attempt survives
  // a lost connection, accidental close, or device switch (photos/signature/
  // GPS are excluded; see AttemptDraftForm comment above).
  const {
    form: draft, setForm: setDraft, wasRestored, clearDraft, signalSaved, snapshot,
  } = useFormDraft<AttemptDraftForm>({
    storageKey: `rmpg_serve_attempt_draft_${job.id}`,
    defaultValue: EMPTY_ATTEMPT_DRAFT,
    isActive: isOpen,
  });
  const {
    attemptType, failedReason, customReason, dispositionCode,
    nextAttemptDate, nextAttemptStart, nextAttemptEnd, nextAttemptText, nextAttemptTextDirty,
    ageRange, height, weight, hairColor, clothing, personServedName, relationship, notes,
  } = draft;
  // FUNCTIONAL updates, not `{ ...draft, x }`. Several handlers here fire
  // TWO setters in a row (attempt type + failedReason, disposition code +
  // failedReason). Spreading the render-closure `draft` meant the second
  // call wrote back the first call's stale value, so the first selection
  // silently reverted — Personal and Substitute Service could not be
  // picked at all, and "Failed Attempt" worked only because it is the one
  // branch that skips the second setter.
  const setAttemptType = (v: AttemptType | null) => setDraft((prev) => ({ ...prev, attemptType: v }));
  const setFailedReason = (v: FailedReason | null) => setDraft((prev) => ({ ...prev, failedReason: v }));
  const setCustomReason = (v: string) => setDraft((prev) => ({ ...prev, customReason: v }));
  const setDispositionCode = (v: string) => setDraft((prev) => ({ ...prev, dispositionCode: v }));
  const setNextAttemptDate = (v: string) => setDraft((prev) => ({ ...prev, nextAttemptDate: v }));
  const setNextAttemptStart = (v: string) => setDraft((prev) => ({ ...prev, nextAttemptStart: v }));
  const setNextAttemptEnd = (v: string) => setDraft((prev) => ({ ...prev, nextAttemptEnd: v }));
  const setNextAttemptText = (v: string) => setDraft((prev) => ({ ...prev, nextAttemptText: v }));
  const setNextAttemptTextDirty = (v: boolean) => setDraft((prev) => ({ ...prev, nextAttemptTextDirty: v }));
  const setAgeRange = (v: string) => setDraft((prev) => ({ ...prev, ageRange: v }));
  const setHeight = (v: string) => setDraft((prev) => ({ ...prev, height: v }));
  const setWeight = (v: string) => setDraft((prev) => ({ ...prev, weight: v }));
  const setHairColor = (v: string) => setDraft((prev) => ({ ...prev, hairColor: v }));
  const setClothing = (v: string) => setDraft((prev) => ({ ...prev, clothing: v }));
  const setPersonServedName = (v: string) => setDraft((prev) => ({ ...prev, personServedName: v }));
  const setRelationship = (v: string) => setDraft((prev) => ({ ...prev, relationship: v }));
  const setNotes = (v: string) => setDraft((prev) => ({ ...prev, notes: v }));

  // Category the operator drilled into on the structured picker. UI-only
  // state — drives which sub-codes are listed below the category buttons.
  const [pickerCategory, setPickerCategory] = useState<string | null>(null);

  // Step 3 — Documentation
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [packetFiles, setPacketFiles] = useState<Array<{
    id: string;
    name: string;
    kind: 'document' | 'photo' | 'audio';
    title: string;
    document_type: string;
    description: string;
    copies: string;
    mime_type: string;
  }>>([]);
  const [uploading, setUploading] = useState(false);

  // Step 4 — Signature & Submit
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    dueDiligenceComplete?: boolean;
    attemptNumber?: number;
  } | null>(null);

  // ─── GPS Acquisition ────────────────────────────────────────────────

  const acquireGps = useCallback((retryIndex = 0) => {
    const gen = ++acquireGenRef.current;
    const fromTracker = gpsFromTracker(liveGpsRef.current);
    // Toughbook internal GPS feeds useGpsTracking, not navigator.geolocation —
    // re-use the live tracker fix instead of waiting 27s for a Chromium timeout.
    if (retryIndex === 0 && fromTracker) {
      setGps(fromTracker);
      return;
    }

    setGps({ latitude: null, longitude: null, accuracy: null, loading: true, error: null });
    if (!navigator.geolocation) {
      const fallback = gpsFromTracker(liveGpsRef.current);
      setGps(fallback ?? { latitude: null, longitude: null, accuracy: null, loading: false, error: 'Geolocation not available' });
      return;
    }

    let settled = false;
    const finish = (next: GpsState) => {
      if (settled || gen !== acquireGenRef.current) return;
      settled = true;
      window.clearTimeout(watchdogId);
      setGps(next);
    };

    const watchdogId = window.setTimeout(() => {
      const fallback = gpsFromTracker(liveGpsRef.current);
      finish(fallback ?? {
        latitude: null,
        longitude: null,
        accuracy: null,
        loading: false,
        error: 'Timeout expired',
      });
    }, 12000);

    // Browser fallback when the tracker has no fix yet. Low accuracy + generous
    // maximumAge — high-accuracy getCurrentPosition hangs on desktop/Toughbook
    // while the hardware reader is already owned by useGpsTracking.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        finish({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          loading: false,
          error: null,
        });
      },
      (err) => {
        const fallback = gpsFromTracker(liveGpsRef.current);
        finish(fallback ?? {
          latitude: null,
          longitude: null,
          accuracy: null,
          loading: false,
          error: err instanceof Error ? err.message : 'GPS error',
        });
      },
      {
        enableHighAccuracy: false,
        timeout: retryIndex === 0 ? 8000 : 10000,
        maximumAge: 60000,
      },
    );
  }, []);

  useEffect(() => {
    if (isOpen) {
      arrivedAtRef.current = new Date().toISOString();
      setGpsRetryCount(0);
      acquireGps(0);
      // Reset UI/binary state on open — text fields are handled by
      // useFormDraft (restores a pending draft or starts from EMPTY_ATTEMPT_DRAFT).
      setStep(0);
      setPickerCategory(null);
      setPhotos([]);
      setPacketFiles([]);
      setSignature(null);
      setSubmitting(false);
      setSubmitResult(null);
      setTimeout(() => snapshot(), 0);
    } else {
      acquireGenRef.current += 1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, acquireGps]);

  // Adopt a tracker fix as soon as it arrives while the modal is waiting.
  useEffect(() => {
    if (!isOpen || !gps.loading) return;
    const fromTracker = gpsFromTracker(navTrip?.gps);
    if (fromTracker) setGps(fromTracker);
  }, [isOpen, gps.loading, navTrip?.gps?.latitude, navTrip?.gps?.longitude, navTrip?.gps?.accuracy]);

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
        formData.append('files', file);
        // Server returns an array of attachment rows; take the first one.
        const rows = await apiPostForm<{ file_id: string }[]>('/uploads', formData);
        const row = Array.isArray(rows) ? rows[0] : (rows as any);
        if (row?.file_id) {
          const fileId = row.file_id;
          setPhotos(prev => [
            ...prev,
            { id: fileId, url: authedImageUrl(`/api/uploads/${encodeURIComponent(fileId)}`) },
          ]);
        }
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

  const handlePacketCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 20)) {
        const formData = new FormData();
        formData.append('files', file);
        const rows = await apiPostForm<{ file_id: string; mime_type?: string }[]>('/uploads', formData);
        const row = Array.isArray(rows) ? rows[0] : (rows as { file_id: string; mime_type?: string });
        if (row?.file_id) {
          const kind = inferServeFileKind(row.mime_type || file.type, file.name);
          setPacketFiles(prev => [...prev, {
            id: row.file_id,
            name: file.name,
            kind,
            title: file.name.replace(/\.[^.]+$/, ''),
            document_type: kind === 'audio' ? 'voice_memo' : kind === 'photo' ? 'door_photo' : '',
            description: '',
            copies: '1',
            mime_type: row.mime_type || file.type,
          }]);
        }
      }
    } catch {
      // upload failed — user can retry
    } finally {
      setUploading(false);
      e.target.value = '';
    }
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
          ? (normalizeServeAttemptResult(failedReason || 'other') as ServeAttemptData['result'])
          : 'served',
        latitude: gps.latitude ?? undefined,
        longitude: gps.longitude ?? undefined,
        gps_accuracy: gps.accuracy ?? undefined,
        address_verified: !showDistanceWarning,
        photo_ids: photos.map(p => p.id),
        evidence_files: packetFiles.map((f) => ({
          file_id: f.id,
          kind: f.kind,
          title: f.title,
          description: f.description || undefined,
          document_type: f.document_type || undefined,
          copies: f.copies ? Number(f.copies) : undefined,
          original_name: f.name,
          mime_type: f.mime_type,
        })),
        // Failed attempts are unsworn — the wizard skips signature capture
        // entirely for them, so don't force an empty signature payload.
        signature_data: attemptType === 'failed' ? undefined : (signature ?? undefined),
        notes: composedNotes || undefined,
        next_attempt_note: nextAttemptText.trim() || undefined,
        // Structured code wins on the server — codeToLegacyResult derives the
        // CHECK-enum `result` from it. Auto-fill from the failed-reason chips
        // so officers are not forced through the nested PS picker on a no-answer.
        disposition_code: dispositionCode
          || (attemptType === 'failed' ? defaultPsCodeForFailedReason(failedReason) : undefined)
          || (attemptType === 'personal' ? 'PS/05.01' : undefined)
          || (attemptType === 'substitute' ? 'PS/10.01' : undefined),
        arrivedAt: arrivedAtRef.current ?? undefined,
      };

      if (attemptType === 'personal' || attemptType === 'substitute') {
        data.person_served_description = buildDescription() || undefined;
      }
      if (attemptType === 'substitute') {
        data.person_served_name = personServedName || undefined;
        data.person_served_relationship = relationship || undefined;
      }

      const result = await onSubmit(data);
      signalSaved();
      setSubmitResult(result);
    } catch {
      // error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const guardedClose = () => { clearDraft(); onClose(); };

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
                  ? 'bg-accent-silver-500 border-accent-silver-400 text-surface-base shadow-[0_0_6px_rgba(var(--accent-silver-400-rgb),0.6)]'
                  : 'bg-rmpg-700 border-rmpg-500 text-rmpg-400'
            }`}>
              {i < displayStep ? <CheckCircle className="w-4 h-4" /> : i + 1}
            </div>
            <span className={`text-[10px] font-semibold transition-colors duration-200 ${
              i <= displayStep ? 'text-rmpg-200' : 'text-fg-muted'
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
                  <Loader2 className="w-8 h-8 animate-spin text-[color:var(--accent-silver-400)]" />
                  <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-500" />
                </div>
                <span className="text-sm">Acquiring GPS position...</span>
              </div>
            ) : gps.error ? (
              <div className="bg-red-900/30 border border-red-700 rounded-sm p-3 text-sm text-red-300 space-y-2">
                <p className="font-semibold">GPS unavailable{gpsRetryCount > 0 ? ' — using low-accuracy fallback' : ''}</p>
                <p className="text-xs text-red-400">{gps.error}</p>
                <div className="flex items-center gap-2 pt-1">
                  <button type="button"
                    onClick={() => {
                      const next = gpsRetryCount + 1;
                      setGpsRetryCount(next);
                      acquireGps(next);
                    }}
                    className="px-3 py-1 text-xs bg-red-800 hover:bg-red-700 text-red-200 rounded-sm"
                  >
                    {gpsRetryCount === 0 ? 'Retry (low-accuracy)' : 'Retry again'}
                  </button>
                  <span className="text-xs text-red-500">or</span>
                  <button type="button"
                    onClick={() => setStep(1)}
                    className="px-3 py-1 text-xs bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-200 rounded-sm"
                  >
                    Proceed without GPS
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-surface-sunken border border-rmpg-700 rounded-[2px] p-2">
                    <div className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'var(--field-label-color)' }}>Latitude</div>
                    <div className="text-sm text-rmpg-100 font-mono">{gps.latitude?.toFixed(6)}</div>
                  </div>
                  <div className="bg-surface-sunken border border-rmpg-700 rounded-[2px] p-2">
                    <div className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'var(--field-label-color)' }}>Longitude</div>
                    <div className="text-sm text-rmpg-100 font-mono">{gps.longitude?.toFixed(6)}</div>
                  </div>
                  <div className="bg-surface-sunken border border-rmpg-700 rounded-[2px] p-2">
                    <div className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'var(--field-label-color)' }}>Accuracy</div>
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

                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--field-label-color)' }}>
                    Quick log (skips extra screens)
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['no_answer', 'No Answer'],
                      ['refused', 'Refused'],
                      ['wrong_address', 'Bad Address'],
                    ] as const).map(([reason, label]) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => {
                          const code = defaultPsCodeForFailedReason(reason) || '';
                          setDraft((prev) => ({
                            ...prev,
                            attemptType: 'failed',
                            failedReason: reason,
                            dispositionCode: code,
                          }));
                          setStep(3);
                        }}
                        className="px-2 py-2 text-xs font-semibold bg-surface-sunken border border-rmpg-600 text-rmpg-100 hover:border-accent-silver-400 rounded-[2px]"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button type="button"
                onClick={() => setStep(1)}
                disabled={gps.loading}
                className="px-4 py-2 text-sm font-semibold bg-[color:var(--accent-silver-500)] hover:bg-[color:var(--accent-silver-500)]/80 text-rmpg-100 rounded-[2px] disabled:opacity-40 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
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
            <h3 className="text-sm font-bold" style={{ color: 'var(--panel-header-color)' }}>Select Attempt Type</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {typeCards.map((card) => (
                <div key={card.type} className="relative group">
                  <button type="button"
                    disabled={card.disabled}
                    onClick={() => {
                      setAttemptType(card.type);
                      setDispositionCode('');
                      if (card.type !== 'failed') setFailedReason(null);
                    }}
                    className={`w-full text-left p-3 rounded-[2px] border-2 transition-all duration-150 panel-beveled ${
                      card.disabled
                        ? 'opacity-40 cursor-not-allowed border-rmpg-700 bg-rmpg-800'
                        : attemptType === card.type
                          ? 'border-accent-silver-400 bg-accent-silver-400/5 shadow-[0_0_8px_rgba(var(--accent-silver-400-rgb),0.15)]'
                          : 'border-rmpg-700 bg-surface-sunken hover:border-accent-silver-400 hover:bg-surface-base'
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
                      Specify reason <span className="text-fg-muted normal-case">(prepended to notes on the notice)</span>
                    </label>
                    <input
                      id="ff-serveattemptmodal-other-reason"
                      type="text"
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value.slice(0, 60))}
                      placeholder="e.g., business closed for the day"
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-3 py-2 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)] focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
                    />
                  </div>
                )}

                {/* Next-attempt scheduler — optional, only meaningful for
                    failed attempts (a successful service has no next attempt). */}
                <fieldset className="space-y-2 border border-rmpg-700 rounded-[2px] p-3">
                  <legend className="text-[10px] font-semibold text-rmpg-300 uppercase px-1">
                    Next attempt window <span className="text-fg-muted normal-case">(optional — shown on the notice)</span>
                  </legend>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label htmlFor="ff-na-date" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Date</label>
                      <input
                        id="ff-na-date"
                        type="date"
                        value={nextAttemptDate}
                        onChange={(e) => setNextAttemptDate(e.target.value)}
                        className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)]"
                      />
                    </div>
                    <div>
                      <label htmlFor="ff-na-start" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">From</label>
                      <input
                        id="ff-na-start"
                        type="time"
                        value={nextAttemptStart}
                        onChange={(e) => setNextAttemptStart(e.target.value)}
                        className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)]"
                      />
                    </div>
                    <div>
                      <label htmlFor="ff-na-end" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">To</label>
                      <input
                        id="ff-na-end"
                        type="time"
                        value={nextAttemptEnd}
                        onChange={(e) => setNextAttemptEnd(e.target.value)}
                        className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)]"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="ff-na-text" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">
                      Notice wording {nextAttemptTextDirty && <span className="text-accent-silver-300 normal-case">(edited)</span>}
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
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)] resize-none"
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
                className="px-4 py-2 text-sm font-semibold bg-surface-raised hover:bg-surface-raised text-rmpg-200 rounded-[2px] border border-rmpg-700 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
              >
                Back
              </button>
              <button type="button"
                onClick={goNext}
                disabled={
                  !attemptType
                  || (attemptType === 'failed' && !dispositionCode && !failedReason)
                }
                className="px-4 py-2 text-sm font-semibold bg-[color:var(--accent-silver-500)] hover:bg-[color:var(--accent-silver-500)]/80 text-rmpg-100 rounded-[2px] disabled:opacity-40 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
              >
                {isFailedPath ? 'Continue' : 'Next'}
              </button>
            </div>
          </div>
        );

      // ─── Step 3: Documentation ─────────────────────────────
      case 2:
        return (
          <div className="space-y-4 p-4">
            <h3 className="text-sm font-bold" style={{ color: 'var(--panel-header-color)' }}>Documentation</h3>

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
                      <button aria-label="Remove" type="button"
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

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-rmpg-300 uppercase">Documents &amp; MP3 ({packetFiles.length})</label>
              <label className={`flex items-center justify-center gap-2 px-4 py-3 rounded-sm border-2 border-dashed cursor-pointer transition-colors ${
                uploading ? 'border-rmpg-700 text-rmpg-600' : 'border-rmpg-500 text-rmpg-300 hover:border-brand-500 hover:text-brand-300'
              }`}>
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                <span className="text-sm font-semibold">{uploading ? 'Uploading...' : 'Add PDF, papers, or MP3'}</span>
                <input
                  type="file"
                  accept={SERVE_ATTEMPT_FILE_ACCEPT}
                  multiple
                  disabled={uploading}
                  onChange={handlePacketCapture}
                  className="hidden"
                />
              </label>
              {packetFiles.map((f) => (
                <div key={f.id} className="border border-rmpg-700 p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    {f.kind === 'audio' ? <Volume2 className="w-3.5 h-3.5 text-rmpg-400" /> : <FileText className="w-3.5 h-3.5 text-rmpg-400" />}
                    <span className="text-[11px] text-rmpg-100 truncate flex-1">{f.name}</span>
                    <button type="button" aria-label="Remove file" onClick={() => setPacketFiles((prev) => prev.filter((x) => x.id !== f.id))} className="text-red-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <input
                    value={f.title}
                    onChange={(e) => setPacketFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, title: e.target.value } : x))}
                    placeholder="Title"
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1 text-[11px] text-rmpg-100"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={f.document_type}
                      onChange={(e) => setPacketFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, document_type: e.target.value } : x))}
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1 text-[11px] text-rmpg-100"
                    >
                      <option value="">Type…</option>
                      {SERVE_DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{SERVE_DOCUMENT_TYPE_LABELS[t]}</option>)}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={f.copies}
                      onChange={(e) => setPacketFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, copies: e.target.value } : x))}
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1 text-[11px] text-rmpg-100"
                      placeholder="Copies"
                    />
                  </div>
                  <textarea
                    value={f.description}
                    onChange={(e) => setPacketFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, description: e.target.value } : x))}
                    rows={2}
                    placeholder="Details — who received it, where posted, what the recording covers"
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1 text-[11px] text-rmpg-100"
                  />
                </div>
              ))}
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
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)] focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
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
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)] focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
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
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)] focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
                    />
                  </div>
                  <div>
                    <label htmlFor="ff-serveattemptmodal-5" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Weight</label>
                    <input id="ff-serveattemptmodal-5"
                      type="text"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      placeholder="e.g., 180 lbs"
                      className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)] focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
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
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)] focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
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
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)] focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="ff-serveattemptmodal-8" className="block text-[10px] text-rmpg-400 uppercase mb-0.5">Relationship</label>
                  <select id="ff-serveattemptmodal-8"
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                    className="w-full bg-rmpg-800 border border-rmpg-600 rounded-[2px] px-2 py-1.5 text-sm text-rmpg-100 focus:outline-none focus:border-[color:var(--accent-silver-400)] focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
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
                className="px-4 py-2 text-sm font-semibold bg-surface-raised hover:bg-surface-raised text-rmpg-200 rounded-[2px] border border-rmpg-700 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
              >
                Back
              </button>
              <button type="button"
                onClick={goNext}
                disabled={attemptType === 'substitute' && !personServedName.trim()}
                className="px-4 py-2 text-sm font-semibold bg-[color:var(--accent-silver-500)] hover:bg-[color:var(--accent-silver-500)]/80 text-rmpg-100 rounded-[2px] disabled:opacity-40 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
              >
                Next
              </button>
            </div>
          </div>
        );

      // ─── Step 4: Review & Signature (or fast-path Submit for failed) ─
      case 3:
        return (
          <div className="space-y-4 p-4">
            {submitResult ? (
              // Post-submit result
              <div className="space-y-4 text-center py-4">
                <CheckCircle className="w-12 h-12 text-green-400 mx-auto" />
                <h3 className="text-sm font-bold text-rmpg-100">
                  Attempt #{submitResult.attemptNumber} Recorded
                </h3>
                {/* ── Civil Process Record ──
                    Presented HERE, on the completion of the attempt, rather
                    than behind a separate button on the job card. An officer
                    who has just recorded handing papers to someone is exactly
                    the officer who needs the acknowledgement signed, and they
                    are still standing at the door.

                    Only for attempts that actually delivered something. A
                    posting or a failed attempt has no recipient to sign, and
                    offering the form there would invite a signature on a
                    service that did not happen. */}
                {(attemptType === 'personal' || attemptType === 'substitute') && (
                  <div className="border border-rmpg-700 rounded-[2px] p-3 space-y-2 text-left">
                    <p className="text-[11px] font-bold uppercase tracking-wider"
                       style={{ color: 'var(--panel-header-color)' }}>
                      Civil Process Record
                    </p>
                    <p className="text-[11px] text-fg-secondary leading-snug">
                      Have {personServedName?.trim() || 'the recipient'} sign the
                      Acknowledgement of Service — on their phone, or on paper.
                      Who you served and their relationship carry over from this
                      attempt.
                    </p>
                    <ServeReceiptActions
                      job={job}
                      triggerLabel="Acknowledgement of Service"
                      seed={{
                        isNamedParty: attemptType === 'personal',
                        recipientName: personServedName?.trim() || null,
                        relationship: relationship?.trim() || null,
                      }}
                    />
                  </div>
                )}

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
                  className="px-4 py-2 text-sm font-semibold bg-surface-raised hover:bg-surface-raised text-rmpg-200 rounded-[2px] border border-rmpg-700 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-bold" style={{ color: 'var(--panel-header-color)' }}>Review & Submit</h3>

                {/* Summary card */}
                <div className="bg-surface-sunken border border-rmpg-700 rounded-[2px] p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-rmpg-400">Recipient</span>
                    <span className="text-rmpg-100 font-semibold">{job.recipient_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rmpg-400">Type</span>
                    <span className="text-rmpg-100 capitalize">{toDisplayLabel(attemptType)}</span>
                  </div>
                  {attemptType === 'failed' && failedReason && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Reason</span>
                      <span className="text-rmpg-100 capitalize">
                        {failedReason === 'other' && customReason.trim()
                          ? customReason.trim()
                          : toDisplayLabel(failedReason)}
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
                  {packetFiles.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Documents / audio</span>
                      <span className="text-rmpg-100">{packetFiles.length} attached</span>
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
                        Photos ({photos.length}/5) <span className="text-fg-muted normal-case">(optional)</span>
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
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-rmpg-300 uppercase">
                        Documents &amp; MP3 ({packetFiles.length}) <span className="text-fg-muted normal-case">(optional)</span>
                      </label>
                      <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-sm border-2 border-dashed cursor-pointer border-rmpg-500 text-rmpg-300 hover:border-brand-500">
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        <span className="text-xs font-semibold">{uploading ? 'Uploading…' : 'Add PDF or MP3'}</span>
                        <input type="file" accept={SERVE_ATTEMPT_FILE_ACCEPT} multiple disabled={uploading} onChange={handlePacketCapture} className="hidden" />
                      </label>
                      {packetFiles.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 text-[11px] text-rmpg-100">
                          <span className="truncate flex-1">{f.title || f.name}</span>
                          <button type="button" aria-label="Remove file" onClick={() => setPacketFiles((prev) => prev.filter((x) => x.id !== f.id))}>
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </button>
                        </div>
                      ))}
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
                    className="px-4 py-2 text-sm font-semibold bg-surface-raised hover:bg-surface-raised text-rmpg-200 rounded-[2px] border border-rmpg-700 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
                  >
                    Back
                  </button>
                  <button type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="px-4 py-2 text-sm font-semibold bg-accent-silver-500 hover:bg-accent-silver-400 text-surface-base rounded-[2px] disabled:opacity-40 transition-all duration-150 flex items-center gap-2 focus:outline-none focus:ring-1 focus:ring-accent-silver-300/50"
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
            onClick={guardedClose}
            className="text-rmpg-400 hover:text-rmpg-200 transition-colors p-1 rounded-[2px] hover:bg-surface-raised focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
            aria-label="Close modal">
            <X className="w-4 h-4" />
          </button>
        </div>

        {(() => {
          const meta = parseServeJobMeta(job.parsed_data);
          return (
            <div className="px-4 py-2 border-b border-rmpg-700/40 bg-surface-sunken/40">
              <ServeJobOpsPanel meta={meta} compact />
            </div>
          );
        })()}

        {wasRestored && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-amber-500/30 bg-amber-950/20">
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400 font-medium">
              <Clock className="w-3.5 h-3.5" /> Restored unsaved attempt details
            </div>
            <button type="button" onClick={clearDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">
              Discard
            </button>
          </div>
        )}

        {/* Step indicator */}
        <StepIndicator />

        {/* Step content — single scroll region; steps must not add their own overflow */}
        <div className="flex-1 overflow-y-auto scrollbar-dark">
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
        <span className={`text-[10px] font-mono ${over ? 'text-red-400' : near ? 'text-yellow-400' : 'text-fg-muted'}`}>
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
            : 'border-rmpg-600 focus:border-[color:var(--accent-silver-400)] focus:ring-[color:var(--accent-silver-400)]/40'
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
    if (active) return 'border-accent-silver-400 bg-accent-silver-400/10 text-rmpg-100 shadow-[0_0_6px_rgba(var(--accent-silver-400-rgb),0.2)]';
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
        Disposition code <span className="text-fg-muted normal-case">— structured PS code (printed on the notice)</span>
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
              <span className="text-[10px] font-mono font-bold text-rmpg-100">{cat.code}</span>
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
        className="text-[10px] uppercase tracking-wider text-rmpg-400 hover:text-accent-silver-300 transition-colors"
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
                  ? 'bg-accent-silver-400/10 border-l-2 border-accent-silver-400'
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
                className="mt-0.5 accent-[color:var(--accent-silver-400)]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-mono font-bold text-rmpg-100">{c.code}</span>
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
