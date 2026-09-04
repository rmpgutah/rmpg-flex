// ============================================================
// RMPG Flex — CitationAuthor
// ============================================================
// Create/edit authoring surface for citations. Owns its own form
// state, violations[] state (multi-violation via <ViolationStack>),
// PDF preview state, and the save handler. Extracted from
// CitationsPage.tsx (Task 12).
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AlertTriangle,
  Calendar,
  Car,
  Check,
  DollarSign,
  Loader2,
  MapPin,
  Scale,
  Search,
  User,
  X,
} from 'lucide-react';
import RichTextArea from './RichTextArea';
import { Combobox } from './Combobox';
import StatuteLookup, { type StatuteResult } from './StatuteLookup';
import { ViolationStack } from './ViolationStack';
import { CitationPdfPreview } from './CitationPdfPreview';
import { formToData } from './citationFormAdapter';
import { newDraft, totalFineOf, type ViolationDraft } from './violationStackHelpers';
import type { StatuteRow } from './statuteAutofill';
import { UTAH_JUSTICE_COURTS, courtsByCounty } from '../constants/utahJusticeCourts';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useFormValidation } from '../hooks/useFormValidation';
import { useDistrictOptions } from '../hooks/useDistrictLookup';
import { usePersistedPreviewMode } from '../hooks/usePersistedPreviewMode';
import { isValidDate, isValidPlate, isValidState } from '../utils/validate';
import { localToday, formatDate } from '../utils/dateUtils';

// ── Types & constants (mirror CitationsPage) ─────────────

type CitationType = 'traffic' | 'criminal' | 'parking' | 'warning';
type CitationStatus =
  | 'issued' | 'paid' | 'contested' | 'dismissed'
  | 'warrant_issued' | 'voided' | 'payment_plan';

export interface CitationAuthorForm {
  type: CitationType;
  status: CitationStatus;
  person_id: string;
  person_name: string;
  person_dob: string;
  person_dl: string;
  person_address: string;
  // Added PR1: defendant contact for digital delivery / SMS (PR6).
  // Optional — when set, the issued defendant copy is emailed with a
  // presigned R2 link on signature complete.
  person_phone: string;
  person_email: string;
  vehicle_description: string;
  vehicle_plate: string;
  vehicle_state: string;
  // Legacy single-violation fields kept for back-compat in payload;
  // multi-violation is the source of truth via `violations[]` prop.
  statute_id: string;
  statute_citation: string;
  violation_description: string;
  offense_level: string;
  fine_amount: string;
  violation_date: string;
  violation_time: string;
  location: string;
  issuing_officer_name: string;
  badge_number: string;
  court_date: string;
  court_name: string;
  court_address: string;
  notes: string;
  section_id: string;
  zone_id: string;
  beat_id: string;
  zone_beat: string;
  vehicle_vin: string;
  vehicle_year: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_color: string;
  speed_recorded: string;
  speed_limit: string;
  radar_type: string;
  bac_level: string;
  bond_amount: string;
  bond_type: string;
  is_warning: boolean;
  school_zone: boolean;
  construction_zone: boolean;
  accident_related: boolean;
  dui_related: boolean;
  commercial_vehicle: boolean;
  court_time: string;
  court_room: string;
  appearance_required: boolean;
}

const CITATION_TYPES: { value: CitationType; label: string }[] = [
  { value: 'traffic', label: 'Traffic' },
  { value: 'criminal', label: 'Criminal' },
  { value: 'parking', label: 'Parking' },
  { value: 'warning', label: 'Warning' },
];

const CITATION_STATUSES: { value: CitationStatus; label: string }[] = [
  { value: 'issued', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'payment_plan', label: 'Payment Plan' },
  { value: 'contested', label: 'Contested' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'warrant_issued', label: 'Warrant Issued' },
  { value: 'voided', label: 'Voided' },
];

const TYPE_BADGE: Record<string, string> = {
  traffic: 'bg-brand-900/40 text-brand-300 border-brand-700/50',
  criminal: 'bg-red-900/40 text-red-300 border-red-700/50',
  parking: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
};

const US_STATES = [
  'UT','AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','VT','VA','WA','WV','WI','WY',
];

const US_STATE_OPTIONS: { value: string; label: string }[] = US_STATES.map(s => ({ value: s, label: s }));

const EMPTY_FORM: CitationAuthorForm = {
  type: 'traffic',
  status: 'issued',
  person_id: '',
  person_name: '',
  person_dob: '',
  person_dl: '',
  person_address: '',
  person_phone: '',
  person_email: '',
  vehicle_description: '',
  vehicle_plate: '',
  vehicle_state: 'UT',
  statute_id: '',
  statute_citation: '',
  violation_description: '',
  offense_level: '',
  fine_amount: '',
  violation_date: localToday(),
  violation_time: new Date().toTimeString().slice(0, 5),
  location: '',
  issuing_officer_name: '',
  badge_number: '',
  court_date: '',
  court_name: '',
  court_address: '',
  notes: '',
  section_id: '',
  zone_id: '',
  beat_id: '',
  zone_beat: '',
  vehicle_vin: '',
  vehicle_year: '',
  vehicle_make: '',
  vehicle_model: '',
  vehicle_color: '',
  speed_recorded: '',
  speed_limit: '',
  radar_type: '',
  bac_level: '',
  bond_amount: '',
  bond_type: '',
  is_warning: false,
  school_zone: false,
  construction_zone: false,
  accident_related: false,
  dui_related: false,
  commercial_vehicle: false,
  court_time: '',
  court_room: '',
  appearance_required: false,
};

// Statute fetcher — wraps the existing `/statutes/search` endpoint
// and maps StatuteResult → StatuteRow for the ViolationStack Combobox.
const statuteFetcher = async (q: string): Promise<StatuteRow[]> => {
  if (!q || q.length < 2) return [];
  try {
    const res = await apiFetch<{ data: any[] }>(
      `/statutes/search?q=${encodeURIComponent(q)}&limit=20`,
    );
    return (res.data ?? []).map((s: any) => ({
      id: s.id,
      citation_code: s.citation ?? s.citation_code ?? '',
      title: s.short_title ?? s.title ?? '',
      offense_level: s.offense_level ?? '',
      default_fine: Number(s.citation_fine ?? s.default_fine ?? 0),
      description: s.description ?? s.short_title ?? '',
    }));
  } catch {
    return [];
  }
};

// ── Props ────────────────────────────────────────────────

export interface CitationAuthorProps {
  mode: 'create' | 'edit';
  initialData?: any;
  onSaved: (citationId: number) => void;
  onCancel: () => void;
}

// ── Component ────────────────────────────────────────────

export default function CitationAuthor({
  mode,
  initialData,
  onSaved,
  onCancel,
}: CitationAuthorProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const {
    sections: sectionOptions, sectionLabels, zoneLabels,
    zonesForSection, beatsForZone, getBeatLabel,
  } = useDistrictOptions();

  const [form, setForm] = useState<CitationAuthorForm>(() => {
    if (mode === 'edit' && initialData) {
      return hydrateFormFromCitation(initialData);
    }
    return {
      ...EMPTY_FORM,
      violation_date: localToday(),
      violation_time: new Date().toTimeString().slice(0, 5),
      issuing_officer_name: (user as any)?.full_name || (user as any)?.username || '',
      badge_number: (user as any)?.badge_number || '',
    };
  });

  const [violations, setViolations] = useState<ViolationDraft[]>(() => {
    if (mode === 'edit' && initialData?.violations?.length) {
      return hydrateViolations(initialData.violations);
    }
    // Seed with one empty violation so the officer has somewhere to start.
    return [newDraft()];
  });

  const [previewMode, setPreviewMode] = usePersistedPreviewMode();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const { errors: formErrors, validate: runValidation, clearAllErrors: clearFormErrors } = useFormValidation();

  // Person search
  const [personSearch, setPersonSearch] = useState(form.person_name || '');
  const [personResults, setPersonResults] = useState<any[]>([]);
  const [personSearching, setPersonSearching] = useState(false);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const personDropdownRef = useRef<HTMLDivElement>(null);
  const personSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Duplicate detection
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const dupCheckTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Re-hydrate when initialData arrives after mount (edit flow)
  useEffect(() => {
    if (mode === 'edit' && initialData) {
      setForm(hydrateFormFromCitation(initialData));
      setViolations(
        initialData.violations?.length
          ? hydrateViolations(initialData.violations)
          : [newDraft()],
      );
      setPersonSearch(initialData.person_name || '');
    }
  }, [mode, initialData?.id]);

  // Close person dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (personDropdownRef.current && !personDropdownRef.current.contains(e.target as Node)) {
        setShowPersonDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Duplicate detection — checks across name + first violation's statute
  useEffect(() => {
    const name = form.person_name?.trim();
    const firstStatute = violations[0]?.statute_citation?.trim();
    if (!name || name.length < 3 || !firstStatute || firstStatute.length < 2) {
      setDuplicateWarning(null);
      return;
    }
    if (dupCheckTimer.current) clearTimeout(dupCheckTimer.current);
    dupCheckTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch<{ data: any[] }>(`/citations/search?q=${encodeURIComponent(name)}`);
        const matches = (res.data || []).filter(
          (c: any) =>
            c.statute_citation?.toLowerCase() === firstStatute.toLowerCase()
            && c.person_name?.toLowerCase().includes(name.toLowerCase())
            && (mode !== 'edit' || c.id !== initialData?.id),
        );
        if (matches.length > 0) {
          const m = matches[0];
          setDuplicateWarning(
            `Similar citation exists for ${m.person_name} — ${m.statute_citation} on ${formatDate(m.violation_date || m.created_at)}`,
          );
        } else {
          setDuplicateWarning(null);
        }
      } catch {
        setDuplicateWarning(null);
      }
    }, 500);
    return () => { if (dupCheckTimer.current) clearTimeout(dupCheckTimer.current); };
  }, [form.person_name, violations[0]?.statute_citation, mode, initialData?.id]);

  // ── Person search ───────────────────────────────────────

  const handlePersonSearchChange = (val: string) => {
    setPersonSearch(val);
    if (personSearchTimer.current) clearTimeout(personSearchTimer.current);
    if (val.length < 2) {
      setPersonResults([]);
      setShowPersonDropdown(false);
      return;
    }
    setPersonSearching(true);
    personSearchTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch<{ data: any[] }>(
          `/records/persons/search?q=${encodeURIComponent(val)}&limit=10`,
        );
        setPersonResults(res.data || []);
        setShowPersonDropdown(true);
      } catch {
        setPersonResults([]);
      } finally {
        setPersonSearching(false);
      }
    }, 300);
  };

  const selectPerson = (p: any) => {
    setForm(prev => ({
      ...prev,
      person_id: String(p.id),
      person_name: [p.last_name, p.first_name].filter(Boolean).join(', '),
      person_dob: p.dob || '',
      person_dl: p.dl_number || '',
      person_address: [p.address, p.city, p.state, p.zip].filter(Boolean).join(', '),
      person_phone: p.phone || prev.person_phone,
      person_email: p.email || prev.person_email,
    }));
    setPersonSearch([p.last_name, p.first_name].filter(Boolean).join(', '));
    setShowPersonDropdown(false);
  };

  const clearPerson = () => {
    setForm(prev => ({
      ...prev, person_id: '', person_name: '', person_dob: '', person_dl: '', person_address: '',
      person_phone: '', person_email: '',
    }));
    setPersonSearch('');
  };

  // ── Form helpers ────────────────────────────────────────

  const updateField = useCallback((key: keyof CitationAuthorForm, value: any) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'zone_id' || key === 'beat_id') {
        const z = key === 'zone_id' ? value : prev.zone_id;
        const b = key === 'beat_id' ? value : prev.beat_id;
        next.zone_beat = (z && b) ? `${z}-${b}` : '';
      }
      return next;
    });
  }, []);

  // Legacy single-statute lookup mirrors a pick into the FIRST violation
  // so the existing top-of-form StatuteLookup still helps officers.
  const handleStatuteSelect = (statute: StatuteResult) => {
    setViolations(prev => {
      if (prev.length === 0) return prev;
      const first = prev[0];
      return [
        {
          ...first,
          statute_id: statute.id,
          statute_citation: statute.citation,
          description: first.description || statute.short_title,
          offense_level: (first.offense_level
            || (statute.offense_level?.toLowerCase().startsWith('fel')
              ? 'Felony'
              : statute.offense_level?.toLowerCase().startsWith('mis')
                ? 'Misdemeanor'
                : 'Infraction')) as ViolationDraft['offense_level'],
          fine_amount: first.fine_amount > 0
            ? first.fine_amount
            : Number(statute.citation_fine ?? 0),
        },
        ...prev.slice(1),
      ];
    });
  };

  // ── Save ────────────────────────────────────────────────

  const handleSave = async () => {
    // Pull statute fields off the FIRST violation for legacy single-field
    // payload columns (server still reads them as the "primary" citation).
    const primary = violations[0];
    const isValid = runValidation(
      {
        ...form,
        violation_description: primary?.description || form.violation_description,
        violation_date: form.violation_date,
      },
      {
        violation_description: { required: true, minLength: 3 },
        violation_date: { required: true, custom: isValidDate, customMessage: 'Valid date required' },
        person_name: { required: true },
        vehicle_plate: { custom: (v) => !v || isValidPlate(v), customMessage: 'Invalid plate format (2–8 alphanumeric)' },
        vehicle_state: { custom: (v) => !v || isValidState(v), customMessage: 'Invalid US state abbreviation' },
      },
    );
    if (!isValid) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      const fineTotal = totalFineOf(violations);
      const payload: any = {
        ...form,
        person_id: form.person_id ? parseInt(form.person_id, 10) : null,
        statute_id: primary?.statute_id ?? (form.statute_id ? parseInt(form.statute_id, 10) : null),
        statute_citation: primary?.statute_citation || form.statute_citation,
        violation_description: primary?.description || form.violation_description,
        offense_level: primary?.offense_level || form.offense_level,
        fine_amount: fineTotal > 0 ? fineTotal : (form.fine_amount ? parseFloat(form.fine_amount) : null),
        issuing_officer_id: (user as any)?.userId || null,
        // Multi-violation payload (Task 5: server accepts violations[])
        violations: violations.map(({ id: _id, ...rest }) => rest),
      };
      const result = await apiFetch<{ data: any }>(
        mode === 'create' ? '/citations' : `/citations/${initialData?.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PUT',
          body: JSON.stringify(payload),
        },
      );
      setSaveSuccess(true);
      const newId = result?.data?.id ?? initialData?.id;
      setTimeout(() => {
        setSaveSuccess(false);
        onSaved(newId);
      }, 800);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save citation');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    clearFormErrors();
    setSaveError('');
    setSaveSuccess(false);
    onCancel();
  };

  const showVehicleSection = form.type === 'traffic' || form.type === 'parking';
  const isEdit = mode === 'edit';
  const statuteCategoryFilter =
    form.type === 'traffic' || form.type === 'parking' ? 'vehicle' as const : undefined;

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 gap-3 flex-wrap">
        <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-300">
          {isEdit ? `Edit Citation ${initialData?.citation_number || ''}` : 'New Citation / Summons'}
        </h2>
        <div className="flex items-center gap-2">
          <CitationPdfPreview
            form={formToData(form as any, violations)}
            mode={previewMode}
            onModeChange={setPreviewMode}
          />
          <button type="button" onClick={handleCancel} className="text-rmpg-400 hover:text-rmpg-200 transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent p-4 space-y-5">
        {saveError && (
          <div className="bg-red-900/40 border border-red-700/50 px-3 py-2 text-xs text-red-300 flex items-center gap-2">
            <AlertTriangle size={14} /> {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="bg-green-900/40 border border-green-700/50 px-3 py-2 text-xs text-green-300 flex items-center gap-2">
            <Check size={14} /> Citation saved successfully
          </div>
        )}
        {duplicateWarning && (
          <div className="bg-amber-900/40 border border-amber-700/50 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
            <AlertTriangle size={14} className="flex-shrink-0" /> {duplicateWarning}
          </div>
        )}

        {/* Type selector */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2">Citation Type</h3>
          <div className={`flex ${isMobile ? 'flex-col' : 'flex-wrap'} gap-2`}>
            {CITATION_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => updateField('type', t.value)}
                className={`px-3 ${isMobile ? 'py-3 text-sm' : 'py-1.5 text-xs'} font-bold uppercase transition-colors border ${
                  form.type === t.value
                    ? TYPE_BADGE[t.value] + ' ring-1 ring-brand-500/50'
                    : 'border-rmpg-600 text-rmpg-400 bg-rmpg-800/40 hover:bg-rmpg-700/50'
                }`}
                style={isMobile ? { minHeight: 48 } : undefined}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {isEdit && (
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2">Status</h3>
            <Combobox
              value={CITATION_STATUSES.find(s => s.value === form.status) ?? null}
              onChange={(opt) => updateField('status', opt?.value ?? 'issued')}
              options={CITATION_STATUSES}
              getLabel={(o) => o.label}
              getKey={(o) => o.value}
              placeholder="Status…"
            />
          </section>
        )}

        {/* Violations — multi-violation stack */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2 flex items-center gap-1.5">
            <Scale size={12} /> Violations
          </h3>
          <div className="mb-3">
            <label className="field-label">Quick Statute Search</label>
            <StatuteLookup
              onSelect={handleStatuteSelect}
              value={violations[0]?.statute_citation || undefined}
              onClear={() => {
                setViolations(prev => prev.length === 0 ? prev : [
                  { ...prev[0], statute_id: undefined, statute_citation: '', offense_level: 'Infraction' },
                  ...prev.slice(1),
                ]);
              }}
              categoryFilter={statuteCategoryFilter}
              placeholder="Search statute code or description..."
              aria-label="Search statute code or description..."
              showStateFilter
            />
          </div>
          <ViolationStack
            value={violations}
            onChange={setViolations}
            statuteFetcher={statuteFetcher}
          />
          {formErrors.violation_description && (
            <p className="text-red-400 text-[10px] mt-1">{formErrors.violation_description}</p>
          )}
        </section>

        {/* Subject */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2 flex items-center gap-1.5">
            <User size={12} /> Subject
          </h3>
          <div className="space-y-3">
            <div ref={personDropdownRef} className="relative">
              <label className="field-label">Search Existing Person</label>
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-400" />
                <input
                  type="text"
                  value={personSearch}
                  onChange={e => handlePersonSearchChange(e.target.value)}
                  onFocus={() => { if (personResults.length > 0) setShowPersonDropdown(true); }}
                  placeholder="Search by name or DL..." aria-label="Search by name or driver's license"
                  autoComplete="off"
                  className="input-dark w-full py-2 pl-8 pr-8 text-xs min-h-[36px]"
                />
                {personSearching && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-rmpg-400 animate-spin" />}
                {form.person_id && (
                  <button type="button" onClick={clearPerson} className="absolute right-3 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-rmpg-200" aria-label="Clear linked person">
                    <X size={12} />
                  </button>
                )}
              </div>
              {showPersonDropdown && personResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-rmpg-800 border border-rmpg-600 shadow-xl max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
                  {personResults.map((p: any) => (
                    <button type="button"
                      key={p.id}
                      onClick={() => selectPerson(p)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-rmpg-700/50 border-b border-rmpg-700/50 last:border-b-0 transition-colors"
                    >
                      <div className="font-semibold text-rmpg-200">{p.last_name}, {p.first_name}</div>
                      <div className="text-[10px] text-rmpg-400">
                        {p.dob ? `DOB: ${formatDate(p.dob)}` : ''} {p.dl_number ? `DL: ${p.dl_number}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {form.person_id && (
              <div className="text-[10px] text-brand-300 bg-brand-900/20 px-2 py-1 flex items-center gap-1">
                <Check size={10} /> Linked to person record #{form.person_id}
              </div>
            )}

            <div>
              <label className="field-label">Full Name *</label>
              <input
                type="text"
                value={form.person_name}
                onChange={e => updateField('person_name', e.target.value)}
                placeholder="Last, First Middle"
                autoComplete="off"
                className={`input-dark w-full py-2 text-xs ${formErrors.person_name ? 'border-red-500' : ''}`}
              />
              {formErrors.person_name && <p className="text-red-400 text-[10px] mt-1">{formErrors.person_name}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Date of Birth</label>
                <input type="date" value={form.person_dob} onChange={e => updateField('person_dob', e.target.value)} className="input-dark w-full py-2 text-xs min-h-[36px]" />
              </div>
              <div>
                <label className="field-label">Driver License #</label>
                <input type="text" value={form.person_dl} onChange={e => updateField('person_dl', e.target.value)} placeholder="DL number" className="input-dark w-full py-2 text-xs font-mono min-h-[36px]" />
              </div>
            </div>

            <div>
              <label className="field-label">Address</label>
              <input type="text" value={form.person_address} onChange={e => updateField('person_address', e.target.value)} placeholder="Street, City, State ZIP" className="input-dark w-full py-2 text-xs min-h-[36px]" />
            </div>

            {/* Contact for digital delivery of defendant copy (PR1).
                When provided, the issued copy is emailed/SMSed on signature
                complete with a presigned R2 link — SMS pipeline lands in PR6. */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="field-label">Phone</label>
                <input
                  type="tel"
                  value={form.person_phone}
                  onChange={e => updateField('person_phone', e.target.value)}
                  placeholder="(801) 555-0100"
                  className="input-dark w-full py-2 text-xs min-h-[36px]"
                  aria-label="Defendant phone (optional)"
                />
              </div>
              <div>
                <label className="field-label">Email</label>
                <input
                  type="email"
                  value={form.person_email}
                  onChange={e => updateField('person_email', e.target.value)}
                  placeholder="defendant@example.com"
                  className="input-dark w-full py-2 text-xs min-h-[36px]"
                  aria-label="Defendant email (optional)"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Vehicle */}
        {showVehicleSection && (
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2 flex items-center gap-1.5">
              <Car size={12} /> Vehicle Information
            </h3>
            <div className="space-y-3">
              <div>
                <label className="field-label">Vehicle Description</label>
                <input type="text" value={form.vehicle_description} onChange={e => updateField('vehicle_description', e.target.value)} placeholder="Year Make Model Color" className="input-dark w-full py-2 text-xs min-h-[36px]" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">License Plate</label>
                  <input type="text" value={form.vehicle_plate} onChange={e => updateField('vehicle_plate', e.target.value.toUpperCase())} placeholder="ABC1234" className="input-dark w-full py-2 text-xs font-mono uppercase min-h-[36px]" />
                  {formErrors.vehicle_plate && <p className="text-red-400 text-[10px] mt-1">{formErrors.vehicle_plate}</p>}
                </div>
                <div>
                  <label className="field-label">State</label>
                  <Combobox
                    value={US_STATE_OPTIONS.find(o => o.value === form.vehicle_state) ?? null}
                    onChange={(opt) => updateField('vehicle_state', opt?.value ?? 'UT')}
                    options={US_STATE_OPTIONS}
                    getLabel={(o) => o.label}
                    getKey={(o) => o.value}
                    placeholder="State…"
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Location & Time */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2 flex items-center gap-1.5">
            <Calendar size={12} /> Location & Time
          </h3>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Violation Date *</label>
                <input
                  type="date"
                  value={form.violation_date}
                  onChange={e => updateField('violation_date', e.target.value)}
                  className={`input-dark w-full py-2 text-xs ${formErrors.violation_date ? 'border-red-500' : ''}`}
                />
                {formErrors.violation_date && <p className="text-red-400 text-[10px] mt-1">{formErrors.violation_date}</p>}
              </div>
              <div>
                <label className="field-label">Violation Time</label>
                <input type="time" value={form.violation_time} onChange={e => updateField('violation_time', e.target.value)} className="input-dark w-full py-2 text-xs min-h-[36px]" />
              </div>
            </div>
            <div>
              <label className="field-label"><MapPin size={10} className="inline mr-1" /> Location</label>
              <input type="text" value={form.location} onChange={e => updateField('location', e.target.value)} placeholder="Address or intersection" className="input-dark w-full py-2 text-xs min-h-[36px]" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(() => {
                const sectionOpts = [{ value: '', label: '—' }, ...sectionOptions.map(s => ({ value: s, label: sectionLabels.get(s) || s }))];
                const zoneOpts = [{ value: '', label: '—' }, ...zonesForSection(form.section_id).map(z => ({ value: z, label: zoneLabels.get(z) || z }))];
                const beatOpts = [{ value: '', label: '—' }, ...beatsForZone(form.zone_id).map(b => ({ value: b, label: getBeatLabel(form.zone_id, b) }))];
                return (
                  <>
                    <div>
                      <label className="block text-xs text-rmpg-400 mb-1">Section</label>
                      <Combobox
                        value={sectionOpts.find(o => o.value === (form.section_id || '')) ?? sectionOpts[0]}
                        onChange={(opt) => { updateField('section_id', opt?.value ?? ''); updateField('zone_id', ''); updateField('beat_id', ''); }}
                        options={sectionOpts}
                        getLabel={(o) => o.label}
                        getKey={(o) => o.value || '__none__'}
                        placeholder="Section…"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-rmpg-400 mb-1">Zone</label>
                      <Combobox
                        value={zoneOpts.find(o => o.value === (form.zone_id || '')) ?? zoneOpts[0]}
                        onChange={(opt) => { updateField('zone_id', opt?.value ?? ''); updateField('beat_id', ''); }}
                        options={zoneOpts}
                        getLabel={(o) => o.label}
                        getKey={(o) => o.value || '__none__'}
                        placeholder="Zone…"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-rmpg-400 mb-1">Beat</label>
                      <Combobox
                        value={beatOpts.find(o => o.value === (form.beat_id || '')) ?? beatOpts[0]}
                        onChange={(opt) => updateField('beat_id', opt?.value ?? '')}
                        options={beatOpts}
                        getLabel={(o) => o.label}
                        getKey={(o) => o.value || '__none__'}
                        placeholder="Beat…"
                      />
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </section>

        {/* Officer */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2 flex items-center gap-1.5">
            <User size={12} /> Issuing Officer
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">Officer Name</label>
              <input type="text" value={form.issuing_officer_name} onChange={e => updateField('issuing_officer_name', e.target.value)} className="input-dark w-full py-2 text-xs min-h-[36px]" />
            </div>
            <div>
              <label className="field-label">Badge #</label>
              <input type="text" value={form.badge_number} onChange={e => updateField('badge_number', e.target.value)} className="input-dark w-full py-2 text-xs font-mono min-h-[36px]" />
            </div>
          </div>
        </section>

        {/* Court — PR1: replaced plain text input with Utah Justice Courts
            dropdown. Picking a court auto-fills the address. Officer can
            still override either via the free-text fields below the picker. */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2 flex items-center gap-1.5">
            <Scale size={12} /> Court Information
          </h3>
          <div className="space-y-3">
            <div>
              <label className="field-label">Court Date</label>
              <input type="date" value={form.court_date} onChange={e => updateField('court_date', e.target.value)} className="input-dark w-full py-2 text-xs min-h-[36px]" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="field-label">Court Time</label>
                <input type="time" value={form.court_time} onChange={e => updateField('court_time', e.target.value)} className="input-dark w-full py-2 text-xs min-h-[36px]" />
              </div>
              <div>
                <label className="field-label">Room/Dept</label>
                <input type="text" value={form.court_room} onChange={e => updateField('court_room', e.target.value)} placeholder="e.g. 1" className="input-dark w-full py-2 text-xs min-h-[36px]" />
              </div>
            </div>
            <div>
              <label className="field-label">Court (Utah Justice Courts)</label>
              <select
                value={form.court_name}
                onChange={(e) => {
                  const selected = UTAH_JUSTICE_COURTS.find((c) => c.name === e.target.value);
                  setForm((prev) => ({
                    ...prev,
                    court_name: e.target.value,
                    // Auto-fill address when picker matches a known court. If the
                    // officer has already typed a custom address, preserve it.
                    court_address: selected && !prev.court_address
                      ? selected.address
                      : prev.court_address,
                  }));
                }}
                className="input-dark w-full py-2 text-xs min-h-[36px]"
                aria-label="Court selection"
              >
                <option value="">— Select a court —</option>
                {Object.entries(courtsByCounty()).sort(([a], [b]) => a.localeCompare(b)).map(([county, list]) => (
                  <optgroup key={county} label={`${county} County`}>
                    {list.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Court Name (free-text override)</label>
              <input type="text" value={form.court_name} onChange={e => updateField('court_name', e.target.value)} placeholder="Override or add a new court" className="input-dark w-full py-2 text-xs min-h-[36px]" />
            </div>
            <div>
              <label className="field-label">Court Address</label>
              <input type="text" value={form.court_address} onChange={e => updateField('court_address', e.target.value)} placeholder="Street, City, State ZIP" className="input-dark w-full py-2 text-xs min-h-[36px]" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="appearance_required"
                checked={form.appearance_required}
                onChange={(e) => updateField('appearance_required', e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="appearance_required" className="field-label cursor-pointer">
                Mandatory court appearance (Class B+ misdemeanor, DUI, criminal)
              </label>
            </div>
          </div>
        </section>

        {/* Notes */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--panel-header-color)] font-bold mb-2">Notes</h3>
          <RichTextArea
            value={form.notes}
            onChange={e => updateField('notes', e.target.value)}
            placeholder="Additional notes or remarks..."
            rows={4}
            className="input-dark w-full py-2 text-xs resize-none min-h-[36px]"
          />
        </section>
      </div>

      {/* Footer */}
      <div className={`flex items-center ${isMobile ? 'flex-col gap-2' : 'justify-end gap-3'} px-4 py-3 border-t border-rmpg-700`}>
        <span className="text-[10px] text-fg-muted mr-auto">
          Total fine: <span className="text-[color:var(--panel-header-color)] font-bold">${totalFineOf(violations).toFixed(2)}</span>
          {' · '}
          {violations.length} violation{violations.length === 1 ? '' : 's'}
        </span>
        <button type="button"
          onClick={handleSave}
          disabled={saving}
          className={`toolbar-btn toolbar-btn-primary disabled:opacity-50 disabled:cursor-not-allowed ${isMobile ? 'w-full justify-center' : ''}`}
          style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}
        >
          {saving ? (
            <><Loader2 size={14} className="animate-spin" /> Saving...</>
          ) : (
            <><Check size={14} /> {isEdit ? 'Save Changes' : 'Create Citation'}</>
          )}
        </button>
        <button type="button" onClick={handleCancel} className={`px-4 py-2 text-xs font-bold uppercase text-rmpg-300 hover:text-rmpg-100 transition-colors ${isMobile ? 'w-full text-center' : ''}`} style={isMobile ? { minHeight: 48 } : undefined}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Hydration helpers ───────────────────────────────────

function hydrateFormFromCitation(c: any): CitationAuthorForm {
  return {
    type: c.type,
    status: c.status,
    person_id: c.person_id ? String(c.person_id) : '',
    person_name: c.person_name || '',
    person_dob: c.person_dob || '',
    person_dl: c.person_dl || '',
    person_address: c.person_address || '',
    person_phone: c.person_phone || '',
    person_email: c.person_email || '',
    vehicle_description: c.vehicle_description || '',
    vehicle_plate: c.vehicle_plate || '',
    vehicle_state: c.vehicle_state || 'UT',
    statute_id: c.statute_id ? String(c.statute_id) : '',
    statute_citation: c.statute_citation || '',
    violation_description: c.violation_description || '',
    offense_level: c.offense_level || '',
    fine_amount: c.fine_amount != null ? String(c.fine_amount) : '',
    violation_date: c.violation_date || '',
    violation_time: c.violation_time || '',
    location: c.location || '',
    issuing_officer_name: c.issuing_officer_name || '',
    badge_number: c.badge_number || '',
    court_date: c.court_date || '',
    court_name: c.court_name || '',
    court_address: c.court_address || '',
    notes: c.notes || '',
    section_id: c.section_id || '',
    zone_id: c.zone_id || '',
    beat_id: c.beat_id || '',
    zone_beat: c.zone_beat || '',
    vehicle_vin: c.vehicle_vin || '',
    vehicle_year: c.vehicle_year || '',
    vehicle_make: c.vehicle_make || '',
    vehicle_model: c.vehicle_model || '',
    vehicle_color: c.vehicle_color || '',
    speed_recorded: c.speed_recorded != null ? String(c.speed_recorded) : '',
    speed_limit: c.speed_limit != null ? String(c.speed_limit) : '',
    radar_type: c.radar_type || '',
    bac_level: c.bac_level != null ? String(c.bac_level) : '',
    bond_amount: c.bond_amount != null ? String(c.bond_amount) : '',
    bond_type: c.bond_type || '',
    is_warning: !!c.is_warning,
    school_zone: !!c.school_zone,
    construction_zone: !!c.construction_zone,
    accident_related: !!c.accident_related,
    dui_related: !!c.dui_related,
    commercial_vehicle: !!c.commercial_vehicle,
    court_time: c.court_time || '',
    court_room: c.court_room || '',
    appearance_required: !!c.appearance_required,
  };
}

function hydrateViolations(arr: any[]): ViolationDraft[] {
  if (!Array.isArray(arr) || arr.length === 0) return [newDraft()];
  return arr.map((v) => {
    const base = newDraft();
    return {
      id: base.id,
      statute_id: v.statute_id ?? undefined,
      statute_citation: v.statute_citation ?? '',
      description: v.violation_description ?? v.description ?? '',
      offense_level: (v.offense_level ?? 'Infraction') as ViolationDraft['offense_level'],
      fine_amount: Number(v.fine_amount ?? 0),
    };
  });
}
