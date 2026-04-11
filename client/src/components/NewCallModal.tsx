import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { X, Phone, AlertTriangle, Clock, History, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { CallForService, CallPriority, CallSource } from '../types';
import { INCIDENT_TYPE_CATEGORIES, type IncidentType } from '../utils/caseNumbers';
import {
  WEATHER_OPTIONS,
  LIGHTING_OPTIONS,
  WEAPONS_OPTIONS,
  LE_AGENCY_OPTIONS,
  SCENE_SAFETY_OPTIONS,
  DIRECTION_OPTIONS,
} from '../utils/callOptions';
import AddressAutocomplete, { type ParsedAddress } from './AddressAutocomplete';
import { formatPhoneInput } from '../utils/formatters';
import PremiseHistory from './PremiseHistory';
import SafetyScreening from './SafetyScreening';
import DuplicateCallWarning from './DuplicateCallWarning';
import BoloAlertBanner from './BoloAlertBanner';
import { useDistrictIdentify, useDistrictOptions } from '../hooks/useDistrictLookup';
import { apiFetch } from '../hooks/useApi';

interface NewCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (call: Partial<CallForService>) => void | Promise<void>;
  properties?: { id: string; name: string }[];
  clients?: { id: string; name: string; contact_name?: string; contact_phone?: string; address?: string }[];
  initialData?: Partial<Record<string, any>>;
  defaultMode?: 'quick' | 'full';
}

const CALL_SOURCES: { value: CallSource; label: string }[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'radio', label: 'Radio' },
  { value: 'walk_in', label: 'Walk-In' },
  { value: 'alarm', label: 'Alarm System' },
  { value: 'patrol', label: 'Patrol Observation' },
  { value: 'online', label: 'Online Report' },
  { value: 'dispatch', label: 'Dispatch Initiated' },
  { value: 'other', label: 'Other' },
];

export const PRIORITY_OPTIONS: { value: CallPriority; label: string; color: string; desc: string }[] = [
  { value: 'P1', label: 'P1', color: 'border-red-500 text-red-400 bg-red-900/30', desc: 'Emergency' },
  { value: 'P2', label: 'P2', color: 'border-amber-500 text-amber-400 bg-amber-900/30', desc: 'Urgent' },
  { value: 'P3', label: 'P3', color: 'border-brand-500 text-brand-400 bg-brand-900/30', desc: 'Routine' },
  { value: 'P4', label: 'P4', color: 'border-rmpg-500 text-rmpg-300 bg-rmpg-700/30', desc: 'Scheduled' },
];

export const PSO_SERVICE_TYPES: { value: string; label: string }[] = [
  { value: '', label: '-- Select Service Type --' },
  { value: 'patrol', label: 'Patrol Service' },
  { value: 'standing_guard', label: 'Standing Guard' },
  { value: 'event_security', label: 'Event Security' },
  { value: 'escort', label: 'Escort Service' },
  { value: 'process_service', label: 'Process Service' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'surveillance', label: 'Surveillance' },
  { value: 'alarm_response', label: 'Alarm Response' },
  { value: 'other', label: 'Other' },
];

export const PROCESS_SERVICE_DOC_TYPES: { value: string; label: string }[] = [
  { value: '', label: '-- Select Document Type --' },
  { value: 'summons', label: 'Summons' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'subpoena', label: 'Subpoena' },
  { value: 'writ', label: 'Writ' },
  { value: 'order', label: 'Court Order' },
  { value: 'notice', label: 'Notice' },
  { value: 'petition', label: 'Petition' },
  { value: 'other', label: 'Other' },
];

const CALLER_RELATIONSHIPS = [
  { value: '', label: '-- Select --' },
  { value: 'employee', label: 'Employee' },
  { value: 'victim', label: 'Victim' },
  { value: 'witness', label: 'Witness' },
  { value: 'complainant', label: 'Complainant' },
  { value: 'management', label: 'Management' },
  { value: 'alarm_company', label: 'Alarm Company' },
  { value: 'officer', label: 'Officer' },
  { value: 'anonymous', label: 'Anonymous' },
  { value: 'other', label: 'Other' },
];

const DEFAULT_FORM_DATA = {
  incident_type: 'suspicious_activity' as IncidentType,
  priority: 'P3' as CallPriority,
  caller_name: '',
  caller_phone: '',
  caller_relationship: '',
  caller_address: '',
  location: '',
  property_id: '',
  client_id: '',
  description: '',
  source: 'phone' as CallSource,
  cross_street: '',
  location_building: '',
  location_floor: '',
  location_room: '',
  zone_beat: '',
  sector_id: '',
  zone_id: '',
  beat_id: '',
  weapons_involved: '',
  injuries_reported: false,
  num_subjects: '',
  num_victims: '',
  subject_description: '',
  vehicle_description: '',
  direction_of_travel: '',
  scene_safety: '',
  weather_conditions: '',
  lighting_conditions: '',
  alcohol_involved: false,
  drugs_involved: false,
  domestic_violence: false,
  supervisor_notified: false,
  le_notified: false,
  le_agency: '',
  le_case_number: '',
  mental_health_crisis: false,
  juvenile_involved: false,
  felony_in_progress: false,
  officer_safety_caution: false,
  k9_requested: false,
  ems_requested: false,
  fire_requested: false,
  hazmat: false,
  gang_related: false,
  evidence_collected: false,
  body_camera_active: false,
  photos_taken: false,
  trespass_issued: false,
  vehicle_pursuit: false,
  foot_pursuit: false,
  damage_estimate: '',
  damage_description: '',
  responding_officer: '',
  action_taken: '',
  contract_id: '',
  // PSO Client Request fields
  pso_service_type: '',
  pso_authorization: '',
  pso_requestor_name: '',
  pso_requestor_phone: '',
  pso_requestor_email: '',
  pso_billing_code: '',
  // Process Service fields (sub-type of PSO)
  process_service_type: '',
  process_served_to: '',
  process_served_address: '',
  // Historical entry fields
  is_historical: false,
  historical_date: '',
  historical_time: '',
  historical_status: 'closed',
  historical_disposition: '',
  historical_dispatched_at: '',
  historical_enroute_at: '',
  historical_onscene_at: '',
  historical_cleared_at: '',
  historical_closed_at: '',
};

const DRAFT_KEY = 'rmpg_new_call_draft';

export default function NewCallModal({ isOpen, onClose, onSubmit, properties = [], clients = [], initialData, defaultMode = 'quick' }: NewCallModalProps) {
  const [formData, setFormData] = useState({ ...DEFAULT_FORM_DATA });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<'quick' | 'full'>(defaultMode);
  const [hasDraft, setHasDraft] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const { identify: identifyDistrict } = useDistrictIdentify();
  const { sections, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();

  // Person/vehicle record search for linking
  const [personSearchResults, setPersonSearchResults] = useState<any[]>([]);
  const [vehicleSearchResults, setVehicleSearchResults] = useState<any[]>([]);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const [showVehicleDropdown, setShowVehicleDropdown] = useState(false);
  const personSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vehicleSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personDropdownRef = useRef<HTMLDivElement>(null);
  const vehicleDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPersonDropdown && !showVehicleDropdown) return;
    const handler = (e: MouseEvent) => {
      if (showPersonDropdown && personDropdownRef.current && !personDropdownRef.current.contains(e.target as Node)) setShowPersonDropdown(false);
      if (showVehicleDropdown && vehicleDropdownRef.current && !vehicleDropdownRef.current.contains(e.target as Node)) setShowVehicleDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPersonDropdown, showVehicleDropdown]);

  const searchPersons = useCallback((query: string) => {
    if (personSearchTimerRef.current) clearTimeout(personSearchTimerRef.current);
    if (query.length < 2) { setPersonSearchResults([]); setShowPersonDropdown(false); return; }
    personSearchTimerRef.current = setTimeout(async () => {
      try {
        const results = await apiFetch<any[]>(`/records/persons/search?q=${encodeURIComponent(query)}`);
        setPersonSearchResults(Array.isArray(results) ? results.slice(0, 10) : []);
        setShowPersonDropdown(true);
      } catch { setPersonSearchResults([]); }
    }, 300);
  }, []);

  const searchVehicles = useCallback((query: string) => {
    if (vehicleSearchTimerRef.current) clearTimeout(vehicleSearchTimerRef.current);
    if (query.length < 2) { setVehicleSearchResults([]); setShowVehicleDropdown(false); return; }
    vehicleSearchTimerRef.current = setTimeout(async () => {
      try {
        const results = await apiFetch<any[]>(`/records/vehicles/search?q=${encodeURIComponent(query)}`);
        setVehicleSearchResults(Array.isArray(results) ? results.slice(0, 10) : []);
        setShowVehicleDropdown(true);
      } catch { setVehicleSearchResults([]); }
    }, 300);
  }, []);

  // Pre-fill form when initialData changes, or restore draft on open
  useEffect(() => {
    if (isOpen && initialData) {
      setFormData({ ...DEFAULT_FORM_DATA, ...initialData } as typeof DEFAULT_FORM_DATA);
      setHasDraft(false);
    } else if (isOpen) {
      // Check for saved draft
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        try {
          const parsed = JSON.parse(draft);
          if (parsed._savedAt && Date.now() - parsed._savedAt < 24 * 60 * 60 * 1000) {
            delete parsed._savedAt;
            setFormData({ ...DEFAULT_FORM_DATA, ...parsed });
            setHasDraft(true);
            return;
          }
        } catch { /* ignore corrupt draft */ }
        localStorage.removeItem(DRAFT_KEY);
      }
      setFormData({ ...DEFAULT_FORM_DATA });
      setHasDraft(false);
    }
    if (isOpen) setMode(defaultMode);
  }, [isOpen, initialData, defaultMode]);

  // Save draft on close (if form has meaningful data)
  const handleClose = () => {
    const hasData = Object.entries(formData).some(([key, val]) => {
      // Skip fields that have default dropdown values
      if (key === 'incident_type' || key === 'priority' || key === 'source' || key === 'historical_status') return false;
      const defaultVal = DEFAULT_FORM_DATA[key as keyof typeof DEFAULT_FORM_DATA];
      return val !== defaultVal && val !== '' && val !== false;
    });
    if (hasData) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...formData, _savedAt: Date.now() }));
    }
    setHasDraft(false);
    onClose();
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setFormData({ ...DEFAULT_FORM_DATA });
    setHasDraft(false);
  };

  const onCloseRef = useRef(handleClose);
  onCloseRef.current = handleClose;

  // Body scroll lock — prevent background scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
    }
    return () => {
      const scrollY = Math.abs(parseInt(document.body.style.top || '0'));
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      if (scrollY > 0) window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  // Adjust modal height when iOS keyboard appears
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const handleResize = () => {
      const keyboardHeight = window.innerHeight - vv.height;
      const modalEl = document.querySelector('[data-modal-content]');
      if (modalEl && keyboardHeight > 100) {
        (modalEl as HTMLElement).style.maxHeight = `${vv.height * 0.7}px`;
      } else if (modalEl) {
        (modalEl as HTMLElement).style.maxHeight = '';
      }
    };

    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, [isOpen]);

  // Focus trap — only re-run on open/close transitions
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const raf = requestAnimationFrame(() => {
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) focusable[0].focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return; // Prevent double-submit

    // Build historical timestamps if historical entry mode is enabled
    const historicalFields: Record<string, any> = {};
    if (formData.is_historical) {
      // Combine date and time into "YYYY-MM-DD HH:MM:SS" format
      const dateStr = formData.historical_date;
      const timeStr = formData.historical_time || '00:00';
      if (dateStr) {
        historicalFields.created_at = `${dateStr} ${timeStr}:00`;
      }
      historicalFields.status = formData.historical_status || 'closed';
      if (formData.historical_disposition) {
        historicalFields.disposition = formData.historical_disposition;
      }
      // Pass individual status timestamps if provided
      if (formData.historical_dispatched_at) historicalFields.dispatched_at = `${formData.historical_dispatched_at}:00`;
      if (formData.historical_enroute_at) historicalFields.enroute_at = `${formData.historical_enroute_at}:00`;
      if (formData.historical_onscene_at) historicalFields.onscene_at = `${formData.historical_onscene_at}:00`;
      if (formData.historical_cleared_at) historicalFields.cleared_at = `${formData.historical_cleared_at}:00`;
      if (formData.historical_closed_at) historicalFields.closed_at = `${formData.historical_closed_at}:00`;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        ...formData,
        num_subjects: formData.num_subjects ? Number(formData.num_subjects) : undefined,
        num_victims: formData.num_victims ? Number(formData.num_victims) : undefined,
        damage_estimate: formData.damage_estimate ? Number(formData.damage_estimate) : undefined,
        status: formData.is_historical ? (formData.historical_status || 'closed') : 'pending',
        assigned_units: [],
        notes: [],
        ...historicalFields,
      } as any);
      // Only reset form on success (parent closes the modal)
      localStorage.removeItem(DRAFT_KEY);
      setHasDraft(false);
      setFormData({ ...DEFAULT_FORM_DATA });
    } catch {
      // Error is handled by the parent (toast shown there) — keep form data so user can retry
    } finally {
      setIsSubmitting(false);
    }
  };

  const update = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onClick={isSubmitting ? undefined : handleClose} style={{ touchAction: 'manipulation' }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" role="presentation" />

      {/* 78: Modal with deeper shadow for elevation */}
      <div className="relative w-full max-w-2xl mx-4 bg-surface-base border border-rmpg-600 animate-fade-in" style={{ boxShadow: '0 12px 48px rgba(0, 0, 0, 0.6)' }} onClick={(e) => e.stopPropagation()}>
        {/* Header - Toolbar style */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-600" style={{ background: 'linear-gradient(180deg, #181818 0%, #141414 100%)' }}>
          <div className="flex items-center gap-2">
            {formData.is_historical ? <History className="w-4 h-4 text-amber-400" /> : <Phone className="w-4 h-4 text-brand-400" />}
            <h2 id={titleId} className="text-xs font-bold text-white uppercase tracking-wider">
              {formData.is_historical ? 'Historical Call Entry' : 'New Call for Service'}
            </h2>
            {/* Quick / Full mode toggle */}
            <button
              type="button"
              onClick={() => setMode(m => m === 'quick' ? 'full' : 'quick')}
              className="ml-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border transition-colors flex items-center gap-1"
              style={{
                borderColor: mode === 'quick' ? '#d4a017' : '#383838',
                color: mode === 'quick' ? '#d4a017' : '#888888',
                background: mode === 'quick' ? 'rgba(212,160,23,0.1)' : 'transparent',
              }}
            >
              {mode === 'quick' ? (
                <><ChevronDown className="w-3 h-3" /> QUICK</>
              ) : (
                <><ChevronUp className="w-3 h-3" /> FULL</>
              )}
            </button>
          </div>
          {/* 79: Close button with rounded-sm and aria-label; 80: Disabled during submit */}
          <button type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-2 sm:p-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center hover:bg-rmpg-700 text-rmpg-300 hover:text-white transition-colors rounded-sm disabled:opacity-40"
            style={{ touchAction: 'manipulation' }}
            aria-label="Close">
            <X className="w-5 h-5 sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* Draft restored banner */}
        {hasDraft && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-900/30 border-b border-amber-700/30">
            <History className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Restored pending draft</span>
            <button type="button" onClick={discardDraft} className="ml-auto text-[9px] text-rmpg-400 hover:text-white transition-colors uppercase tracking-wider font-bold">
              Discard
            </button>
          </div>
        )}

        {/* Form */}
        {/* 81: Form with dark scrollbar; 82: Increased padding for readability */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[70dvh] sm:max-h-[70vh] overflow-y-auto scrollbar-dark" data-modal-content>
          {/* Row 1: Type + Source */}
          <div className={`grid gap-4 ${mode === 'full' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Incident Type</label>
              <select
                className="select-dark"
                value={formData.incident_type}
                onChange={(e) => update('incident_type', e.target.value)}
                required
              >
                {Object.entries(INCIDENT_TYPE_CATEGORIES).map(([category, types]) => (
                  <optgroup key={category} label={category}>
                    {types.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {mode === 'full' && (
              <div>
                <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Source</label>
                <select
                  className="select-dark"
                  value={formData.source}
                  onChange={(e) => update('source', e.target.value)}
                >
                  {CALL_SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* PSO Client Request fields — visible in both modes when PSO type is selected */}
          {formData.incident_type === 'pso_client_request' && (
            <div className="border border-purple-700/40 p-3 space-y-3" style={{ background: '#181818' }}>
              <div className="text-[9px] font-bold text-purple-400 uppercase tracking-wider mb-1">PSO Client Request Details</div>

              {/* Client / Requestor dropdown — auto-fills name, phone, address */}
              {clients.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-brand-gold-500 uppercase mb-1">Client / Requestor</label>
                  <select
                    className="select-dark w-full"
                    value={formData.client_id || ''}
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      const client = clients.find((c) => c.id === selectedId);
                      if (client) {
                        setFormData((prev) => ({
                          ...prev,
                          client_id: client.id,
                          pso_requestor_name: client.contact_name || prev.pso_requestor_name,
                          pso_requestor_phone: client.contact_phone || prev.pso_requestor_phone,
                          location: client.address || prev.location,
                        }));
                        // Track recently used client
                        try {
                          const recent = JSON.parse(localStorage.getItem('rmpg_recent_pso_clients') || '[]') as string[];
                          const updated = [selectedId, ...recent.filter((id: string) => id !== selectedId)].slice(0, 5);
                          localStorage.setItem('rmpg_recent_pso_clients', JSON.stringify(updated));
                        } catch { /* localStorage unavailable */ }
                      } else {
                        update('client_id', '');
                      }
                    }}
                    style={{ borderColor: '#6b21a8' }}
                  >
                    <option value="">-- Select Client --</option>
                    {(() => {
                      let recentIds: string[] = [];
                      try { recentIds = JSON.parse(localStorage.getItem('rmpg_recent_pso_clients') || '[]'); } catch { /* ignore */ }
                      const recentClients = recentIds.map((id: string) => clients.find((c) => c.id === id)).filter(Boolean) as typeof clients;
                      const otherClients = clients.filter((c) => !recentIds.includes(c.id));
                      return (
                        <>
                          {recentClients.length > 0 && (
                            <optgroup label="Recent">
                              {recentClients.map((c) => (
                                <option key={`recent-${c.id}`} value={c.id}>{c.name}{c.contact_name ? ` (${c.contact_name})` : ''}</option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label={recentClients.length > 0 ? 'All Clients' : 'Clients'}>
                            {otherClients.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}{c.contact_name ? ` (${c.contact_name})` : ''}</option>
                            ))}
                          </optgroup>
                        </>
                      );
                    })()}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Contract ID</label>
                  <input type="text" className="input-dark" placeholder="PSO contract #" value={formData.contract_id} onChange={(e) => update('contract_id', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Service Type</label>
                  <select className="select-dark" value={formData.pso_service_type || ''} onChange={(e) => update('pso_service_type', e.target.value)}>
                    {PSO_SERVICE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Authorization / PO #</label>
                  <input type="text" className="input-dark" placeholder="Auth or PO number" value={formData.pso_authorization || ''} onChange={(e) => update('pso_authorization', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Requestor Name</label>
                  <input type="text" className="input-dark" placeholder="Client contact" value={formData.pso_requestor_name || ''} onChange={(e) => update('pso_requestor_name', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Requestor Phone</label>
                  <input type="text" inputMode="tel" className="input-dark" placeholder="(801) 555-0100" value={formData.pso_requestor_phone || ''} onChange={(e) => update('pso_requestor_phone', formatPhoneInput(e.target.value))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Billing Code</label>
                  <input type="text" className="input-dark" placeholder="Billing code" value={formData.pso_billing_code || ''} onChange={(e) => update('pso_billing_code', e.target.value)} />
                </div>
              </div>
              {/* Process Service sub-section */}
              {formData.pso_service_type === 'process_service' && (
                <div className="panel-inset border border-amber-700/30 p-3 mt-2">
                  <div className="text-[9px] font-bold text-amber-400 uppercase tracking-wider mb-2">Process Service Details</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Document Type</label>
                      <select className="select-dark" value={formData.process_service_type || ''} onChange={(e) => update('process_service_type', e.target.value)}>
                        {PROCESS_SERVICE_DOC_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Serve To (Name)</label>
                      <input type="text" className="input-dark" placeholder="Person to be served" value={formData.process_served_to || ''} onChange={(e) => update('process_served_to', e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Service Address</label>
                    <input type="text" className="input-dark w-full" placeholder="Address for service" value={formData.process_served_address || ''} onChange={(e) => update('process_served_address', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Priority */}
          <div>
            <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-2">Priority</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update('priority', p.value)}
                  className={`
                    p-2 border-2 text-center transition-all
                    ${formData.priority === p.value
                      ? p.color
                      : 'border-rmpg-600 text-rmpg-400 hover:border-rmpg-400'
                    }
                  `}
                >
                  <div className="font-bold text-sm">{p.label}</div>
                  <div className="text-[10px]">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Caller Info — Quick: name + phone only; Full: all 4 fields */}
          <div className={`grid gap-4 ${mode === 'full' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2'}`}>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Caller Name</label>
              <input
                type="text"
                className="input-dark"
                placeholder="Caller name"
                value={formData.caller_name}
                onChange={(e) => update('caller_name', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Caller Phone</label>
              <input
                type="text"
                inputMode="tel"
                className="input-dark"
                placeholder="(801) 555-0000"
                value={formData.caller_phone}
                onChange={(e) => update('caller_phone', formatPhoneInput(e.target.value))}
              />
            </div>
            {mode === 'full' && (
              <div>
                <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Relationship</label>
                <select
                  className="select-dark"
                  value={formData.caller_relationship}
                  onChange={(e) => update('caller_relationship', e.target.value)}
                >
                  {CALLER_RELATIONSHIPS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}
            {mode === 'full' && (
              <div>
                <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Caller Address</label>
                <AddressAutocomplete
                  className="input-dark"
                  placeholder="Caller address"
                  value={formData.caller_address}
                  onChange={(val) => update('caller_address', val)}
                />
              </div>
            )}
          </div>

          {/* Officer Safety Auto-Screening — full mode only */}
          {mode === 'full' && <SafetyScreening callerName={formData.caller_name} subjectDescription={formData.subject_description} />}

          {/* BOLO Alert — full mode only */}
          {mode === 'full' && (
            <BoloAlertBanner
              address={formData.location}
              subject={formData.subject_description}
              vehicle={formData.vehicle_description}
            />
          )}

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Location / Address</label>
            <AddressAutocomplete
              className="input-dark"
              placeholder="123 Main St, Salt Lake City, UT"
              value={formData.location}
              onChange={(val) => update('location', val)}
              onSelect={async (addr: ParsedAddress) => {
                update('location', addr.formatted);
                if (addr.latitude != null) {
                  setFormData((prev) => ({ ...prev, latitude: addr.latitude as any, longitude: addr.longitude as any }));
                  // Auto-fill section/zone/beat from 3Tier district lookup
                  const district = await identifyDistrict(addr.latitude!, addr.longitude!);
                  if (district) {
                    setFormData((prev) => ({
                      ...prev,
                      sector_id: district.sector_id || prev.sector_id,
                      zone_id: district.zone_id || prev.zone_id,
                      beat_id: district.beat_id || prev.beat_id,
                    }));
                  }
                }
              }}
              required
            />
            {/* Address validation hint — zip code check */}
            {formData.location.length > 5 && (
              <div className="flex items-center gap-1 mt-0.5 text-[9px]">
                {/\b\d{5}(-\d{4})?\b/.test(formData.location)
                  ? <span className="text-green-400">&#10003; Address includes zip code</span>
                  : <span className="text-amber-400">&#9888; No zip code detected — consider adding one</span>}
              </div>
            )}
            {/* Premise History — auto-checks when address has 3+ chars */}
            <PremiseHistory address={formData.location} compact />
            {/* Duplicate Call Warning — flags active calls at same address */}
            <DuplicateCallWarning address={formData.location} />
          </div>

          {/* Description — moved up for faster tab flow */}
          <div>
            <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Description</label>
            <textarea
              className="textarea-dark"
              rows={mode === 'quick' ? 2 : 4}
              placeholder="Describe the situation..."
              value={formData.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>

          {/* ── Full Mode: Extended Fields ────────────────────── */}

          {/* Property — full mode only */}
          {mode === 'full' && properties.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Property</label>
              <select
                className="select-dark"
                value={formData.property_id}
                onChange={(e) => update('property_id', e.target.value)}
              >
                <option value="">-- No Property --</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Client — full mode only */}
          {mode === 'full' && clients.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Client</label>
              <select
                className="select-dark"
                value={formData.client_id}
                onChange={(e) => update('client_id', e.target.value)}
              >
                <option value="">— No Client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Location Details — full mode only */}
          {mode === 'full' && <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Cross Street</label>
              <input type="text" className="input-dark" placeholder="Nearest intersection" value={formData.cross_street} onChange={(e) => update('cross_street', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Building</label>
              <input type="text" className="input-dark" placeholder="Bldg A, Tower 2" value={formData.location_building} onChange={(e) => update('location_building', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Floor</label>
              <input type="text" className="input-dark" placeholder="3rd" value={formData.location_floor} onChange={(e) => update('location_floor', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Room / Suite</label>
              <input type="text" className="input-dark" placeholder="Suite 302" value={formData.location_room} onChange={(e) => update('location_room', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Section</label>
              <select className="select-dark" value={formData.sector_id} onChange={(e) => { update('sector_id', e.target.value); update('zone_id', ''); update('beat_id', ''); }}>
                <option value="">— Select —</option>
                {sections.map(s => <option key={s} value={s}>{sectionLabels.get(s) || s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Zone</label>
              <select className="select-dark" value={formData.zone_id} onChange={(e) => { update('zone_id', e.target.value); update('beat_id', ''); }}>
                <option value="">— Select —</option>
                {zonesForSection(formData.sector_id).map(z => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Beat</label>
              <select className="select-dark" value={formData.beat_id} onChange={(e) => update('beat_id', e.target.value)}>
                <option value="">— Select —</option>
                {beatsForZone(formData.zone_id).map(b => <option key={b} value={b}>{getBeatLabel(formData.zone_id, b)}</option>)}
              </select>
            </div>
          </div>}

          {/* Subject / Threat Info — full mode only */}
          {mode === 'full' && <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1"># Subjects</label>
              <input type="number" min="0" className="input-dark" placeholder="0" value={formData.num_subjects} onChange={(e) => update('num_subjects', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1"># Victims</label>
              <input type="number" min="0" className="input-dark" placeholder="0" value={formData.num_victims} onChange={(e) => update('num_victims', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Weapons</label>
              {(() => {
                const isCustom = formData.weapons_involved && !(WEAPONS_OPTIONS as readonly string[]).includes(formData.weapons_involved);
                return (<>
                  <select className="select-dark" value={isCustom ? 'Other' : (formData.weapons_involved || '')} onChange={(e) => update('weapons_involved', e.target.value)}>
                    <option value="">— Select —</option>
                    {WEAPONS_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                  {(formData.weapons_involved === 'Other' || isCustom) && (
                    <input type="text" className="input-dark mt-1" placeholder="Specify weapon..." value={isCustom ? formData.weapons_involved : ''} onChange={(e) => update('weapons_involved', e.target.value || 'Other')} />
                  )}
                </>);
              })()}
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Direction of Travel</label>
              <select className="select-dark" value={formData.direction_of_travel || ''} onChange={(e) => update('direction_of_travel', e.target.value)}>
                <option value="">— Select —</option>
                {DIRECTION_OPTIONS.filter(Boolean).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative" ref={personDropdownRef}>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Subject / Name <span className="text-rmpg-500 normal-case">(search records)</span></label>
              <input type="text" className="input-dark" placeholder="Type name to search records..." value={formData.subject_description} onChange={(e) => { update('subject_description', e.target.value); searchPersons(e.target.value); }} onFocus={() => { if (personSearchResults.length > 0) setShowPersonDropdown(true); }} />
              {showPersonDropdown && personSearchResults.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded-sm shadow-lg">
                  {personSearchResults.map((p: any) => (
                    <button type="button" key={p.id} className="w-full text-left px-2 py-1.5 text-xs text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
                      const desc = `${p.last_name || ''}, ${p.first_name || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') + (p.dob ? ` DOB:${p.dob}` : '');
                      update('subject_description', desc);
                      setShowPersonDropdown(false);
                    }}>
                      <span className="font-semibold text-white">{p.last_name}, {p.first_name}</span>
                      {p.dob && <span className="text-rmpg-400 ml-1">DOB: {p.dob}</span>}
                      {p.address && <span className="text-rmpg-500 ml-1 text-[10px]">— {p.address}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative" ref={vehicleDropdownRef}>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Vehicle <span className="text-rmpg-500 normal-case">(search records)</span></label>
              <input type="text" className="input-dark" placeholder="Type plate/make/model to search..." value={formData.vehicle_description} onChange={(e) => { update('vehicle_description', e.target.value); searchVehicles(e.target.value); }} onFocus={() => { if (vehicleSearchResults.length > 0) setShowVehicleDropdown(true); }} />
              {showVehicleDropdown && vehicleSearchResults.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded-sm shadow-lg">
                  {vehicleSearchResults.map((v: any) => (
                    <button type="button" key={v.id} className="w-full text-left px-2 py-1.5 text-xs text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
                      const desc = [v.color, v.year, v.make, v.model].filter(Boolean).join(' ') + (v.plate_number ? ` PLT:${v.plate_number}` : '') + (v.plate_state ? `/${v.plate_state}` : '');
                      update('vehicle_description', desc);
                      setShowVehicleDropdown(false);
                    }}>
                      <span className="font-semibold text-white">{[v.color, v.year, v.make, v.model].filter(Boolean).join(' ')}</span>
                      {v.plate_number && <span className="text-brand-400 ml-1">PLT: {v.plate_number}{v.plate_state ? `/${v.plate_state}` : ''}</span>}
                      {v.owner_first_name && <span className="text-rmpg-400 ml-1 text-[10px]">Owner: {v.owner_last_name}, {v.owner_first_name}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Scene Conditions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Scene Safety</label>
              <select className="select-dark" value={formData.scene_safety || ''} onChange={(e) => update('scene_safety', e.target.value)}>
                <option value="">— Select —</option>
                {SCENE_SAFETY_OPTIONS.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Weather</label>
              <select className="select-dark" value={formData.weather_conditions || ''} onChange={(e) => update('weather_conditions', e.target.value)}>
                <option value="">— Select —</option>
                {WEATHER_OPTIONS.filter(Boolean).map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Lighting</label>
              <select className="select-dark" value={formData.lighting_conditions || ''} onChange={(e) => update('lighting_conditions', e.target.value)}>
                <option value="">— Select —</option>
                {LIGHTING_OPTIONS.filter(Boolean).map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          {/* Damage Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Damage Estimate ($)</label>
              <input type="number" min="0" step="0.01" className="input-dark" placeholder="0.00" value={formData.damage_estimate} onChange={(e) => update('damage_estimate', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Damage Description</label>
              <input type="text" className="input-dark" placeholder="Describe damage..." value={formData.damage_description} onChange={(e) => update('damage_description', e.target.value)} />
            </div>
          </div>

          {/* Flags / Checkboxes */}
          <div>
            <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-2">Flags</label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.injuries_reported as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, injuries_reported: e.target.checked }))} className="accent-red-500" />
                Injuries Reported
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.alcohol_involved as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, alcohol_involved: e.target.checked }))} className="accent-amber-500" />
                Alcohol Involved
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.drugs_involved as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, drugs_involved: e.target.checked }))} className="accent-red-500" />
                Drugs Involved
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.domestic_violence as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, domestic_violence: e.target.checked }))} className="accent-red-500" />
                Domestic Violence
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.supervisor_notified as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, supervisor_notified: e.target.checked }))} className="accent-brand-500" />
                Supervisor Notified
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.le_notified as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, le_notified: e.target.checked }))} className="accent-brand-500" />
                LE Notified
              </label>
            </div>
            {/* Extended Operational Flags */}
            <div className="flex flex-wrap gap-4 mt-2 pt-2 border-t border-rmpg-700/50">
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.mental_health_crisis as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, mental_health_crisis: e.target.checked }))} className="accent-amber-500" />
                Mental Health Crisis
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.juvenile_involved as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, juvenile_involved: e.target.checked }))} className="accent-amber-500" />
                Juvenile Involved
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.felony_in_progress as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, felony_in_progress: e.target.checked }))} className="accent-red-500" />
                Felony in Progress
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.officer_safety_caution as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, officer_safety_caution: e.target.checked }))} className="accent-red-500" />
                Officer Safety Caution
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.k9_requested as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, k9_requested: e.target.checked }))} className="accent-brand-500" />
                K9 Requested
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.ems_requested as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, ems_requested: e.target.checked }))} className="accent-brand-500" />
                EMS Requested
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.fire_requested as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, fire_requested: e.target.checked }))} className="accent-brand-500" />
                Fire Requested
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.hazmat as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, hazmat: e.target.checked }))} className="accent-red-500" />
                HAZMAT
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.gang_related as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, gang_related: e.target.checked }))} className="accent-red-500" />
                Gang Related
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.evidence_collected as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, evidence_collected: e.target.checked }))} className="accent-green-500" />
                Evidence Collected
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.body_camera_active as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, body_camera_active: e.target.checked }))} className="accent-green-500" />
                Body Camera Active
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.photos_taken as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, photos_taken: e.target.checked }))} className="accent-green-500" />
                Photos Taken
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.trespass_issued as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, trespass_issued: e.target.checked }))} className="accent-amber-500" />
                Trespass Issued
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.vehicle_pursuit as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, vehicle_pursuit: e.target.checked }))} className="accent-red-500" />
                Vehicle Pursuit
              </label>
              <label className="flex items-center gap-1.5 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={formData.foot_pursuit as boolean} onChange={(e) => setFormData((prev) => ({ ...prev, foot_pursuit: e.target.checked }))} className="accent-red-500" />
                Foot Pursuit
              </label>
            </div>
          </div>

          {/* LE Details (conditional) */}
          {formData.le_notified && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">LE Agency</label>
                {(() => {
                  const isCustom = formData.le_agency && !(LE_AGENCY_OPTIONS as readonly string[]).includes(formData.le_agency);
                  return (<>
                    <select className="select-dark" value={isCustom ? 'Other — See Notes' : (formData.le_agency || '')} onChange={(e) => update('le_agency', e.target.value)}>
                      <option value="">— Select Agency —</option>
                      {LE_AGENCY_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                    {(formData.le_agency === 'Other — See Notes' || isCustom) && (
                      <input type="text" className="input-dark mt-1" placeholder="Specify agency..." value={isCustom ? formData.le_agency : ''} onChange={(e) => update('le_agency', e.target.value || 'Other — See Notes')} />
                    )}
                  </>);
                })()}
              </div>
              <div>
                <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">LE Case Number</label>
                <input type="text" className="input-dark" placeholder="PD-2026-1234" value={formData.le_case_number} onChange={(e) => update('le_case_number', e.target.value)} />
              </div>
            </div>
          )}

          {/* Responding Officer */}
          <div>
            <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Responding Officer</label>
            <input type="text" className="input-dark" placeholder="Officer name or badge number" value={formData.responding_officer} onChange={(e) => update('responding_officer', e.target.value)} />
          </div>

          {/* Historical Entry Toggle */}
          <div className="border border-rmpg-600 p-3" style={{ background: formData.is_historical ? '#181818' : 'transparent' }}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_historical as boolean}
                onChange={(e) => setFormData((prev) => ({ ...prev, is_historical: e.target.checked }))}
                className="accent-amber-500"
              />
              <History className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Historical Entry</span>
              <span className="text-[10px] text-rmpg-400 ml-1">— Enter a past call for records / system setup</span>
            </label>

            {formData.is_historical && (
              <div className="mt-3 space-y-3 pl-5 border-l-2 border-amber-700/50">
                {/* Date/Time of original call */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Call Date *</label>
                    <input
                      type="date"
                      className="input-dark text-xs"
                      value={formData.historical_date}
                      onChange={(e) => update('historical_date', e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Call Time</label>
                    <input
                      type="time"
                      className="input-dark text-xs"
                      value={formData.historical_time}
                      onChange={(e) => update('historical_time', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Final Status</label>
                    <select
                      className="select-dark text-xs"
                      value={formData.historical_status}
                      onChange={(e) => update('historical_status', e.target.value)}
                    >
                      <option value="pending">Pending</option>
                      <option value="dispatched">Dispatched</option>
                      <option value="enroute">En Route</option>
                      <option value="onscene">On Scene</option>
                      <option value="cleared">Cleared</option>
                      <option value="closed">Closed</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>

                {/* Disposition */}
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Disposition</label>
                  <input
                    type="text"
                    className="input-dark text-xs"
                    placeholder="e.g. Report Taken, Unfounded, Warning Issued..."
                    value={formData.historical_disposition}
                    onChange={(e) => update('historical_disposition', e.target.value)}
                  />
                </div>

                {/* Status Timestamps (optional) */}
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Status Timestamps <span className="text-rmpg-500 normal-case">(optional)</span></label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                    <div>
                      <label className="block text-[9px] text-rmpg-400 mb-0.5">Dispatched</label>
                      <input type="datetime-local" className="input-dark text-[10px]" value={formData.historical_dispatched_at} onChange={(e) => update('historical_dispatched_at', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-400 mb-0.5">En Route</label>
                      <input type="datetime-local" className="input-dark text-[10px]" value={formData.historical_enroute_at} onChange={(e) => update('historical_enroute_at', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-400 mb-0.5">On Scene</label>
                      <input type="datetime-local" className="input-dark text-[10px]" value={formData.historical_onscene_at} onChange={(e) => update('historical_onscene_at', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-400 mb-0.5">Cleared</label>
                      <input type="datetime-local" className="input-dark text-[10px]" value={formData.historical_cleared_at} onChange={(e) => update('historical_cleared_at', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-400 mb-0.5">Closed</label>
                      <input type="datetime-local" className="input-dark text-[10px]" value={formData.historical_closed_at} onChange={(e) => update('historical_closed_at', e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          </>}

          {/* Emergency Warning */}
          {formData.priority === 'P1' && (
            <div className="flex items-center gap-2 p-2 bg-red-900/30 border border-red-700">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-300">
                P1 Emergency - This call will be flagged for immediate dispatch with audible alerts.
              </p>
            </div>
          )}

          {/* 83: Actions bar with sticky bottom positioning */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-rmpg-700 sticky bottom-0 bg-surface-base pb-1" style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0.25rem))' }}>
            {/* 84: Cancel button with explicit aria-label */}
            <button type="button" onClick={onClose} disabled={isSubmitting} className="toolbar-btn" aria-label="Cancel and close">
              Cancel
            </button>
            {/* 85: Submit button with disabled cursor-not-allowed */}
            <button type="submit" disabled={isSubmitting} className="toolbar-btn toolbar-btn-primary disabled:cursor-not-allowed">
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  Saving...
                </>
              ) : (
                formData.is_historical ? 'Save Historical Call' : 'Create Call'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
