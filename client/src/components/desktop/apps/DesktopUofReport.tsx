import React, { useState, useEffect } from 'react';
import { Shield, CheckCircle } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';
import { copyToClipboard } from '../../../utils/clipboard';

type Injury = 'none' | 'minor' | 'serious' | 'death';
type OfficerInjury = 'none' | 'minor' | 'serious';
type MedicalTransport = '' | 'ambulance' | 'officer' | 'refused' | 'other';

const FORCE_TYPES = [
  { id: 'empty_hand', label: 'Physical (empty hand)' },
  { id: 'oc_spray', label: 'OC / Pepper spray' },
  { id: 'taser', label: 'Taser' },
  { id: 'baton', label: 'Baton' },
  { id: 'k9', label: 'K9' },
  { id: 'firearm', label: 'Firearm' },
  { id: 'other', label: 'Other' },
] as const;

const COURTS = [
  'Salt Lake County District Court',
  'West Valley City Justice Court',
  'Murray City Justice Court',
  'Taylorsville City Justice Court',
  'Millcreek Justice Court',
  'Holladay City Justice Court',
  'Salt Lake City Justice Court',
];

interface Props {
  callId?: string;
  onClose?: () => void;
}

const ALLOWED_ROLES = ['officer', 'supervisor', 'admin', 'manager'];
const UOF_DRAFT_KEY = 'rmpg_uof_ops_draft';

function loadUofOpsDraft(): { callId?: string; location?: string; forceTypes?: string[]; officerAction?: string } {
  try {
    const raw = localStorage.getItem(UOF_DRAFT_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      callId: typeof p.callId === 'string' ? p.callId : undefined,
      location: typeof p.location === 'string' ? p.location : undefined,
      forceTypes: Array.isArray(p.forceTypes) ? p.forceTypes.filter((x): x is string => typeof x === 'string') : undefined,
      officerAction: typeof p.officerAction === 'string' ? p.officerAction : undefined,
    };
  } catch {
    return {};
  }
}

export default function DesktopUofReport({ callId: propCallId, onClose }: Props) {
  const { user } = useAuth();
  const canAccess = user && ALLOWED_ROLES.includes(user.role);

  // Section 1
  const opsDraft = loadUofOpsDraft();
  const [callId, setCallId] = useState(propCallId ?? opsDraft.callId ?? '');
  const [incidentDateTime, setIncidentDateTime] = useState(() => new Date().toISOString().slice(0, 16)); // new-date-ok — local datetime-local default
  const [location, setLocation] = useState(opsDraft.location ?? '');

  // Section 2
  const [subjectName, setSubjectName] = useState('');
  const [subjectDob, setSubjectDob] = useState('');
  const [subjectRace, setSubjectRace] = useState('');
  const [subjectGender, setSubjectGender] = useState('');
  const [subjectAge, setSubjectAge] = useState('');

  // Section 3
  const [forceTypes, setForceTypes] = useState<Set<string>>(() => new Set(opsDraft.forceTypes ?? []));
  const [officerAction, setOfficerAction] = useState(opsDraft.officerAction ?? '');

  // Section 4
  const [subjectInjury, setSubjectInjury] = useState<Injury>('none');
  const [officerInjury, setOfficerInjury] = useState<OfficerInjury>('none');
  const [medicalProvided, setMedicalProvided] = useState(false);
  const [transportMethod, setTransportMethod] = useState<MedicalTransport>('');

  // Section 5
  const [supervisorNotified, setSupervisorNotified] = useState(false);
  const [supervisorName, setSupervisorName] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(UOF_DRAFT_KEY, JSON.stringify({
        callId, location, forceTypes: [...forceTypes], officerAction,
      }));
    } catch { /* quota */ }
  }, [callId, location, forceTypes, officerAction]);

  const toggleForce = (id: string) => {
    setForceTypes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetch('/records/incidents', {
        method: 'POST',
        body: JSON.stringify({
          type: 'use_of_force',
          call_id: callId || undefined,
          incident_datetime: incidentDateTime,
          location,
          subject_name: subjectName,
          subject_dob: subjectDob,
          subject_race: subjectRace,
          subject_gender: subjectGender,
          subject_age: subjectAge ? Number(subjectAge) : undefined,
          force_types: [...forceTypes],
          officer_action: officerAction,
          subject_injury: subjectInjury,
          officer_injury: officerInjury,
          medical_provided: medicalProvided,
          transport_method: transportMethod || undefined,
          supervisor_notified: supervisorNotified,
          supervisor_name: supervisorName || undefined,
          reporting_officer_badge: user?.badge_number,
        }),
      });
      setSubmitted(true);
      setTimeout(() => onClose?.(), 2000);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!canAccess) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--surface-base)' }}>
        <p style={{ fontSize: 12, color: 'var(--sev-critical)' }}>Access restricted to officers and supervisors</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, background: 'var(--surface-base)' }}>
        <CheckCircle size={36} style={{ color: 'var(--sev-ok)' }} />
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Report submitted</p>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: 11, padding: '4px 8px', background: 'var(--surface-sunken)',
    border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9, color: 'var(--field-label-color)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 3,
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em',
    color: 'var(--panel-header-color, var(--accent-gold-300))', marginBottom: 10, marginTop: 4,
    borderBottom: '1px solid var(--border-default)', paddingBottom: 4,
  };
  const fieldGroup: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
  const row2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
  const row3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 };

  const radioOpt = (name: string, value: string, current: string, set: (v: string) => void, label: string) => (
    <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)' }}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => set(value)} />
      {label}
    </label>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-base)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <Shield size={13} style={{ color: 'var(--accent-silver-400)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)' }}>
          Use of Force Report
        </span>
        {user?.badge_number && <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 'auto' }}>Badge #{user.badge_number}</span>}
      </div>

      {/* Form */}
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Section 1 */}
        <div>
          <p style={sectionTitle}>1 — Incident Info</p>
          <div style={{ ...row3, marginBottom: 10 }}>
            <div style={fieldGroup}>
              <label style={labelStyle}>Call ID</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="text" value={callId} onChange={e => setCallId(e.target.value)} style={inputStyle} placeholder="Optional" />
                <button
                  type="button"
                  disabled={!callId.trim()}
                  onClick={() => void copyToClipboard(callId)}
                  style={{ fontSize: 10, padding: '4px 8px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
                >Copy</button>
              </div>
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Date / Time</label>
              <input type="datetime-local" value={incidentDateTime} onChange={e => setIncidentDateTime(e.target.value)} style={inputStyle} />
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Location</label>
              <input type="text" value={location} onChange={e => setLocation(e.target.value)} style={inputStyle} placeholder="Address…" />
            </div>
          </div>
        </div>

        {/* Section 2 */}
        <div>
          <p style={sectionTitle}>2 — Subject</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 10 }}>
            <div style={fieldGroup}>
              <label style={labelStyle}>Name</label>
              <input type="text" value={subjectName} onChange={e => setSubjectName(e.target.value)} style={inputStyle} />
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>DOB</label>
              <input type="date" value={subjectDob} onChange={e => setSubjectDob(e.target.value)} style={inputStyle} />
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Race / Ethnicity</label>
              <select value={subjectRace} onChange={e => setSubjectRace(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                <option value="white">White</option>
                <option value="black">Black / African American</option>
                <option value="hispanic">Hispanic / Latino</option>
                <option value="asian">Asian</option>
                <option value="native">American Indian / Alaska Native</option>
                <option value="pacific">Native Hawaiian / Pacific Islander</option>
                <option value="other">Other</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Gender</label>
              <select value={subjectGender} onChange={e => setSubjectGender(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="nonbinary">Non-binary</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Age</label>
              <input type="number" value={subjectAge} onChange={e => setSubjectAge(e.target.value)} style={inputStyle} min={0} max={120} />
            </div>
          </div>
        </div>

        {/* Section 3 */}
        <div>
          <p style={sectionTitle}>3 — Use of Force</p>
          <label style={labelStyle}>Type of force (select all that apply)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {FORCE_TYPES.map(f => (
              <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={forceTypes.has(f.id)} onChange={() => toggleForce(f.id)} />
                {f.label}
              </label>
            ))}
          </div>
          <div style={fieldGroup}>
            <label style={labelStyle}>Officer action narrative (max 500 chars)</label>
            <textarea
              value={officerAction}
              onChange={e => setOfficerAction(e.target.value.slice(0, 500))}
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="Describe the officer actions taken…"
            />
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', textAlign: 'right' }}>{officerAction.length}/500</span>
          </div>
        </div>

        {/* Section 4 */}
        <div>
          <p style={sectionTitle}>4 — Injuries &amp; Medical</p>
          <div style={row2}>
            <div>
              <label style={labelStyle}>Subject injuries</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {['none', 'minor', 'serious', 'death'].map(v => radioOpt('subject_injury', v, subjectInjury, v => setSubjectInjury(v as Injury), v.charAt(0).toUpperCase() + v.slice(1)))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Officer injuries</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {['none', 'minor', 'serious'].map(v => radioOpt('officer_injury', v, officerInjury, v => setOfficerInjury(v as OfficerInjury), v.charAt(0).toUpperCase() + v.slice(1)))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={medicalProvided} onChange={e => setMedicalProvided(e.target.checked)} />
              Medical aid provided
            </label>
            {medicalProvided && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={labelStyle}>Transport:</label>
                <select value={transportMethod} onChange={e => setTransportMethod(e.target.value as MedicalTransport)} style={{ ...inputStyle, width: 'auto' }}>
                  <option value="">—</option>
                  <option value="ambulance">Ambulance</option>
                  <option value="officer">Officer vehicle</option>
                  <option value="refused">Subject refused</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Section 5 */}
        <div>
          <p style={sectionTitle}>5 — Supervisor</p>
          <div style={row2}>
            <div>
              <label style={labelStyle}>Supervisor notified?</label>
              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)' }}>
                  <input type="radio" name="sup_notified" checked={supervisorNotified} onChange={() => setSupervisorNotified(true)} /> Yes
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)' }}>
                  <input type="radio" name="sup_notified" checked={!supervisorNotified} onChange={() => setSupervisorNotified(false)} /> No
                </label>
              </div>
            </div>
            {supervisorNotified && (
              <div style={fieldGroup}>
                <label style={labelStyle}>Supervisor name</label>
                <input type="text" value={supervisorName} onChange={e => setSupervisorName(e.target.value)} style={inputStyle} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 16px', background: 'var(--surface-raised)', borderTop: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {submitError && <span style={{ fontSize: 10, color: 'var(--sev-critical)', flex: 1 }}>{submitError}</span>}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            fontSize: 12, fontWeight: 700, padding: '7px 28px', borderRadius: 2, cursor: 'pointer',
            background: 'var(--sev-ok)', border: 'none', color: '#fff',
          }}
        >
          {submitting ? 'Submitting…' : 'Submit Report'}
        </button>
      </div>
    </div>
  );
}
