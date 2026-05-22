import React, { useState, useEffect } from 'react';
import { FileText, Scale } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDraft } from '../hooks/useFormDraft';
import type { Incident, CallPriority } from '../types';
import { INCIDENT_TYPE_CATEGORIES, type IncidentType } from '../utils/caseNumbers';
import {
  WEATHER_OPTIONS,
  LIGHTING_OPTIONS,
  WEAPONS_OPTIONS,
  LE_AGENCY_OPTIONS,
} from '../utils/callOptions';
import AddressAutocomplete, { type ParsedAddress } from './AddressAutocomplete';
import { formatPhoneInput } from '../utils/formatters';
import StatuteLookup, { type StatuteResult } from './StatuteLookup';
import { useDistrictOptions, useDistrictIdentify } from '../hooks/useDistrictLookup';

interface IncidentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: IncidentFormData) => void;
  isSubmitting: boolean;
  editingIncident?: Incident;
  dispositionCodes?: {code: string; description: string; color?: string}[];
  clients?: { id: string; name: string }[];
  defaultType?: string;
}

export interface IncidentFormData {
  incident_type: IncidentType;
  priority: CallPriority;
  location_address: string;
  narrative: string;
  initial_contact_details: string;
  scene_observations_details: string;
  involved_parties_details: string;
  statements_admissions_details: string;
  actions_taken_details: string;
  evidence_follow_up_details: string;
  notifications_referrals_details: string;
  follow_up_case_status_details: string;
  occurred_date: string;
  occurred_time: string;
  end_date: string;
  end_time: string;
  weather_conditions: string;
  lighting_conditions: string;
  injuries: string;
  injury_description: string;
  damage_estimate: string;
  damage_description: string;
  weapons_involved: string;
  alcohol_involved: boolean;
  drugs_involved: boolean;
  domestic_violence: boolean;
  disposition: string;
  zone_beat: string;
  sector_id: string;
  zone_id: string;
  beat_id: string;
  responding_le_agency: string;
  le_case_number: string;
  // Vehicle/Traffic sub-section
  road_conditions: string;
  traffic_control: string;
  vehicle_1_info: string;
  vehicle_2_info: string;
  diagram_notes: string;
  // Medical sub-section
  patient_status: string;
  ems_transport: string;
  patient_vitals: string;
  treatment_rendered: string;
  // Trespass sub-section
  trespass_warning_issued: boolean;
  trespass_effective_date: string;
  trespass_expiry_date: string;
  property_boundaries: string;
  // Use of Force sub-section
  force_type: string;
  force_justification: string;
  subject_injuries: string;
  officer_injuries: string;
  de_escalation_attempts: string;
  // Statute linkage
  statute_id: number | null;
  statute_citation: string;
  citation_fine: number | null;
  // Coordinates (set by AddressAutocomplete or preserved from edit)
  latitude: number | null;
  longitude: number | null;
  // Client linkage
  client_id: string;
  contract_id: string;
  // PSO / Process Service
  pso_service_type: string;
  pso_attempt_number: string;
  pso_requestor_name: string;
  pso_requestor_phone: string;
  pso_requestor_email: string;
  pso_billing_code: string;
  pso_authorization: string;
  process_service_type: string;
  process_served_to: string;
  process_served_address: string;
  process_service_result: string;
  process_served_at: string;
  process_attempts: string;
  // Operational flags
  injuries_reported: boolean;
  mental_health_crisis: boolean;
  juvenile_involved: boolean;
  felony_in_progress: boolean;
  officer_safety_caution: boolean;
  k9_requested: boolean;
  ems_requested: boolean;
  fire_requested: boolean;
  hazmat: boolean;
  gang_related: boolean;
  evidence_collected: boolean;
  body_camera_active: boolean;
  photos_taken: boolean;
  trespass_issued: boolean;
  vehicle_pursuit: boolean;
  foot_pursuit: boolean;
  le_notified: boolean;
  supervisor_notified: boolean;
}

// Helpers to detect type-specific sub-sections
const TRAFFIC_TYPES: string[] = ['traffic_accident', 'hit_and_run', 'dui_dwi', 'parking_violation', 'traffic_hazard', 'abandoned_vehicle'];
const MEDICAL_TYPES: string[] = ['medical_emergency', 'overdose', 'mental_health_crisis'];
const TRESPASS_TYPES: string[] = ['trespass'];
const USE_OF_FORCE_TYPES: string[] = ['assault', 'battery', 'use_of_force'];
const PSO_TYPES: string[] = ['pso_client_request'];

const GUIDED_NARRATIVE_FIELDS = [
  { key: 'initial_contact_details', label: 'INITIAL CONTACT / COMPLAINT' },
  { key: 'scene_observations_details', label: 'SCENE OBSERVATIONS / CONDITIONS' },
  { key: 'involved_parties_details', label: 'INVOLVED PARTIES / VEHICLES / WITNESSES' },
  { key: 'statements_admissions_details', label: 'STATEMENTS / ADMISSIONS' },
  { key: 'actions_taken_details', label: 'ACTIONS TAKEN' },
  { key: 'evidence_follow_up_details', label: 'EVIDENCE / STATEMENTS / FOLLOW-UP' },
  { key: 'notifications_referrals_details', label: 'NOTIFICATIONS / REFERRALS' },
  { key: 'follow_up_case_status_details', label: 'FOLLOW-UP / CASE STATUS' },
] as const;

type GuidedNarrativeFieldKey = typeof GUIDED_NARRATIVE_FIELDS[number]['key'];

function createEmptyGuidedNarrativeFields(): Record<GuidedNarrativeFieldKey, string> {
  return GUIDED_NARRATIVE_FIELDS.reduce((acc, field) => {
    acc[field.key] = '';
    return acc;
  }, {} as Record<GuidedNarrativeFieldKey, string>);
}

function buildNarrativeForSubmit(data: IncidentFormData): string {
  const baseNarrative = data.narrative.trim();
  const guidedSections = GUIDED_NARRATIVE_FIELDS
    .map(({ key, label }) => {
      const value = data[key].trim();
      return value ? `${label}\n${value}` : '';
    })
    .filter(Boolean);

  return [baseNarrative, ...guidedSections].filter(Boolean).join('\n\n');
}

function escapeGuidedNarrativeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitNarrativeIntoGuidedFields(rawNarrative: string): { narrative: string } & Record<GuidedNarrativeFieldKey, string> {
  const emptyFields = createEmptyGuidedNarrativeFields();
  const narrative = rawNarrative.trim();

  if (!narrative) {
    return { narrative: '', ...emptyFields };
  }

  const headingPattern = new RegExp(
    `(?:^|\\n\\n)(${GUIDED_NARRATIVE_FIELDS.map((field) => escapeGuidedNarrativeRegex(field.label)).join('|')})\\n`,
    'g',
  );
  const matches = Array.from(narrative.matchAll(headingPattern));

  if (matches.length === 0) {
    return { narrative, ...emptyFields };
  }

  const extracted = createEmptyGuidedNarrativeFields();
  const baseNarrative = narrative.slice(0, matches[0].index ?? 0).trim();

  matches.forEach((match, index) => {
    const label = match[1];
    const field = GUIDED_NARRATIVE_FIELDS.find((entry) => entry.label === label);
    if (!field) return;

    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? narrative.length) : narrative.length;
    extracted[field.key] = narrative.slice(start, end).trim();
  });

  return {
    narrative: baseNarrative,
    ...extracted,
  };
}

const PRIORITY_OPTIONS: { value: CallPriority; label: string; color: string; desc: string }[] = [
  { value: 'P1', label: 'P1', color: 'border-red-500 text-red-400 bg-red-900/30', desc: 'Emergency' },
  { value: 'P2', label: 'P2', color: 'border-amber-500 text-amber-400 bg-amber-900/30', desc: 'Urgent' },
  { value: 'P3', label: 'P3', color: 'border-brand-500 text-brand-400 bg-brand-900/30', desc: 'Routine' },
  { value: 'P4', label: 'P4', color: 'border-rmpg-500 text-rmpg-300 bg-rmpg-700/30', desc: 'Scheduled' },
];

// WEATHER_OPTIONS, LIGHTING_OPTIONS, WEAPONS_OPTIONS, LE_AGENCY_OPTIONS
// now imported from ../utils/callOptions.ts
// Section/Zone/Beat options now loaded dynamically from 3Tier dispatch districts

// Dynamic section tabs based on incident type
function getSectionTabs(incidentType: string) {
  const tabs: { id: string; label: string }[] = [
    { id: 'basic', label: 'Basic Info' },
    { id: 'scene', label: 'Scene Details' },
  ];
  if (TRAFFIC_TYPES.includes(incidentType)) {
    tabs.push({ id: 'vehicle_traffic', label: 'Vehicle/Traffic' });
  }
  if (MEDICAL_TYPES.includes(incidentType)) {
    tabs.push({ id: 'medical', label: 'Medical' });
  }
  if (TRESPASS_TYPES.includes(incidentType)) {
    tabs.push({ id: 'trespass', label: 'Trespass' });
  }
  if (USE_OF_FORCE_TYPES.includes(incidentType)) {
    tabs.push({ id: 'use_of_force', label: 'Force Details' });
  }
  if (PSO_TYPES.includes(incidentType)) {
    tabs.push({ id: 'pso', label: 'PSO / Service' });
  }
  tabs.push({ id: 'flags', label: 'Flags & LE' });
  tabs.push({ id: 'narrative', label: 'Narrative' });
  return tabs;
}

type SectionId = string;

const EMPTY_FORM: IncidentFormData = {
  incident_type: '' as IncidentType,
  priority: 'P3',
  location_address: '',
  narrative: '',
  initial_contact_details: '',
  scene_observations_details: '',
  involved_parties_details: '',
  statements_admissions_details: '',
  actions_taken_details: '',
  evidence_follow_up_details: '',
  notifications_referrals_details: '',
  follow_up_case_status_details: '',
  occurred_date: '',
  occurred_time: '',
  end_date: '',
  end_time: '',
  weather_conditions: '',
  lighting_conditions: '',
  injuries: 'none',
  injury_description: '',
  damage_estimate: '',
  damage_description: '',
  weapons_involved: '',
  alcohol_involved: false,
  drugs_involved: false,
  domestic_violence: false,
  disposition: '',
  zone_beat: '',
  sector_id: '',
  zone_id: '',
  beat_id: '',
  responding_le_agency: '',
  le_case_number: '',
  // Vehicle/Traffic
  road_conditions: '',
  traffic_control: '',
  vehicle_1_info: '',
  vehicle_2_info: '',
  diagram_notes: '',
  // Medical
  patient_status: '',
  ems_transport: '',
  patient_vitals: '',
  treatment_rendered: '',
  // Trespass
  trespass_warning_issued: false,
  trespass_effective_date: '',
  trespass_expiry_date: '',
  property_boundaries: '',
  // Use of Force
  force_type: '',
  force_justification: '',
  subject_injuries: '',
  officer_injuries: '',
  de_escalation_attempts: '',
  statute_id: null,
  statute_citation: '',
  citation_fine: null,
  latitude: null,
  longitude: null,
  client_id: '',
  contract_id: '',
  // PSO / Process Service
  pso_service_type: '',
  pso_attempt_number: '',
  pso_requestor_name: '',
  pso_requestor_phone: '',
  pso_requestor_email: '',
  pso_billing_code: '',
  pso_authorization: '',
  process_service_type: '',
  process_served_to: '',
  process_served_address: '',
  process_service_result: '',
  process_served_at: '',
  process_attempts: '',
  // Operational flags
  injuries_reported: false,
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
  le_notified: false,
  supervisor_notified: false,
};

export default function IncidentFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingIncident,
  dispositionCodes = [],
  clients = [],
  defaultType = '',
}: IncidentFormModalProps) {
  const {
    form: formData,
    setForm: setFormData,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<IncidentFormData>({
    storageKey: 'rmpg_incident_form',
    defaultValue: EMPTY_FORM,
    isActive: isOpen,
  });
  const [activeSection, setActiveSection] = useState<SectionId>('basic');
  const { sections: sectionOptions, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();
  const { identify: identifyDistrict } = useDistrictIdentify();
  const compiledNarrative = buildNarrativeForSubmit(formData);

  useEffect(() => {
    if (isOpen) {
      if (editingIncident) {
        const inc = editingIncident as any;
        const parsedNarrative = splitNarrativeIntoGuidedFields(editingIncident.narrative || '');
        const initial: IncidentFormData = {
          incident_type: editingIncident.type,
          priority: editingIncident.priority,
          location_address: editingIncident.location,
          narrative: parsedNarrative.narrative,
          initial_contact_details: parsedNarrative.initial_contact_details,
          scene_observations_details: parsedNarrative.scene_observations_details,
          involved_parties_details: parsedNarrative.involved_parties_details,
          statements_admissions_details: parsedNarrative.statements_admissions_details,
          actions_taken_details: parsedNarrative.actions_taken_details,
          evidence_follow_up_details: parsedNarrative.evidence_follow_up_details,
          notifications_referrals_details: parsedNarrative.notifications_referrals_details,
          follow_up_case_status_details: parsedNarrative.follow_up_case_status_details,
          occurred_date: inc.occurred_date || '',
          occurred_time: inc.occurred_time || '',
          end_date: inc.end_date || '',
          end_time: inc.end_time || '',
          weather_conditions: inc.weather_conditions || '',
          lighting_conditions: inc.lighting_conditions || '',
          injuries: inc.injuries || 'none',
          injury_description: inc.injury_description || '',
          damage_estimate: inc.damage_estimate || '',
          damage_description: inc.damage_description || '',
          weapons_involved: inc.weapons_involved || '',
          alcohol_involved: !!inc.alcohol_involved,
          drugs_involved: !!inc.drugs_involved,
          domestic_violence: !!inc.domestic_violence,
          disposition: inc.disposition || '',
          zone_beat: inc.zone_beat || '',
          sector_id: inc.sector_id || '',
          zone_id: inc.zone_id || '',
          beat_id: inc.beat_id || '',
          responding_le_agency: inc.responding_le_agency || '',
          le_case_number: inc.le_case_number || '',
          // Vehicle/Traffic
          road_conditions: inc.road_conditions || '',
          traffic_control: inc.traffic_control || '',
          vehicle_1_info: inc.vehicle_1_info || '',
          vehicle_2_info: inc.vehicle_2_info || '',
          diagram_notes: inc.diagram_notes || '',
          // Medical
          patient_status: inc.patient_status || '',
          ems_transport: inc.ems_transport || '',
          patient_vitals: inc.patient_vitals || '',
          treatment_rendered: inc.treatment_rendered || '',
          // Trespass
          trespass_warning_issued: !!inc.trespass_warning_issued,
          trespass_effective_date: inc.trespass_effective_date || '',
          trespass_expiry_date: inc.trespass_expiry_date || '',
          property_boundaries: inc.property_boundaries || '',
          // Use of Force
          force_type: inc.force_type || '',
          force_justification: inc.force_justification || '',
          subject_injuries: inc.subject_injuries || '',
          officer_injuries: inc.officer_injuries || '',
          de_escalation_attempts: inc.de_escalation_attempts || '',
          // Statute
          statute_id: (inc as any).statute_id ?? null,
          statute_citation: (inc as any).statute_citation || '',
          citation_fine: (inc as any).citation_fine ?? null,
          // Coordinates (preserve from existing incident)
          latitude: inc.latitude ?? null,
          longitude: inc.longitude ?? null,
          // Client
          client_id: inc.client_id ? String(inc.client_id) : '',
          contract_id: inc.contract_id || '',
          // PSO / Process Service
          pso_service_type: inc.pso_service_type || '',
          pso_attempt_number: inc.pso_attempt_number != null ? String(inc.pso_attempt_number) : '',
          pso_requestor_name: inc.pso_requestor_name || '',
          pso_requestor_phone: inc.pso_requestor_phone || '',
          pso_requestor_email: inc.pso_requestor_email || '',
          pso_billing_code: inc.pso_billing_code || '',
          pso_authorization: inc.pso_authorization || '',
          process_service_type: inc.process_service_type || '',
          process_served_to: inc.process_served_to || '',
          process_served_address: inc.process_served_address || '',
          process_service_result: inc.process_service_result || '',
          process_served_at: inc.process_served_at || '',
          process_attempts: inc.process_attempts != null ? String(inc.process_attempts) : '',
          // Operational flags
          injuries_reported: !!inc.injuries_reported,
          mental_health_crisis: !!inc.mental_health_crisis,
          juvenile_involved: !!inc.juvenile_involved,
          felony_in_progress: !!inc.felony_in_progress,
          officer_safety_caution: !!inc.officer_safety_caution,
          k9_requested: !!inc.k9_requested,
          ems_requested: !!inc.ems_requested,
          fire_requested: !!inc.fire_requested,
          hazmat: !!inc.hazmat,
          gang_related: !!inc.gang_related,
          evidence_collected: !!inc.evidence_collected,
          body_camera_active: !!inc.body_camera_active,
          photos_taken: !!inc.photos_taken,
          trespass_issued: !!inc.trespass_issued,
          vehicle_pursuit: !!inc.vehicle_pursuit,
          foot_pursuit: !!inc.foot_pursuit,
          le_notified: !!inc.le_notified,
          supervisor_notified: !!inc.supervisor_notified,
        };
        setFormData(initial);
        snapshot();
      } else {
        const initial: IncidentFormData = {
          ...EMPTY_FORM,
          ...(defaultType ? { incident_type: defaultType as IncidentType, priority: 'P1' as CallPriority } : {}),
        };
        setFormData(initial);
        snapshot();
      }
      setActiveSection(defaultType && USE_OF_FORCE_TYPES.includes(defaultType) ? 'use_of_force' : 'basic');
    }
  }, [isOpen, editingIncident, defaultType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.incident_type) return;
    onSubmit({
      ...formData,
      narrative: buildNarrativeForSubmit(formData),
    });
  };

  const update = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={editingIncident ? 'Edit Incident Report' : 'New Incident Report'}
      icon={FileText}
      submitLabel={editingIncident ? 'Update Incident' : 'Create Incident'}
      isSubmitting={isSubmitting}
      maxWidth="max-w-4xl"
      isDirty={isDirty}
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
    >
      {/* Section Tabs (dynamic based on incident type) */}
      <div className="flex gap-1 -mt-1 mb-2 flex-wrap">
        {getSectionTabs(formData.incident_type).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveSection(tab.id)}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              activeSection === tab.id
                ? 'bg-red-900/40 text-red-400 border border-red-700/50'
                : 'text-rmpg-400 hover:text-rmpg-200 border border-transparent hover:border-rmpg-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Basic Info Section ── */}
      {activeSection === 'basic' && (
        <>
          {/* Incident Type + Priority */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Incident Type</label>
              <select
                className="select-dark mt-1"
                value={formData.incident_type}
                onChange={(e) => {
                  update('incident_type', e.target.value);
                  // Reset to basic tab if current sub-section no longer applies
                  const newTabs = getSectionTabs(e.target.value);
                  if (!newTabs.find((t) => t.id === activeSection)) {
                    setActiveSection('basic');
                  }
                }}
                required
              >
                <option value="" disabled>-- Select Type --</option>
                {Object.entries(INCIDENT_TYPE_CATEGORIES).map(([category, types]) => (
                  <optgroup key={category} label={category}>
                    {types.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {/* Feature 30: Incident Type Auto-suggest based on narrative keywords */}
              {formData.narrative && !formData.incident_type && (() => {
                const text = formData.narrative.toLowerCase();
                const suggestions: { type: string; label: string }[] = [];
                if (text.includes('theft') || text.includes('stole') || text.includes('shoplifting')) suggestions.push({ type: 'theft', label: 'Theft' });
                if (text.includes('assault') || text.includes('hit') || text.includes('punch') || text.includes('fight')) suggestions.push({ type: 'assault', label: 'Assault' });
                if (text.includes('burglary') || text.includes('break in') || text.includes('broken window')) suggestions.push({ type: 'burglary', label: 'Burglary' });
                if (text.includes('trespass') || text.includes('trespassing')) suggestions.push({ type: 'trespass', label: 'Trespass' });
                if (text.includes('vandal') || text.includes('graffiti') || text.includes('damage')) suggestions.push({ type: 'vandalism', label: 'Vandalism' });
                if (text.includes('drug') || text.includes('narcotic') || text.includes('substance')) suggestions.push({ type: 'drugs', label: 'Drug Offense' });
                if (text.includes('domestic') || text.includes('dv')) suggestions.push({ type: 'domestic_violence', label: 'Domestic Violence' });
                if (text.includes('accident') || text.includes('collision') || text.includes('crash')) suggestions.push({ type: 'traffic_accident', label: 'Traffic Accident' });
                if (text.includes('suspicious') || text.includes('prowler')) suggestions.push({ type: 'suspicious_activity', label: 'Suspicious Activity' });
                if (text.includes('alarm')) suggestions.push({ type: 'alarm', label: 'Alarm' });
                if (suggestions.length === 0) return null;
                return (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="text-[8px] text-rmpg-500">Suggested:</span>
                    {suggestions.slice(0, 3).map(s => (
                      <button
                        key={s.type}
                        type="button"
                        className="px-1.5 py-0.5 text-[8px] bg-brand-900/30 text-brand-300 border border-brand-600/30 hover:bg-brand-800/40 transition-colors"
                        onClick={() => update('incident_type', s.type)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Section ID</label>
              <select className="select-dark mt-1" value={formData.sector_id} onChange={(e) => { update('sector_id', e.target.value); update('zone_id', ''); update('beat_id', ''); }}>
                <option value="">-- Select --</option>
                {sectionOptions.map((s) => <option key={s} value={s}>{s} — {sectionLabels.get(s) || s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Zone ID</label>
              <select className="select-dark mt-1" value={formData.zone_id} onChange={(e) => { update('zone_id', e.target.value); update('beat_id', ''); }}>
                <option value="">-- Select --</option>
                {zonesForSection(formData.sector_id).map((z) => <option key={z} value={z}>{z} — {zoneLabels.get(z) || z}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Beat ID</label>
              <select className="select-dark mt-1" value={formData.beat_id} onChange={(e) => update('beat_id', e.target.value)}>
                <option value="">-- Select --</option>
                {beatsForZone(formData.zone_id).map((b) => <option key={b} value={b}>{b} — {getBeatLabel(formData.zone_id, b)}</option>)}
              </select>
            </div>
          </div>

          {/* Priority Buttons */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold mb-2 block">Priority</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update('priority', p.value)}
                  className={`p-2 border-2 text-center transition-all ${
                    formData.priority === p.value
                      ? p.color
                      : 'border-rmpg-600 text-rmpg-400 hover:border-rmpg-400'
                  }`}
                >
                  <div className="font-bold text-sm">{p.label}</div>
                  <div className="text-[10px]">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Location / Address</label>
            <AddressAutocomplete
              className="input-dark mt-1"
              placeholder="123 Main St, Salt Lake City, UT"
              value={formData.location_address}
              onChange={(val) => update('location_address', val)}
              onSelect={async (addr: ParsedAddress) => {
                update('location_address', addr.formatted);
                if (addr.latitude != null) {
                  setFormData((prev) => ({ ...prev, latitude: addr.latitude, longitude: addr.longitude }));
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
          </div>

          {/* Client & Contract */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {clients.length > 0 && (
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Client</label>
                <select
                  className="select-dark mt-1"
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
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Contract ID</label>
              <input type="text" className="input-dark mt-1" placeholder="e.g. 15330838" value={formData.contract_id} onChange={(e) => update('contract_id', e.target.value)} />
            </div>
          </div>

          {/* Occurred Date/Time */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Occurred Date</label>
              <input type="date" className="input-dark mt-1" value={formData.occurred_date} onChange={(e) => update('occurred_date', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Occurred Time</label>
              <input type="time" className="input-dark mt-1" value={formData.occurred_time} onChange={(e) => update('occurred_time', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">End Date</label>
              <input type="date" className="input-dark mt-1" value={formData.end_date} onChange={(e) => update('end_date', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">End Time</label>
              <input type="time" className="input-dark mt-1" value={formData.end_time} onChange={(e) => update('end_time', e.target.value)} />
            </div>
          </div>

          {/* Disposition */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Disposition</label>
            <select
              className="select-dark mt-1"
              value={formData.disposition}
              onChange={(e) => update('disposition', e.target.value)}
            >
              <option value="">— Select Disposition —</option>
              {dispositionCodes.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} — {d.description}
                </option>
              ))}
            </select>
          </div>

          {/* Utah Statute / Charge Linkage */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold flex items-center gap-1">
              <Scale className="w-3 h-3" /> Utah Statute / Charge
            </label>
            <div className="mt-1">
              <StatuteLookup
                onSelect={(statute: StatuteResult) => {
                  setFormData((prev) => ({
                    ...prev,
                    statute_id: statute.id,
                    statute_citation: statute.citation,
                    citation_fine: statute.citation_fine ?? null,
                  }));
                }}
                value={formData.statute_citation || undefined}
                onClear={() => {
                  setFormData((prev) => ({
                    ...prev,
                    statute_id: null,
                    statute_citation: '',
                    citation_fine: null,
                  }));
                }}
                placeholder="Search Utah statutes (e.g. 76-5-102 Assault, 41-6a-502 DUI)"
              />
            </div>
            {formData.citation_fine != null && formData.citation_fine > 0 && (
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-[9px] text-rmpg-400 uppercase font-semibold">Base Fine:</span>
                <span className="text-xs font-mono font-bold text-green-400">${formData.citation_fine}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Scene Details Section ── */}
      {activeSection === 'scene' && (
        <>
          {/* Weather / Lighting */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Weather Conditions</label>
              <select className="select-dark mt-1" value={formData.weather_conditions} onChange={(e) => update('weather_conditions', e.target.value)}>
                {WEATHER_OPTIONS.map((w) => (
                  <option key={w} value={w}>{w || '-- Select --'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Lighting Conditions</label>
              <select className="select-dark mt-1" value={formData.lighting_conditions} onChange={(e) => update('lighting_conditions', e.target.value)}>
                {LIGHTING_OPTIONS.map((l) => (
                  <option key={l} value={l}>{l || '-- Select --'}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Injuries */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Injuries</label>
              <select className="select-dark mt-1" value={formData.injuries} onChange={(e) => update('injuries', e.target.value)}>
                <option value="none">None</option>
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="fatal">Fatal</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Injury Description</label>
              <input
                type="text"
                className="input-dark mt-1"
                placeholder="Describe injuries if applicable..."
                value={formData.injury_description}
                onChange={(e) => update('injury_description', e.target.value)}
              />
            </div>
          </div>

          {/* Damage — Feature 25: Property Damage Calculator */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Damage Estimate ($)</label>
              <input
                type="text"
                className="input-dark mt-1"
                placeholder="e.g. 500.00 — separate items with + (100+250+150)"
                value={formData.damage_estimate}
                onChange={(e) => update('damage_estimate', e.target.value)}
              />
              {/* Feature 25: Auto-sum if user enters multiple values with + */}
              {formData.damage_estimate && formData.damage_estimate.includes('+') && (() => {
                const parts = formData.damage_estimate.split('+').map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
                const total = parts.reduce((sum, n) => sum + n, 0);
                return parts.length > 1 ? (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[9px] text-rmpg-400">Total: ${total.toFixed(2)}</span>
                    <button
                      type="button"
                      className="text-[8px] text-brand-400 hover:text-brand-300 underline"
                      onClick={() => update('damage_estimate', total.toFixed(2))}
                    >
                      Apply total
                    </button>
                  </div>
                ) : null;
              })()}
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Damage Description</label>
              <input
                type="text"
                className="input-dark mt-1"
                placeholder="Broken window, graffiti, etc."
                value={formData.damage_description}
                onChange={(e) => update('damage_description', e.target.value)}
              />
            </div>
          </div>

          {/* Weapons */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Weapons Involved</label>
            <select
              className="input-dark mt-1"
              value={formData.weapons_involved}
              onChange={(e) => update('weapons_involved', e.target.value)}
            >
              <option value="">-- Select --</option>
              {WEAPONS_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
        </>
      )}

      {/* ── Vehicle/Traffic Sub-Section ── */}
      {activeSection === 'vehicle_traffic' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Road Conditions</label>
              <select className="select-dark mt-1" value={formData.road_conditions} onChange={(e) => update('road_conditions', e.target.value)}>
                <option value="">-- Select --</option>
                <option value="dry">Dry</option>
                <option value="wet">Wet</option>
                <option value="icy">Icy</option>
                <option value="snow_covered">Snow Covered</option>
                <option value="muddy">Muddy</option>
                <option value="gravel">Gravel</option>
                <option value="construction">Construction Zone</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Traffic Control</label>
              <select className="select-dark mt-1" value={formData.traffic_control} onChange={(e) => update('traffic_control', e.target.value)}>
                <option value="">-- Select --</option>
                <option value="none">None</option>
                <option value="traffic_signal">Traffic Signal</option>
                <option value="stop_sign">Stop Sign</option>
                <option value="yield_sign">Yield Sign</option>
                <option value="flashing_light">Flashing Light</option>
                <option value="officer_directed">Officer Directed</option>
                <option value="school_zone">School Zone</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Vehicle 1 Info</label>
              <textarea className="textarea-dark mt-1" rows={3} placeholder="Year, make, model, color, plate, driver info..." value={formData.vehicle_1_info} onChange={(e) => update('vehicle_1_info', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Vehicle 2 Info</label>
              <textarea className="textarea-dark mt-1" rows={3} placeholder="Year, make, model, color, plate, driver info..." value={formData.vehicle_2_info} onChange={(e) => update('vehicle_2_info', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Diagram / Scene Notes</label>
            <textarea className="textarea-dark mt-1" rows={3} placeholder="Direction of travel, point of impact, lane positions, skid marks..." value={formData.diagram_notes} onChange={(e) => update('diagram_notes', e.target.value)} />
          </div>
        </>
      )}

      {/* ── Medical Sub-Section ── */}
      {activeSection === 'medical' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Patient Status</label>
              <select className="select-dark mt-1" value={formData.patient_status} onChange={(e) => update('patient_status', e.target.value)}>
                <option value="">-- Select --</option>
                <option value="conscious_alert">Conscious & Alert</option>
                <option value="conscious_disoriented">Conscious, Disoriented</option>
                <option value="semi_conscious">Semi-Conscious</option>
                <option value="unconscious">Unconscious</option>
                <option value="deceased">Deceased</option>
                <option value="refused_treatment">Refused Treatment</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">EMS Transport</label>
              <select className="select-dark mt-1" value={formData.ems_transport} onChange={(e) => update('ems_transport', e.target.value)}>
                <option value="">-- Select --</option>
                <option value="not_needed">Not Needed</option>
                <option value="transport_hospital">Transported to Hospital</option>
                <option value="transport_clinic">Transported to Clinic</option>
                <option value="refused_transport">Refused Transport</option>
                <option value="air_lift">Air Lift / Helicopter</option>
                <option value="doa">DOA</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Patient Vitals / Condition</label>
            <textarea className="textarea-dark mt-1" rows={3} placeholder="BP, pulse, respiration, temperature, condition observations..." value={formData.patient_vitals} onChange={(e) => update('patient_vitals', e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Treatment Rendered</label>
            <textarea className="textarea-dark mt-1" rows={3} placeholder="First aid, CPR, AED, bandaging, Narcan administered..." value={formData.treatment_rendered} onChange={(e) => update('treatment_rendered', e.target.value)} />
          </div>
        </>
      )}

      {/* ── Trespass Sub-Section ── */}
      {activeSection === 'trespass' && (
        <>
          <div className="flex items-center gap-3 p-3 bg-rmpg-800/50 border border-rmpg-600">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.trespass_warning_issued}
                onChange={(e) => update('trespass_warning_issued', e.target.checked)}
                className="w-4 h-4 accent-red-500"
              />
              <span className="text-sm text-rmpg-200 font-semibold">Trespass Warning Issued</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Effective Date</label>
              <input type="date" className="input-dark mt-1" value={formData.trespass_effective_date} onChange={(e) => update('trespass_effective_date', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Expiry Date</label>
              <input type="date" className="input-dark mt-1" value={formData.trespass_expiry_date} onChange={(e) => update('trespass_expiry_date', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Property Boundaries / Description</label>
            <textarea className="textarea-dark mt-1" rows={3} placeholder="Describe property boundaries, restricted areas, and access points..." value={formData.property_boundaries} onChange={(e) => update('property_boundaries', e.target.value)} />
          </div>
        </>
      )}

      {/* ── Use of Force Sub-Section ── */}
      {activeSection === 'use_of_force' && (
        <>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Force Type / Level</label>
            <select className="select-dark mt-1" value={formData.force_type} onChange={(e) => update('force_type', e.target.value)}>
              <option value="">-- Select --</option>
              <option value="verbal_commands">Verbal Commands</option>
              <option value="soft_hands">Soft Hands / Escort</option>
              <option value="hard_hands">Hard Hands / Takedown</option>
              <option value="oc_spray">OC Spray</option>
              <option value="taser">Taser / ECD</option>
              <option value="baton">Baton / Impact Weapon</option>
              <option value="k9">K-9 Deployment</option>
              <option value="firearm_drawn">Firearm Drawn (not discharged)</option>
              <option value="firearm_discharged">Firearm Discharged</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">De-Escalation Attempts</label>
            <textarea className="textarea-dark mt-1" rows={3} placeholder="Describe verbal de-escalation, time/distance, crisis intervention techniques used..." value={formData.de_escalation_attempts} onChange={(e) => update('de_escalation_attempts', e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Justification</label>
            <textarea className="textarea-dark mt-1" rows={3} placeholder="Describe the threat/resistance that justified the use of force..." value={formData.force_justification} onChange={(e) => update('force_justification', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Subject Injuries</label>
              <input type="text" className="input-dark mt-1" placeholder="Describe injuries to subject..." value={formData.subject_injuries} onChange={(e) => update('subject_injuries', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Officer Injuries</label>
              <input type="text" className="input-dark mt-1" placeholder="Describe injuries to officer..." value={formData.officer_injuries} onChange={(e) => update('officer_injuries', e.target.value)} />
            </div>
          </div>
        </>
      )}

      {/* ── PSO / Process Service Section ── */}
      {activeSection === 'pso' && (
        <>
          {/* Service Type + Contract / Billing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">PSO Service Type</label>
              <select className="select-dark mt-1" value={formData.pso_service_type} onChange={(e) => update('pso_service_type', e.target.value)}>
                <option value="">-- Select --</option>
                <option value="patrol">Patrol</option>
                <option value="standing_post">Standing Post</option>
                <option value="escort">Escort</option>
                <option value="process_service">Process Service</option>
                <option value="alarm_response">Alarm Response</option>
                <option value="event_security">Event Security</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Process Service Type</label>
              <select className="select-dark mt-1" value={formData.process_service_type} onChange={(e) => update('process_service_type', e.target.value)}>
                <option value="">-- Select --</option>
                <option value="subpoena">Subpoena</option>
                <option value="summons">Summons</option>
                <option value="complaint">Complaint</option>
                <option value="eviction">Eviction</option>
                <option value="restraining_order">Restraining Order</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Billing / Authorization */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Billing Code / Contract ID</label>
              <input type="text" className="input-dark mt-1" placeholder="Contract or billing code" value={formData.pso_billing_code} onChange={(e) => update('pso_billing_code', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Authorization / PO Number</label>
              <input type="text" className="input-dark mt-1" placeholder="Auth or PO number" value={formData.pso_authorization} onChange={(e) => update('pso_authorization', e.target.value)} />
            </div>
          </div>

          {/* Requestor Info */}
          <div className="border border-rmpg-600 p-3 space-y-3">
            <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Client / Requestor Info</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Requestor Name</label>
                <input type="text" className="input-dark mt-1" placeholder="Contact name" value={formData.pso_requestor_name} onChange={(e) => update('pso_requestor_name', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Phone</label>
                <input type="tel" className="input-dark mt-1" placeholder="(801) 555-0000" value={formData.pso_requestor_phone} onChange={(e) => update('pso_requestor_phone', formatPhoneInput(e.target.value))} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Email</label>
                <input type="email" className="input-dark mt-1" placeholder="contact@example.com" value={formData.pso_requestor_email} onChange={(e) => update('pso_requestor_email', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Service Details */}
          <div className="border border-rmpg-600 p-3 space-y-3">
            <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Service Details</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Served To</label>
                <input type="text" className="input-dark mt-1" placeholder="Name of person served" value={formData.process_served_to} onChange={(e) => update('process_served_to', e.target.value)} />
              </div>
               <div>
                 <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Served Address</label>
                 <AddressAutocomplete
                   className="input-dark mt-1 w-full"
                   placeholder="Address where served"
                   value={formData.process_served_address}
                   onChange={(value) => update('process_served_address', value)}
                   name="process_served_address"
                 />
               </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Served At</label>
                <input type="datetime-local" className="input-dark mt-1" value={formData.process_served_at} onChange={(e) => update('process_served_at', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Attempt #</label>
                <input type="number" min="1" className="input-dark mt-1" placeholder="1" value={formData.process_attempts} onChange={(e) => update('process_attempts', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">PSO Attempt #</label>
                <input type="number" min="1" className="input-dark mt-1" placeholder="1" value={formData.pso_attempt_number} onChange={(e) => update('pso_attempt_number', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Service Result</label>
                <select className="select-dark mt-1" value={formData.process_service_result} onChange={(e) => update('process_service_result', e.target.value)}>
                  <option value="">-- Select --</option>
                  <option value="served">Served</option>
                  <option value="not_served">Not Served</option>
                  <option value="refused">Refused</option>
                  <option value="left_at_door">Left at Door</option>
                  <option value="substitute_service">Substitute Service</option>
                  <option value="unable_to_locate">Unable to Locate</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Flags & LE Section ── */}
      {activeSection === 'flags' && (
        <>
          {/* Critical Flags */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold mb-2 block">Critical Flags</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {([
                ['alcohol_involved', 'Alcohol Involved'],
                ['drugs_involved', 'Drugs Involved'],
                ['domestic_violence', 'Domestic Violence'],
                ['felony_in_progress', 'Felony in Progress'],
                ['officer_safety_caution', 'Officer Safety'],
                ['mental_health_crisis', 'Mental Health Crisis'],
                ['injuries_reported', 'Injuries Reported'],
                ['juvenile_involved', 'Juvenile Involved'],
                ['gang_related', 'Gang Related'],
                ['hazmat', 'HAZMAT'],
              ] as [keyof IncidentFormData, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 p-2 bg-rmpg-800/50 border border-rmpg-600 cursor-pointer hover:border-rmpg-400 transition-colors">
                  <input type="checkbox" checked={!!formData[key]} onChange={(e) => update(key, e.target.checked)} className="w-4 h-4 accent-red-500" />
                  <span className="text-xs text-rmpg-200">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Operational Flags */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold mb-2 block">Operations &amp; Resources</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {([
                ['body_camera_active', 'Body Camera Active'],
                ['evidence_collected', 'Evidence Collected'],
                ['photos_taken', 'Photos Taken'],
                ['trespass_issued', 'Trespass Issued'],
                ['k9_requested', 'K9 Requested'],
                ['ems_requested', 'EMS Requested'],
                ['fire_requested', 'Fire Requested'],
                ['vehicle_pursuit', 'Vehicle Pursuit'],
                ['foot_pursuit', 'Foot Pursuit'],
                ['le_notified', 'LE Notified'],
                ['supervisor_notified', 'Supervisor Notified'],
              ] as [keyof IncidentFormData, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 p-2 bg-rmpg-800/50 border border-rmpg-600 cursor-pointer hover:border-rmpg-400 transition-colors">
                  <input type="checkbox" checked={!!formData[key]} onChange={(e) => update(key, e.target.checked)} className="w-4 h-4 accent-amber-500" />
                  <span className="text-xs text-rmpg-200">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Responding Agency */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Responding Agency</label>
              <select
                className="input-dark mt-1"
                value={formData.responding_le_agency}
                onChange={(e) => update('responding_le_agency', e.target.value)}
              >
                <option value="">-- Select --</option>
                {LE_AGENCY_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">LE Case Number</label>
              <input
                type="text"
                className="input-dark mt-1"
                placeholder="e.g. 2025-SLC-001234"
                value={formData.le_case_number}
                onChange={(e) => update('le_case_number', e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Narrative Section ── */}
      {activeSection === 'narrative' && (
        <div>
          <div className="mb-4 border border-rmpg-600 bg-rmpg-800/40 p-3 space-y-3">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Initial Contact / Complaint</label>
                <textarea
                  className="textarea-dark mt-1"
                  rows={3}
                  placeholder="What brought you to the scene, who reported it, and what was first observed on arrival?"
                  value={formData.initial_contact_details}
                  onChange={(e) => update('initial_contact_details', e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Scene Observations / Conditions</label>
                <textarea
                  className="textarea-dark mt-1"
                  rows={3}
                  placeholder="Describe scene layout, weather, lighting, hazards, damage, and anything notable on approach."
                  value={formData.scene_observations_details}
                  onChange={(e) => update('scene_observations_details', e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Involved Parties / Vehicles / Witnesses</label>
                <textarea
                  className="textarea-dark mt-1"
                  rows={3}
                  placeholder="Document subjects, victims, witnesses, vehicles, identifiers, and relevant observations."
                  value={formData.involved_parties_details}
                  onChange={(e) => update('involved_parties_details', e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Statements / Admissions</label>
                <textarea
                  className="textarea-dark mt-1"
                  rows={3}
                  placeholder="Summarize witness statements, spontaneous utterances, admissions, denials, and quote-worthy remarks."
                  value={formData.statements_admissions_details}
                  onChange={(e) => update('statements_admissions_details', e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Actions Taken</label>
                <textarea
                  className="textarea-dark mt-1"
                  rows={3}
                  placeholder="Describe officer actions, scene handling, interviews, searches, notifications, and resources used."
                  value={formData.actions_taken_details}
                  onChange={(e) => update('actions_taken_details', e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Evidence / Statements / Follow-Up</label>
                <textarea
                  className="textarea-dark mt-1"
                  rows={3}
                  placeholder="Capture evidence collected, property handled, forms served, statements obtained, and next investigative steps."
                  value={formData.evidence_follow_up_details}
                  onChange={(e) => update('evidence_follow_up_details', e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Notifications / Referrals</label>
                <textarea
                  className="textarea-dark mt-1"
                  rows={3}
                  placeholder="Document supervisor, LE, EMS, fire, client, CPS, crisis, or other agency notifications and referrals."
                  value={formData.notifications_referrals_details}
                  onChange={(e) => update('notifications_referrals_details', e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Follow-Up / Case Status</label>
                <textarea
                  className="textarea-dark mt-1"
                  rows={3}
                  placeholder="Record disposition, service result, pending tasks, evidence destination, and who owns the next follow-up."
                  value={formData.follow_up_case_status_details}
                  onChange={(e) => update('follow_up_case_status_details', e.target.value)}
                />
              </div>
            </div>
            <p className="text-[10px] text-rmpg-500">
              Guided detail entries are appended to the saved narrative automatically and loaded back into these fields when you reopen the report.
            </p>
          </div>

          <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Narrative</label>
          {/* Feature 24: Narrative quality indicators */}
          {(() => {
            const wordCount = compiledNarrative.split(/\s+/).filter(Boolean).length;
            const issues: string[] = [];
            if (wordCount > 0 && wordCount < 20) issues.push('Very short narrative — add more detail');
            if (compiledNarrative === compiledNarrative.toUpperCase() && compiledNarrative.length > 20) issues.push('ALL CAPS detected — use normal case');
            if (compiledNarrative.length > 0 && !compiledNarrative.includes('.')) issues.push('No periods — check for proper sentences');
            return issues.length > 0 ? (
              <div className="mt-1 mb-1 px-2 py-1 bg-amber-950/30 border border-amber-700/30 text-[9px] text-amber-400 flex items-center gap-1.5">
                <span style={{ fontSize: 12 }}>!</span>
                {issues.join(' | ')}
              </div>
            ) : null;
          })()}
          <textarea
            className="textarea-dark mt-1"
            rows={14}
            placeholder="Describe the incident in detail. Include who, what, when, where, why, and how..."
            value={formData.narrative}
            onChange={(e) => update('narrative', e.target.value)}
            spellCheck={true}
          />
          <p className="text-[10px] text-rmpg-500 mt-1">
            {/* Feature 39: Word count display */}
            {compiledNarrative.length} characters | {compiledNarrative.split(/\s+/).filter(Boolean).length} words after guided details
            {compiledNarrative.split(/\s+/).filter(Boolean).length >= 100 && (
              <span className="text-green-400 ml-2">Sufficient detail</span>
            )}
          </p>
          {/* Feature 26: Witness Statement Template */}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="toolbar-btn text-[9px]"
              onClick={() => {
                const template = `WITNESS STATEMENT\n\nI, [Witness Name], state the following:\n\nOn ${formData.occurred_date || '[Date]'} at approximately ${formData.occurred_time || '[Time]'}, at ${formData.location_address || '[Location]'}, I observed the following:\n\n[Describe what you saw, heard, or experienced in your own words]\n\nI declare under penalty of perjury that the foregoing is true and correct.\n\nSignature: ____________________\nDate: ${new Date().toLocaleDateString()}\nWitness Contact: `;
                update('narrative', formData.narrative + (formData.narrative ? '\n\n' : '') + template);
              }}
            >
              <FileText className="w-3 h-3" /> Insert Witness Template
            </button>
          </div>
        </div>
      )}
    </FormModal>
  );
}
