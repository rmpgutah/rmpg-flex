import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FileText, Printer, Trash2, PenLine } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { apiFetch } from '../../../hooks/useApi';
import { copyToClipboard } from '../../../utils/contextMenuActions';

const COURTS = [
  'Salt Lake County District Court (3rd District)',
  'West Valley City Justice Court',
  'Murray City Justice Court',
  'Taylorsville City Justice Court',
  'Millcreek Justice Court',
  'Holladay City Justice Court',
  'Salt Lake City Justice Court',
  'Midvale City Justice Court',
  'Sandy City Justice Court',
  'South Jordan City Justice Court',
  'Riverton City Justice Court',
  'Herriman City Justice Court',
];

const DL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

interface Props {
  onClose?: () => void;
}

const BLANK = {
  // Violator
  firstName: '', lastName: '', dob: '', address: '', city: '', state: 'UT', zip: '', dlNumber: '', dlState: 'UT',
  // Vehicle
  plate: '', plateState: 'UT', make: '', model: '', year: '', color: '',
  // Violation
  violationCode: '', violationDesc: '', speed: '', speedLimit: '', violationLocation: '', violationDateTime: new Date().toISOString().slice(0, 16),
  // Court
  courtDate: '', court: COURTS[0],
};

const DRAFT_KEY = 'rmpg_citation_ops_draft';
const PLATES_KEY = 'rmpg_citation_recent_plates';

function loadOpsDraft(): Partial<typeof BLANK> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const allowed = [
      'plate', 'plateState', 'make', 'model', 'year', 'color',
      'violationCode', 'violationDesc', 'speed', 'speedLimit', 'violationLocation',
      'courtDate', 'court',
    ] as const;
    const next: Partial<typeof BLANK> = {};
    for (const k of allowed) {
      if (typeof parsed[k] === 'string') next[k] = parsed[k];
    }
    return next;
  } catch {
    return {};
  }
}

function loadRecentPlates(): string[] {
  try {
    const raw = localStorage.getItem(PLATES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export default function DesktopCitationGenerator({ onClose: _onClose }: Props) {
  const { user } = useAuth();
  const [form, setForm] = useState({ ...BLANK, ...loadOpsDraft() });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [recentPlates, setRecentPlates] = useState<string[]>(loadRecentPlates);

  // Signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  const set = (field: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const clearCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const src = 'touches' in e ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    drawing.current = true;
    const c = canvasRef.current;
    if (!c) return;
    const pos = getPos(e, c);
    lastPt.current = pos;
  }, []);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e, c);
    if (lastPt.current) {
      ctx.beginPath();
      ctx.moveTo(lastPt.current.x, lastPt.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = 'var(--text-primary, #f0f4f9)';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    lastPt.current = pos;
  }, []);

  const endDraw = useCallback(() => { drawing.current = false; lastPt.current = null; }, []);

  const handlePrint = () => window.print();

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        plate: form.plate, plateState: form.plateState, make: form.make, model: form.model,
        year: form.year, color: form.color, violationCode: form.violationCode, violationDesc: form.violationDesc,
        speed: form.speed, speedLimit: form.speedLimit, violationLocation: form.violationLocation,
        courtDate: form.courtDate, court: form.court,
      }));
    } catch { /* quota */ }
  }, [form.plate, form.plateState, form.make, form.model, form.year, form.color, form.violationCode, form.violationDesc, form.speed, form.speedLimit, form.violationLocation, form.courtDate, form.court]);

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      await apiFetch('/records/citations', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          officer_badge: user?.badge_number,
          officer_name: user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() : undefined,
        }),
      });
      setSaveStatus('Saved');
      if (form.plate.trim()) {
        const next = [form.plate.trim().toUpperCase(), ...loadRecentPlates().filter((p) => p !== form.plate.trim().toUpperCase())].slice(0, 8);
        try { localStorage.setItem(PLATES_KEY, JSON.stringify(next)); } catch { /* quota */ }
        setRecentPlates(next);
      }
    } catch {
      // endpoint may not exist — soft fail
      setSaveStatus('(record not saved — endpoint unavailable)');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  const handleClear = () => {
    setForm({ ...BLANK });
    clearCanvas();
    setSaveStatus(null);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: 11, padding: '4px 6px', background: 'var(--surface-sunken)',
    border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none',
    boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9, color: 'var(--field-label-color)', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 2,
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em',
    color: 'var(--panel-header-color, var(--accent-gold-300))', marginBottom: 8, marginTop: 12,
    borderBottom: '1px solid var(--border-default)', paddingBottom: 3,
  };
  const field = (label: string, el: React.ReactNode): React.ReactNode => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <label style={labelStyle}>{label}</label>
      {el}
    </div>
  );
  const row = (...cols: number[]) => ({
    display: 'grid',
    gridTemplateColumns: cols.map(c => `${c}fr`).join(' '),
    gap: 8,
    marginBottom: 6,
  } as React.CSSProperties);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-base)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <FileText size={13} style={{ color: 'var(--accent-silver-400)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>
          Citation Generator
        </span>
        {user?.badge_number && <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Badge #{user.badge_number}</span>}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Form — left panel */}
        <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px', borderRight: '1px solid var(--border-default)' }}>
          {/* Violator */}
          <p style={sectionTitle}>Violator</p>
          <div style={row(1, 1, 1)}>
            {field('First name', <input type="text" value={form.firstName} onChange={set('firstName')} style={inputStyle} />)}
            {field('Last name', <input type="text" value={form.lastName} onChange={set('lastName')} style={inputStyle} />)}
            {field('DOB', <input type="date" value={form.dob} onChange={set('dob')} style={inputStyle} />)}
          </div>
          <div style={row(3, 2, 1, 1)}>
            {field('Address', <input type="text" value={form.address} onChange={set('address')} style={inputStyle} />)}
            {field('City', <input type="text" value={form.city} onChange={set('city')} style={inputStyle} />)}
            {field('State', <select value={form.state} onChange={set('state')} style={inputStyle}>{DL_STATES.map(s => <option key={s} value={s}>{s}</option>)}</select>)}
            {field('ZIP', <input type="text" value={form.zip} onChange={set('zip')} style={inputStyle} maxLength={10} />)}
          </div>
          <div style={row(2, 1)}>
            {field('DL Number', <input type="text" value={form.dlNumber} onChange={set('dlNumber')} style={inputStyle} />)}
            {field('DL State', <select value={form.dlState} onChange={set('dlState')} style={inputStyle}>{DL_STATES.map(s => <option key={s} value={s}>{s}</option>)}</select>)}
          </div>

          {/* Vehicle */}
          <p style={sectionTitle}>Vehicle</p>
          <div style={row(1, 1, 1, 1, 1, 1)}>
            {field('Plate', <input type="text" value={form.plate} onChange={set('plate')} style={inputStyle} />)}
            {recentPlates.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {recentPlates.map((p) => (
                  <button key={p} type="button" onClick={() => setForm((prev) => ({ ...prev, plate: p }))} style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>{p}</button>
                ))}
              </div>
            )}
            {field('St', <select value={form.plateState} onChange={set('plateState')} style={inputStyle}>{DL_STATES.map(s => <option key={s} value={s}>{s}</option>)}</select>)}
            {field('Make', <input type="text" value={form.make} onChange={set('make')} style={inputStyle} />)}
            {field('Model', <input type="text" value={form.model} onChange={set('model')} style={inputStyle} />)}
            {field('Year', <input type="text" value={form.year} onChange={set('year')} style={inputStyle} maxLength={4} />)}
            {field('Color', <input type="text" value={form.color} onChange={set('color')} style={inputStyle} />)}
          </div>

          {/* Violation */}
          <p style={sectionTitle}>Violation</p>
          <div style={row(1, 2)}>
            {field('Code', (
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="text" value={form.violationCode} onChange={set('violationCode')} style={inputStyle} placeholder="e.g. 41-6a-601" />
                <button type="button" disabled={!form.violationCode} onClick={() => void copyToClipboard(form.violationCode)} style={{ fontSize: 9, padding: '0 8px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>Copy</button>
              </div>
            ))}
            {field('Description', <input type="text" value={form.violationDesc} onChange={set('violationDesc')} style={inputStyle} />)}
          </div>
          <div style={row(1, 1, 1, 2)}>
            {field('Speed (mph)', <input type="number" value={form.speed} onChange={set('speed')} style={inputStyle} />)}
            {field('Speed limit', <input type="number" value={form.speedLimit} onChange={set('speedLimit')} style={inputStyle} />)}
            {field('Date / Time', <input type="datetime-local" value={form.violationDateTime} onChange={set('violationDateTime')} style={inputStyle} />)}
            {field('Location', <input type="text" value={form.violationLocation} onChange={set('violationLocation')} style={inputStyle} />)}
          </div>

          {/* Court */}
          <p style={sectionTitle}>Court</p>
          <div style={row(1, 2)}>
            {field('Appearance date', <input type="date" value={form.courtDate} onChange={set('courtDate')} style={inputStyle} />)}
            {field('Court location', <select value={form.court} onChange={set('court')} style={inputStyle}>{COURTS.map(c => <option key={c} value={c}>{c}</option>)}</select>)}
          </div>

          {/* Officer signature */}
          <p style={sectionTitle}>Officer Signature</p>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <canvas
              ref={canvasRef}
              width={260}
              height={72}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
              style={{
                border: '1px solid var(--border-default)', borderRadius: 2,
                background: 'var(--surface-sunken)', cursor: 'crosshair',
                touchAction: 'none',
              }}
            />
            <button
              type="button"
              aria-label="Clear signature"
              onClick={clearCanvas}
              style={{ fontSize: 10, padding: '4px 10px', borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer', background: 'none', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Trash2 size={10} /> Clear sig
            </button>
          </div>
        </div>

        {/* Preview — right panel */}
        <div style={{ width: 280, flexShrink: 0, overflow: 'auto', padding: '10px 14px', background: 'var(--surface-raised)', fontSize: 10 }}>
          <p style={{ ...sectionTitle, marginTop: 0 }}>Preview</p>
          <PreviewField label="Violator" value={[form.firstName, form.lastName].filter(Boolean).join(' ')} />
          <PreviewField label="DOB" value={form.dob} />
          <PreviewField label="Address" value={[form.address, form.city, form.state, form.zip].filter(Boolean).join(', ')} />
          <PreviewField label="DL" value={form.dlNumber ? `${form.dlNumber} (${form.dlState})` : ''} />
          <div style={{ borderTop: '1px solid var(--border-default)', margin: '6px 0' }} />
          <PreviewField label="Vehicle" value={[form.year, form.color, form.make, form.model].filter(Boolean).join(' ')} />
          <PreviewField label="Plate" value={form.plate ? `${form.plate} (${form.plateState})` : ''} />
          <div style={{ borderTop: '1px solid var(--border-default)', margin: '6px 0' }} />
          <PreviewField label="Violation" value={form.violationDesc} />
          <PreviewField label="Code" value={form.violationCode} />
          {form.speed && <PreviewField label="Speed" value={`${form.speed}/${form.speedLimit} mph`} />}
          <PreviewField label="Location" value={form.violationLocation} />
          <PreviewField label="Date / Time" value={form.violationDateTime?.replace('T', ' ')} />
          <div style={{ borderTop: '1px solid var(--border-default)', margin: '6px 0' }} />
          <PreviewField label="Court" value={form.court} />
          <PreviewField label="Appearance" value={form.courtDate} />
          <div style={{ borderTop: '1px solid var(--border-default)', margin: '6px 0' }} />
          <PreviewField label="Officer badge" value={user?.badge_number ?? '—'} />
          {saveStatus && <p style={{ fontSize: 10, color: 'var(--sev-ok)', marginTop: 8 }}>{saveStatus}</p>}
        </div>
      </div>

      {/* Footer actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--surface-raised)', borderTop: '1px solid var(--border-default)', flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleClear}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, padding: '4px 12px', borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer', background: 'none', color: 'var(--text-secondary)' }}
        >
          <Trash2 size={10} /> Clear
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '5px 16px', borderRadius: 2, border: '1px solid var(--accent-silver-400)', cursor: 'pointer', background: 'none', color: 'var(--text-primary)', fontWeight: 700 }}
        >
          <PenLine size={11} /> {saving ? 'Saving…' : 'Save Record'}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '5px 16px', borderRadius: 2, border: 'none', cursor: 'pointer', background: 'var(--accent-silver-400)', color: 'var(--surface-base)', fontWeight: 700 }}
        >
          <Printer size={11} /> Generate PDF
        </button>
      </div>
    </div>
  );
}

function PreviewField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--field-label-color)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}: </span>
      <span style={{ fontSize: 10, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
