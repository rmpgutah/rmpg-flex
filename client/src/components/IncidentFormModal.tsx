import React, { useState, useEffect } from 'react';
import { FileText, Scale } from 'lucide-react';
import FormModal from './FormModal';
import type { Incident, CallPriority } from '../types';
import { INCIDENT_TYPE_CATEGORIES, type IncidentType } from '../utils/caseNumbers';
import AddressAutocomplete, { type ParsedAddress } from './AddressAutocomplete';
import StatuteLookup, { type StatuteResult } from './StatuteLookup';

interface IncidentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: IncidentFormData) => void;
  isSubmitting: boolean;
  editingIncident?: Incident;
  dispositionCodes?: {code: string; description: string; color?: string}[];
  clients?: { id: string; name: string }[];
}

export interface IncidentFormData {
  incident_type: IncidentType;
  priority: CallPriority;
  location_address: string;
  narrative: string;
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
  section_id: string;
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
}

// Helpers to detect type-specific sub-sections
const TRAFFIC_TYPES: string[] = ['traffic_accident', 'hit_and_run', 'dui_dwi', 'parking_violation', 'traffic_hazard', 'abandoned_vehicle'];
const MEDICAL_TYPES: string[] = ['medical_emergency', 'overdose', 'mental_health_crisis'];
const TRESPASS_TYPES: string[] = ['trespass'];
const USE_OF_FORCE_TYPES: string[] = ['assault', 'battery'];

const PRIORITY_OPTIONS: { value: CallPriority; label: string; color: string; desc: string }[] = [
  { value: 'P1', label: 'P1', color: 'border-red-500 text-red-400 bg-red-900/30', desc: 'Emergency' },
  { value: 'P2', label: 'P2', color: 'border-amber-500 text-amber-400 bg-amber-900/30', desc: 'Urgent' },
  { value: 'P3', label: 'P3', color: 'border-brand-500 text-brand-400 bg-brand-900/30', desc: 'Routine' },
  { value: 'P4', label: 'P4', color: 'border-gray-500 text-rmpg-300 bg-rmpg-700/30', desc: 'Scheduled' },
];

const WEATHER_OPTIONS = [
  '', 'Clear', 'Partly Cloudy', 'Overcast', 'Rain', 'Snow', 'Fog', 'Sleet/Hail',
  'Windy', 'Extreme Heat', 'Extreme Cold', 'Unknown',
];

const LIGHTING_OPTIONS = [
  '', 'Daylight', 'Dusk/Dawn', 'Dark - Street Lit', 'Dark - Not Lit',
  'Artificial Light', 'Unknown',
];

const WEAPONS_OPTIONS = ['None', 'Firearm — Handgun', 'Firearm — Rifle', 'Firearm — Shotgun', 'Firearm — Unknown Type', 'Knife / Edged Weapon', 'Blunt Object', 'Vehicle (used as weapon)', 'Hands / Fists / Feet', 'Chemical Spray', 'Taser / Stun Gun', 'Explosive / IED', 'BB / Pellet Gun', 'Bow / Crossbow', 'Replica / Toy Weapon', 'Unknown Weapon', 'Other'];
const LE_AGENCY_OPTIONS = ['None', 'RMPG Internal', 'Salt Lake City PD', 'West Valley City PD', 'West Jordan PD', 'Sandy City PD', 'South Jordan PD', 'Draper PD', 'Murray PD', 'Midvale PD', 'South Salt Lake PD', 'Herriman PD', 'Riverton PD', 'Salt Lake County Sheriff', 'Utah County Sheriff', 'Davis County Sheriff', 'Utah Highway Patrol (UHP)', 'Park City PD', 'Provo PD', 'Orem PD', 'Ogden PD', 'Layton PD', 'Unified Police Dept (UPD)', 'FBI', 'ATF', 'DEA', 'US Marshals', 'Other — See Notes'];
const SECTION_OPTIONS = ['', 'SEC-1', 'SEC-2', 'SEC-3', 'SEC-4', 'SEC-5', 'SEC-6', 'SEC-7', 'SEC-8', 'SEC-N', 'SEC-S', 'SEC-E', 'SEC-W'];
const ZONE_OPTIONS = ['', 'Z-01', 'Z-02', 'Z-03', 'Z-04', 'Z-05', 'Z-06', 'Z-07', 'Z-08', 'Z-09', 'Z-10', 'Z-11', 'Z-12'];
const BEAT_OPTIONS = ['', 'B-01', 'B-02', 'B-03', 'B-04', 'B-05', 'B-06', 'B-07', 'B-08', 'B-09', 'B-10', 'B-11', 'B-12', 'B-13', 'B-14', 'B-15', 'B-16'];

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
  section_id: '',
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
};

export default function IncidentFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingIncident,
  dispositionCodes = [],
  clients = [],
}: IncidentFormModalProps) {
  const [formData, setFormData] = useState<IncidentFormData>(EMPTY_FORM);
  const [activeSection, setActiveSection] = useState<SectionId>('basic');

  useEffect(() => {
    if (isOpen) {
      if (editingIncident) {
        const inc = editingIncident as any;
        setFormData({
          incident_type: editingIncident.type,
          priority: editingIncident.priority,
          location_address: editingIncident.location,
          narrative: editingIncident.narrative || '',
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
          section_id: inc.section_id || '',
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
        });
      } else {
        setFormData(EMPTY_FORM);
      }
      setActiveSection('basic');
    }
  }, [isOpen, editingIncident]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.incident_type) return;
    onSubmit(formData);
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
          <div className="grid grid-cols-2 gap-4">
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
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Section ID</label>
              <select className="select-dark mt-1" value={formData.section_id} onChange={(e) => update('section_id', e.target.value)}>
                <option value="">-- Select --</option>
                {SECTION_OPTIONS.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Zone ID</label>
              <select className="select-dark mt-1" value={formData.zone_id} onChange={(e) => update('zone_id', e.target.value)}>
                <option value="">-- Select --</option>
                {ZONE_OPTIONS.filter(Boolean).map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Beat ID</label>
              <select className="select-dark mt-1" value={formData.beat_id} onChange={(e) => update('beat_id', e.target.value)}>
                <option value="">-- Select --</option>
                {BEAT_OPTIONS.filter(Boolean).map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          {/* Priority Buttons */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold mb-2 block">Priority</label>
            <div className="grid grid-cols-4 gap-2">
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
              onSelect={(addr: ParsedAddress) => {
                update('location_address', addr.formatted);
                if (addr.latitude != null) setFormData((prev) => ({ ...prev, latitude: addr.latitude, longitude: addr.longitude }));
              }}
              required
            />
          </div>

          {/* Client */}
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

          {/* Occurred Date/Time */}
          <div className="grid grid-cols-4 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
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

          {/* Damage */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Damage Estimate ($)</label>
              <input
                type="text"
                className="input-dark mt-1"
                placeholder="e.g. 500.00"
                value={formData.damage_estimate}
                onChange={(e) => update('damage_estimate', e.target.value)}
              />
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
          <div className="grid grid-cols-2 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
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

      {/* ── Flags & LE Section ── */}
      {activeSection === 'flags' && (
        <>
          {/* Boolean Flags */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold mb-2 block">Incident Flags</label>
            <div className="grid grid-cols-3 gap-3">
              <label className="flex items-center gap-2 p-2 bg-rmpg-800/50 border border-rmpg-600 cursor-pointer hover:border-rmpg-400 transition-colors">
                <input
                  type="checkbox"
                  checked={formData.alcohol_involved}
                  onChange={(e) => update('alcohol_involved', e.target.checked)}
                  className="w-4 h-4 accent-red-500"
                />
                <span className="text-xs text-rmpg-200">Alcohol Involved</span>
              </label>
              <label className="flex items-center gap-2 p-2 bg-rmpg-800/50 border border-rmpg-600 cursor-pointer hover:border-rmpg-400 transition-colors">
                <input
                  type="checkbox"
                  checked={formData.drugs_involved}
                  onChange={(e) => update('drugs_involved', e.target.checked)}
                  className="w-4 h-4 accent-red-500"
                />
                <span className="text-xs text-rmpg-200">Drugs Involved</span>
              </label>
              <label className="flex items-center gap-2 p-2 bg-rmpg-800/50 border border-rmpg-600 cursor-pointer hover:border-rmpg-400 transition-colors">
                <input
                  type="checkbox"
                  checked={formData.domestic_violence}
                  onChange={(e) => update('domestic_violence', e.target.checked)}
                  className="w-4 h-4 accent-red-500"
                />
                <span className="text-xs text-rmpg-200">Domestic Violence</span>
              </label>
            </div>
          </div>

          {/* Law Enforcement */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Responding LE Agency</label>
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
          <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Narrative</label>
          <textarea
            className="textarea-dark mt-1"
            rows={12}
            placeholder="Describe the incident in detail. Include who, what, when, where, why, and how..."
            value={formData.narrative}
            onChange={(e) => update('narrative', e.target.value)}
          />
          <p className="text-[10px] text-rmpg-500 mt-1">
            {formData.narrative.length} characters | {formData.narrative.split(/\s+/).filter(Boolean).length} words
          </p>
        </div>
      )}
    </FormModal>
  );
}
