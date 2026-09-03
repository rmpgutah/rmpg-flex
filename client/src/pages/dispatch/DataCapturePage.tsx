// client/src/pages/dispatch/DataCapturePage.tsx
// Unified Dispatch Data Capture + Cross-Reference Query Engine
// Tabs: Live Capture | Subject Dossier | Skip Trace | Query History

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, UserPlus, ClipboardList, History,
  AlertTriangle, CheckCircle, Car, FileText,
  ChevronRight, Loader2, X, Plus, Eye,
} from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { apiFetch } from '../../hooks/useApi';

// ── Types ─────────────────────────────────────────────────────

interface CfsSubject {
  id: number;
  call_id: number;
  person_id: number | null;
  role: string;
  relationship_to_call: string | null;
  description_narrative: string | null;
  last_seen_location: string | null;
  last_seen_at: string | null;
  direction_of_travel: string | null;
  vehicle_description: string | null;
  located: number;
  arrested: number;
  disposition: string | null;
  // joined from persons
  first_name?: string;
  last_name?: string;
  dob?: string;
  phone?: string;
  caution_flags?: string;
  flags?: string;
  photo_url?: string;
}

interface QueryResults {
  results: {
    persons: any[];
    dl_records: any[];
    vehicles: any[];
    warrants: any[];
    dossiers: any[];
    person_intel: any[];
    call_history: any[];
  };
  sources: string[];
  total_hits: number;
}

interface QueryLogEntry {
  id: number;
  queried_by_name: string;
  query_type: string;
  query_input: string;
  hit_count: number;
  source_tables: string;
  queried_at: string;
}

// ── Shared tab styles ─────────────────────────────────────────

const TAB_ITEMS = [
  { id: 'capture', label: 'Live Capture', icon: ClipboardList },
  { id: 'dossier', label: 'Dossier', icon: UserPlus },
  { id: 'query', label: 'Skip Trace', icon: Search },
  { id: 'history', label: 'Query Log', icon: History },
] as const;
type TabId = typeof TAB_ITEMS[number]['id'];

const ROLE_LABELS: Record<string, string> = {
  caller: 'Caller',
  suspect: 'Suspect',
  victim: 'Victim',
  witness: 'Witness',
  contact: 'Contact',
  reporting_party: 'Reporting Party',
  bystander: 'Bystander',
};

const ROLE_COLORS: Record<string, string> = {
  caller:          'text-blue-400 bg-blue-900/30',
  suspect:         'text-red-400 bg-red-900/30',
  victim:          'text-amber-400 bg-amber-900/30',
  witness:         'text-emerald-400 bg-emerald-900/30',
  contact:         'text-slate-300 bg-slate-700/40',
  reporting_party: 'text-purple-400 bg-purple-900/30',
  bystander:       'text-slate-400 bg-slate-700/40',
};

// ── Live Capture Tab ──────────────────────────────────────────

function LiveCaptureTab({ callId }: { callId: number | null }) {
  const [subjects, setSubjects] = useState<CfsSubject[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newSubject, setNewSubject] = useState({
    role: 'contact',
    description_narrative: '',
    relationship_to_call: '',
    last_seen_location: '',
    direction_of_travel: '',
    vehicle_description: '',
  });

  const loadSubjects = useCallback(async () => {
    if (!callId) return;
    setLoading(true);
    try {
      const rows = await apiFetch<CfsSubject[]>(`/dispatch/capture/subjects/${callId}`);
      setSubjects(rows ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  const addSubject = async () => {
    if (!callId) return;
    try {
      await apiFetch('/dispatch/capture/subject', {
        method: 'POST',
        body: JSON.stringify({ call_id: callId, ...newSubject }),
      });
      setAdding(false);
      setNewSubject({ role: 'contact', description_narrative: '', relationship_to_call: '', last_seen_location: '', direction_of_travel: '', vehicle_description: '' });
      loadSubjects();
    } catch { /* ignore */ }
  };

  const updateDisposition = async (id: number, field: 'located' | 'arrested', val: boolean) => {
    try {
      await apiFetch(`/dispatch/capture/subject/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: val }),
      });
      setSubjects(s => s.map(x => x.id === id ? { ...x, [field]: val ? 1 : 0 } : x));
    } catch { /* ignore */ }
  };

  const removeSubject = async (id: number) => {
    try {
      await apiFetch(`/dispatch/capture/subject/${id}`, { method: 'DELETE' });
      setSubjects(s => s.filter(x => x.id !== id));
    } catch { /* ignore */ }
  };

  if (!callId) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-sm gap-2">
        <ClipboardList className="w-8 h-8 opacity-40" />
        <p>Select a call number above to begin capture</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">CFS #{callId} — {subjects.length} subject(s)</span>
        <button
          onClick={() => setAdding(v => !v)}
          aria-label={adding ? 'Cancel adding subject' : 'Add subject to call'}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-raised hover:bg-surface-hover text-brand-300 border border-brand-700/30"
        >
          <Plus className="w-3 h-3" /> Add Subject
        </button>
      </div>

      {adding && (
        <div className="rounded border border-brand-700/30 bg-surface-raised p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-[color:var(--field-label-color)] mb-1">Role</label>
              <select
                value={newSubject.role}
                onChange={e => setNewSubject(s => ({ ...s, role: e.target.value }))}
                className="w-full bg-surface-sunken border border-brand-700/30 rounded px-2 py-1 text-xs text-slate-200"
              >
                {Object.entries(ROLE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[color:var(--field-label-color)] mb-1">Relationship to Call</label>
              <input
                type="text"
                value={newSubject.relationship_to_call}
                onChange={e => setNewSubject(s => ({ ...s, relationship_to_call: e.target.value }))}
                placeholder="e.g. lives at address"
                className="w-full bg-surface-sunken border border-brand-700/30 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-[color:var(--field-label-color)] mb-1">Physical Description</label>
            <textarea
              rows={2}
              value={newSubject.description_narrative}
              onChange={e => setNewSubject(s => ({ ...s, description_narrative: e.target.value }))}
              placeholder="As described by caller: BMA, 6'0, blue hoodie..."
              className="w-full bg-surface-sunken border border-brand-700/30 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-[color:var(--field-label-color)] mb-1">Last Seen Location</label>
              <input
                type="text"
                value={newSubject.last_seen_location}
                onChange={e => setNewSubject(s => ({ ...s, last_seen_location: e.target.value }))}
                className="w-full bg-surface-sunken border border-brand-700/30 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[color:var(--field-label-color)] mb-1">Direction of Travel</label>
              <input
                type="text"
                value={newSubject.direction_of_travel}
                onChange={e => setNewSubject(s => ({ ...s, direction_of_travel: e.target.value }))}
                placeholder="NB on State St"
                className="w-full bg-surface-sunken border border-brand-700/30 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-[color:var(--field-label-color)] mb-1">Vehicle Description</label>
            <input
              type="text"
              value={newSubject.vehicle_description}
              onChange={e => setNewSubject(s => ({ ...s, vehicle_description: e.target.value }))}
              placeholder="2019 silver Honda Civic, UT plate ABC123"
              className="w-full bg-surface-sunken border border-brand-700/30 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAdding(false)} className="px-2 py-1 text-xs rounded bg-surface-sunken text-slate-400 hover:text-slate-200">Cancel</button>
            <button onClick={addSubject} className="px-3 py-1 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white">Save Subject</button>
          </div>
        </div>
      )}

      {loading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-brand-400" /></div>}

      <div className="space-y-2">
        {subjects.map(s => (
          <div key={s.id} className="rounded border border-brand-800/40 bg-surface-raised p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${ROLE_COLORS[s.role] ?? ROLE_COLORS.contact}`}>
                  {ROLE_LABELS[s.role] ?? s.role}
                </span>
                {s.first_name && (
                  <span className="text-xs font-semibold text-slate-200 truncate">
                    {s.first_name} {s.last_name}
                  </span>
                )}
                {s.caution_flags && (
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" aria-label={s.caution_flags ?? undefined} />
                )}
              </div>
              <button aria-label="Remove subject" onClick={() => removeSubject(s.id)} className="text-slate-500 hover:text-red-400 shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {s.description_narrative && (
              <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">{s.description_narrative}</p>
            )}

            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
              {s.relationship_to_call && (
                <span className="text-slate-400"><span className="text-[color:var(--field-label-color)]">Relationship:</span> {s.relationship_to_call}</span>
              )}
              {s.last_seen_location && (
                <span className="text-slate-400"><span className="text-[color:var(--field-label-color)]">Last Seen:</span> {s.last_seen_location}</span>
              )}
              {s.direction_of_travel && (
                <span className="text-slate-400"><span className="text-[color:var(--field-label-color)]">DOT:</span> {s.direction_of_travel}</span>
              )}
              {s.vehicle_description && (
                <span className="text-slate-400 col-span-2"><span className="text-[color:var(--field-label-color)]">Vehicle:</span> {s.vehicle_description}</span>
              )}
            </div>

            <div className="mt-2 flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={s.located === 1}
                  onChange={e => updateDisposition(s.id, 'located', e.target.checked)}
                  className="accent-emerald-500 w-3 h-3"
                />
                Located
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={s.arrested === 1}
                  onChange={e => updateDisposition(s.id, 'arrested', e.target.checked)}
                  className="accent-red-500 w-3 h-3"
                />
                Arrested
              </label>
              {s.person_id && (
                <span className="text-[10px] text-brand-400 flex items-center gap-0.5">
                  <Eye className="w-3 h-3" /> Linked to Person #{s.person_id}
                </span>
              )}
            </div>
          </div>
        ))}

        {!loading && subjects.length === 0 && !adding && (
          <p className="text-center text-xs text-slate-500 py-6">No subjects captured yet</p>
        )}
      </div>
    </div>
  );
}

// ── Skip Trace / Query Tab ────────────────────────────────────

function SkipTraceTab({ callId }: { callId: number | null }) {
  const [form, setForm] = useState({
    name: '', first_name: '', last_name: '',
    dob: '', phone: '', email: '', plate: '', address: '', dl_number: '',
  });
  const [results, setResults] = useState<QueryResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const runQuery = async () => {
    const payload = Object.fromEntries(
      Object.entries({ ...form, call_id: callId ?? undefined }).filter(([, v]) => v)
    );
    if (Object.keys(payload).filter(k => k !== 'call_id').length === 0) {
      setError('Enter at least one search field');
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await apiFetch<QueryResults>('/dispatch/capture/query', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setResults(data);
      // Auto-open first non-empty section
      const first = Object.entries(data.results ?? {}).find(([, rows]) => (rows as any[]).length > 0);
      if (first) setActiveSection(first[0]);
    } catch (e: any) {
      setError(e?.message ?? 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const SECTION_LABELS: Record<string, string> = {
    persons: 'Persons',
    dl_records: 'DL Records',
    vehicles: 'Vehicles',
    warrants: 'Active Warrants',
    dossiers: 'Skip Tracer Dossiers',
    person_intel: 'Intel Dossiers',
    call_history: 'Call History',
  };

  return (
    <div className="space-y-3">
      {/* Search form */}
      <div className="rounded border border-brand-800/40 bg-surface-raised p-3 space-y-2">
        <p className="text-[10px] text-[color:var(--panel-header-color)] font-semibold">CROSS-REFERENCE QUERY</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            ['name', 'Full Name'],
            ['first_name', 'First Name'],
            ['last_name', 'Last Name'],
            ['dob', 'DOB (YYYY-MM-DD)'],
            ['phone', 'Phone'],
            ['email', 'Email'],
            ['plate', 'License Plate'],
            ['dl_number', 'DL Number'],
            ['address', 'Address'],
          ].map(([field, label]) => (
            <div key={field}>
              <label className="block text-[10px] text-[color:var(--field-label-color)] mb-0.5">{label}</label>
              <input
                type="text"
                value={(form as any)[field]}
                onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && runQuery()}
                className="w-full bg-surface-sunken border border-brand-700/30 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Searches: persons, DL, vehicles, warrants, intel dossiers, call history</span>
          <button
            onClick={runQuery}
            disabled={loading}
            aria-label={loading ? 'Searching records…' : 'Run query across all record sources'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {loading ? 'Searching…' : 'Run Query'}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {/* Results */}
      {results && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-300">
              {results.total_hits} hit{results.total_hits !== 1 ? 's' : ''} across {results.sources.join(', ') || 'no tables'}
            </span>
          </div>

          {Object.entries(results.results ?? {}).map(([section, rows]) => {
            const arr = rows as any[];
            if (arr.length === 0) return null;
            const isOpen = activeSection === section;
            return (
              <div key={section} className="rounded border border-brand-800/40 bg-surface-raised overflow-hidden">
                <button
                  onClick={() => setActiveSection(isOpen ? null : section)}
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${SECTION_LABELS[section] ?? section} results`}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-300 hover:bg-surface-hover"
                >
                  <span className="font-semibold text-[color:var(--panel-header-color)]">{SECTION_LABELS[section] ?? section}</span>
                  <span className="flex items-center gap-1">
                    <span className="text-slate-400">{arr.length} result{arr.length !== 1 ? 's' : ''}</span>
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-brand-800/40 divide-y divide-brand-800/30">
                    {arr.map((row: any, i: number) => (
                      <ResultRow key={i} row={row} section={section} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {results.total_hits === 0 && (
            <p className="text-center text-xs text-slate-500 py-4">No records found</p>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ row, section }: { row: any; section: string }) {
  if (section === 'persons') {
    return (
      <div className="px-3 py-2 text-[11px] space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200">
            {[row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ')}
          </span>
          {row.dob && <span className="text-slate-400">DOB: {row.dob}</span>}
          {row.caution_flags && <AlertTriangle className="w-3.5 h-3.5 text-red-400" aria-label={row.caution_flags} />}
        </div>
        <div className="text-slate-400 space-x-3">
          {row.phone && <span>📞 {row.phone}</span>}
          {row.email && <span>✉ {row.email}</span>}
          {[row.address, row.city, row.state].filter(Boolean).length > 0 && (
            <span>📍 {[row.address, row.city, row.state].filter(Boolean).join(', ')}</span>
          )}
        </div>
        {row.ncic_number && <span className="text-purple-400">NCIC: {row.ncic_number}</span>}
        {row.alias_nickname && <span className="text-slate-400"> AKA: {row.alias_nickname}</span>}
      </div>
    );
  }
  if (section === 'warrants') {
    return (
      <div className="px-3 py-2 text-[11px]">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="font-semibold text-red-300">{row.subject_name}</span>
          <span className="text-slate-400">{row.warrant_type}</span>
          {row.is_felony ? <span className="text-red-400 font-semibold">FELONY</span> : null}
        </div>
        <div className="text-slate-400 mt-0.5 space-x-2">
          <span>{row.charge_description}</span>
          {row.bail_amount && <span>Bail: ${Number(row.bail_amount).toLocaleString()}</span>}
          {row.extraditable ? <span className="text-amber-400">EXTRADITABLE</span> : null}
        </div>
      </div>
    );
  }
  if (section === 'vehicles') {
    return (
      <div className="px-3 py-2 text-[11px]">
        <div className="flex items-center gap-2">
          <Car className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="font-semibold text-slate-200">
            {[row.year, row.make, row.model, row.color_primary].filter(Boolean).join(' ')}
          </span>
          <span className="text-brand-300 font-mono">{row.plate_number}/{row.plate_state}</span>
          {row.is_stolen ? <span className="text-red-400 font-semibold">STOLEN</span> : null}
        </div>
        {row.registered_owner && <p className="text-slate-400">Owner: {row.registered_owner}</p>}
      </div>
    );
  }
  if (section === 'dl_records') {
    return (
      <div className="px-3 py-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200">{row.full_name}</span>
          <span className="text-slate-400">DOB: {row.dob}</span>
        </div>
        <div className="text-slate-400 space-x-2">
          <span>DL: {row.dl_number}/{row.dl_state}</span>
          {row.eye_color && <span>Eyes: {row.eye_color}</span>}
          {row.hair_color && <span>Hair: {row.hair_color}</span>}
        </div>
      </div>
    );
  }
  if (section === 'call_history') {
    return (
      <div className="px-3 py-2 text-[11px] flex items-center gap-3">
        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-slate-300">CFS #{row.call_number}</span>
        <span className="text-slate-400">{row.incident_type}</span>
        <span className={`text-[10px] px-1 rounded ${row.priority === 1 ? 'text-red-400 bg-red-900/30' : 'text-slate-400 bg-slate-700/30'}`}>P{row.priority}</span>
        <span className="text-slate-500 ml-auto">{row.created_at?.split('T')[0]}</span>
      </div>
    );
  }
  // Generic fallback
  return (
    <div className="px-3 py-2 text-[11px] text-slate-400">
      {Object.entries(row).filter(([, v]) => v != null).slice(0, 5).map(([k, v]) => (
        <span key={k} className="mr-3"><span className="text-[color:var(--field-label-color)]">{k}:</span> {String(v)}</span>
      ))}
    </div>
  );
}

// ── Query History Tab ─────────────────────────────────────────

function QueryHistoryTab() {
  const [rows, setRows] = useState<QueryLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<QueryLogEntry[]>('/dispatch/capture/query-log?limit=50')
      .then(r => setRows(r ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-400" /></div>;

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-slate-500 mb-2">Last 50 PII queries — visible to supervisors/admin</p>
      {rows.length === 0 && <p className="text-center text-xs text-slate-500 py-6">No queries logged</p>}
      {rows.map(r => (
        <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-surface-raised text-[11px]">
          <span className="text-slate-300 w-24 shrink-0 truncate">{r.queried_by_name}</span>
          <span className="text-[color:var(--field-label-color)] w-16 shrink-0">{r.query_type}</span>
          <span className="text-slate-200 flex-1 truncate font-mono">{r.query_input}</span>
          <span className={`shrink-0 w-8 text-right font-semibold ${r.hit_count > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{r.hit_count}</span>
          <span className="text-slate-500 shrink-0 w-20 text-right">{r.queried_at?.split('T')[0]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Dossier Tab (quick launcher into personIntel) ─────────────

function DossierTab({ callId }: { callId: number | null }) {
  const [seed, setSeed] = useState({ name: '', phone: '', email: '', dob: '', plate: '' });
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ dossierId: number } | null>(null);

  const launch = async () => {
    const s: Record<string, string> = {};
    if (seed.name) s.name = seed.name;
    if (seed.phone) s.phone = seed.phone;
    if (seed.email) s.email = seed.email;
    if (seed.dob) s.dob = seed.dob;
    if (seed.plate) s.plate = seed.plate;
    if (Object.keys(s).length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<{ dossierId: number }>('/person-intel', {
        method: 'POST',
        body: JSON.stringify({ seed: s, notes: callId ? `Linked to CFS #${callId}` : undefined }),
      });
      setCreated(res);
    } catch { /* ignore */ } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <CheckCircle className="w-10 h-10 text-emerald-400" />
        <p className="text-sm text-slate-200">Dossier #{created.dossierId} launched</p>
        <p className="text-xs text-slate-400">The PersonIntel engine is now building the OSINT profile in the background.</p>
        <button onClick={() => { setCreated(null); setSeed({ name: '', phone: '', email: '', dob: '', plate: '' }); }}
          className="mt-2 px-3 py-1 text-xs rounded bg-surface-raised hover:bg-surface-hover text-slate-300">New Dossier</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Seed the PersonIntel OSINT engine with identifying information. It will cross-reference all local tables and web sources in the background.</p>
      <div className="rounded border border-brand-800/40 bg-surface-raised p-3 space-y-2">
        {[
          ['name', 'Full Name'], ['phone', 'Phone'], ['email', 'Email'], ['dob', 'DOB (YYYY-MM-DD)'], ['plate', 'License Plate'],
        ].map(([f, l]) => (
          <div key={f}>
            <label className="block text-[10px] text-[color:var(--field-label-color)] mb-0.5">{l}</label>
            <input
              type="text"
              value={(seed as any)[f]}
              onChange={e => setSeed(s => ({ ...s, [f]: e.target.value }))}
              className="w-full bg-surface-sunken border border-brand-700/30 rounded px-2 py-1 text-xs text-slate-200"
            />
          </div>
        ))}
        <button
          onClick={launch}
          disabled={submitting}
          aria-label={submitting ? 'Launching OSINT dossier…' : 'Launch OSINT dossier for this person'}
          className="w-full flex items-center justify-center gap-2 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white"
        >
          {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          {submitting ? 'Launching…' : 'Launch Dossier'}
        </button>
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────

export default function DataCapturePage() {
  const [tab, setTab] = useState<TabId>('capture');
  const [callIdInput, setCallIdInput] = useState('');
  const [activeCallId, setActiveCallId] = useState<number | null>(null);

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <PanelTitleBar title="DISPATCH DATA CAPTURE" icon={ClipboardList} />

      {/* Call selector */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-[color:var(--field-label-color)] shrink-0">CFS #</label>
        <input
          type="number"
          value={callIdInput}
          onChange={e => setCallIdInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && callIdInput) setActiveCallId(Number(callIdInput));
          }}
          placeholder="Enter call ID"
          className="w-36 bg-surface-sunken border border-brand-700/30 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500"
        />
        <button
          onClick={() => callIdInput && setActiveCallId(Number(callIdInput))}
          aria-label="Load call for service by ID"
          className="px-2 py-1 text-xs rounded bg-surface-raised hover:bg-surface-hover text-slate-300 border border-brand-700/30"
        >
          Load
        </button>
        {activeCallId && (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" /> CFS #{activeCallId} active
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-brand-800/40">
        {TAB_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              tab === id
                ? 'border-brand-400 text-brand-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'capture' && <LiveCaptureTab callId={activeCallId} />}
        {tab === 'dossier' && <DossierTab callId={activeCallId} />}
        {tab === 'query' && <SkipTraceTab callId={activeCallId} />}
        {tab === 'history' && <QueryHistoryTab />}
      </div>
    </div>
  );
}
