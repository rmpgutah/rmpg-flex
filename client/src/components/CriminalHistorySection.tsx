// ============================================================
// RMPG Flex — Criminal History Section
// Displays & manages criminal history records for a person
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import RichTextArea from './RichTextArea';
import {
  Plus, Trash2, Pencil, ChevronDown, ChevronRight, Loader2, Save, X, Gavel,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { toDisplayLabel } from '../utils/formatters';

// ── Types ──────────────────────────────────────────

interface CriminalRecord {
  id: number;
  person_id: number;
  record_type: string;
  offense: string;
  offense_level: string | null;
  statute: string | null;
  case_number: string | null;
  agency: string | null;
  jurisdiction: string | null;
  offense_date: string | null;
  disposition: string | null;
  disposition_date: string | null;
  sentence: string | null;
  source: string | null;
  notes: string | null;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

interface CriminalHistorySectionProps {
  personId: string;
  personName: string;
}

// ── Constants ──────────────────────────────────────

const RECORD_TYPES = [
  { value: 'arrest', label: 'Arrest' },
  { value: 'conviction', label: 'Conviction' },
  { value: 'charge', label: 'Charge' },
  { value: 'booking', label: 'Booking' },
  { value: 'probation', label: 'Probation' },
  { value: 'parole', label: 'Parole' },
  { value: 'court_order', label: 'Court Order' },
  { value: 'restraining_order', label: 'Restraining Order' },
  { value: 'sex_offense', label: 'Sex Offense' },
  { value: 'dui', label: 'DUI/DWI' },
  { value: 'other', label: 'Other' },
];

const OFFENSE_LEVELS = [
  { value: '', label: '-- Select --' },
  { value: 'felony', label: 'Felony' },
  { value: 'misdemeanor', label: 'Misdemeanor' },
  { value: 'infraction', label: 'Infraction' },
  { value: 'civil', label: 'Civil' },
  { value: 'unknown', label: 'Unknown' },
];

const RECORD_TYPE_CLASSES: Record<string, string> = {
  arrest: 'bg-red-900/50 text-red-300 border-red-700/50',
  conviction: 'bg-red-900/60 text-red-400 border-red-600/60',
  charge: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
  booking: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
  probation: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  parole: 'bg-purple-900/50 text-purple-400 border-purple-600/50',
  court_order: 'bg-gray-900/40 text-gray-300 border-gray-700/50',
  restraining_order: 'bg-pink-900/40 text-pink-300 border-pink-700/50',
  sex_offense: 'bg-red-900/70 text-red-300 border-red-500/70',
  dui: 'bg-amber-900/60 text-amber-400 border-amber-600/50',
  other: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
};

const OFFENSE_LEVEL_CLASSES: Record<string, string> = {
  felony: 'bg-red-900/60 text-red-300 border-red-700/50',
  misdemeanor: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  infraction: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  civil: 'bg-brand-900/50 text-brand-400 border-brand-700/50',
  unknown: 'bg-rmpg-700/40 text-rmpg-400 border-rmpg-600/50',
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

const EMPTY_FORM = {
  record_type: 'arrest',
  offense: '',
  offense_level: '',
  statute: '',
  case_number: '',
  agency: '',
  jurisdiction: '',
  offense_date: '',
  disposition: '',
  disposition_date: '',
  sentence: '',
  source: '',
  notes: '',
};

// ── Component ──────────────────────────────────────

export default function CriminalHistorySection({ personId, personName }: CriminalHistorySectionProps) {
  const [records, setRecords] = useState<CriminalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch(`/records/persons/${personId}/criminal-history`) as CriminalRecord[];
      setRecords(data || []);
    } catch (err) {
      console.error('Failed to load criminal history:', err);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const handleSave = async () => {
    if (!form.offense.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/records/criminal-history/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
      } else {
        await apiFetch(`/records/persons/${personId}/criminal-history`, { method: 'POST', body: JSON.stringify(form) });
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ ...EMPTY_FORM });
      await fetchRecords();
    } catch (err) {
      console.error('Save criminal history failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (rec: CriminalRecord) => {
    setEditingId(rec.id);
    setForm({
      record_type: rec.record_type,
      offense: rec.offense,
      offense_level: rec.offense_level || '',
      statute: rec.statute || '',
      case_number: rec.case_number || '',
      agency: rec.agency || '',
      jurisdiction: rec.jurisdiction || '',
      offense_date: rec.offense_date || '',
      disposition: rec.disposition || '',
      disposition_date: rec.disposition_date || '',
      sentence: rec.sentence || '',
      source: rec.source || '',
      notes: rec.notes || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/records/criminal-history/${id}`, { method: 'DELETE' });
      await fetchRecords();
    } catch (err) {
      console.error('Delete criminal history failed:', err);
    }
  };

  // ── Summary stats ──
  const felonies = records.filter(r => r.offense_level === 'felony').length;
  const misdemeanors = records.filter(r => r.offense_level === 'misdemeanor').length;

  return (
    <div className="panel-beveled bg-surface-base overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <button type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 hover:text-rmpg-200 transition-colors"
        >
          {expanded ? <ChevronDown className="w-3 h-3 text-rmpg-400" /> : <ChevronRight className="w-3 h-3 text-rmpg-400" />}
          <Gavel className="w-3 h-3 text-rmpg-400" />
          <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">
            Criminal History
          </h3>
          {!expanded && records.length > 0 && (
            <span className="text-[10px] text-rmpg-500 ml-1">({records.length})</span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {records.length > 0 && (
            <div className="flex gap-1.5">
              {felonies > 0 && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-900/60 text-red-300 border border-red-700/50">
                  {felonies} Felony
                </span>
              )}
              {misdemeanors > 0 && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-amber-900/50 text-amber-300 border border-amber-700/50">
                  {misdemeanors} Misd.
                </span>
              )}
            </div>
          )}
          <button type="button"
            onClick={() => {
              setEditingId(null);
              setForm({ ...EMPTY_FORM });
              setShowForm(!showForm);
              if (!expanded) setExpanded(true);
            }}
            className="toolbar-btn text-[10px]"
            title="Add criminal record"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Add/Edit Form */}
          {showForm && (
            <div className="bg-surface-base border border-rmpg-600 p-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-brand-400 uppercase font-bold tracking-wider">
                  {editingId ? 'Edit Record' : 'Add Criminal Record'}
                </span>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="text-rmpg-400 hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Record Type</label>
                  <select
                    value={form.record_type}
                    onChange={e => setForm(prev => ({ ...prev, record_type: e.target.value }))}
                    className="input-dark w-full text-xs mt-0.5"
                  >
                    {RECORD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Offense Level</label>
                  <select
                    value={form.offense_level}
                    onChange={e => setForm(prev => ({ ...prev, offense_level: e.target.value }))}
                    className="input-dark w-full text-xs mt-0.5"
                  >
                    {OFFENSE_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Offense Date</label>
                  <input
                    type="date"
                    value={form.offense_date}
                    onChange={e => setForm(prev => ({ ...prev, offense_date: e.target.value }))}
                    className="input-dark w-full text-xs mt-0.5"
                  />
                </div>
              </div>

              <div>
                <label className="text-[9px] text-rmpg-400 uppercase font-bold">Offense / Charge *</label>
                <input
                  type="text"
                  value={form.offense}
                  onChange={e => setForm(prev => ({ ...prev, offense: e.target.value }))}
                  placeholder="e.g. Assault 3rd Degree, Theft, DUI..."
                  className="input-dark w-full text-xs mt-0.5"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Statute / Code</label>
                  <input
                    type="text"
                    value={form.statute}
                    onChange={e => setForm(prev => ({ ...prev, statute: e.target.value }))}
                    placeholder="76-5-103"
                    className="input-dark w-full text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Case Number</label>
                  <input
                    type="text"
                    value={form.case_number}
                    onChange={e => setForm(prev => ({ ...prev, case_number: e.target.value }))}
                    className="input-dark w-full text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Agency</label>
                  <input
                    type="text"
                    value={form.agency}
                    onChange={e => setForm(prev => ({ ...prev, agency: e.target.value }))}
                    placeholder="e.g. SLCPD, UHP"
                    className="input-dark w-full text-xs mt-0.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Jurisdiction</label>
                  <input
                    type="text"
                    value={form.jurisdiction}
                    onChange={e => setForm(prev => ({ ...prev, jurisdiction: e.target.value }))}
                    placeholder="e.g. Salt Lake County"
                    className="input-dark w-full text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Disposition</label>
                  <input
                    type="text"
                    value={form.disposition}
                    onChange={e => setForm(prev => ({ ...prev, disposition: e.target.value }))}
                    placeholder="e.g. Guilty, Dismissed, Pending"
                    className="input-dark w-full text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Disposition Date</label>
                  <input
                    type="date"
                    value={form.disposition_date}
                    onChange={e => setForm(prev => ({ ...prev, disposition_date: e.target.value }))}
                    className="input-dark w-full text-xs mt-0.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Sentence</label>
                  <input
                    type="text"
                    value={form.sentence}
                    onChange={e => setForm(prev => ({ ...prev, sentence: e.target.value }))}
                    placeholder="e.g. 6 months probation, 30 days jail"
                    className="input-dark w-full text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-bold">Source</label>
                  <input
                    type="text"
                    value={form.source}
                    onChange={e => setForm(prev => ({ ...prev, source: e.target.value }))}
                    placeholder="e.g. NCIC, Court Records, Self-reported"
                    className="input-dark w-full text-xs mt-0.5"
                  />
                </div>
              </div>

              <div>
                <label className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label>
                <RichTextArea
                  value={form.notes}
                  onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                  className="input-dark w-full text-xs mt-0.5"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="toolbar-btn text-[10px]">Cancel</button>
                <button type="button"
                  onClick={handleSave}
                  disabled={saving || !form.offense.trim()}
                  className="toolbar-btn toolbar-btn-primary text-[10px]"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  {editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
              <span className="text-[11px] text-rmpg-400">Loading criminal history...</span>
            </div>
          )}

          {/* Records List */}
          {!loading && records.length === 0 && !showForm && (
            <p className="text-[11px] text-rmpg-500 py-1">No criminal history records on file</p>
          )}

          {!loading && records.length > 0 && (
            <div className="space-y-1">
              {records.map(rec => (
                <div
                  key={rec.id}
                  className={`flex flex-col gap-0.5 px-2 py-1.5 border text-xs ${
                    rec.offense_level === 'felony'
                      ? 'bg-red-950/30 border-red-800/50'
                      : 'bg-surface-raised border-rmpg-700'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase border panel-beveled ${
                        RECORD_TYPE_CLASSES[rec.record_type] || RECORD_TYPE_CLASSES.other
                      }`}
                    >
                      {rec.record_type.replace(/_/g, ' ')}
                    </span>
                    {rec.offense_level && (
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase border panel-beveled ${
                          OFFENSE_LEVEL_CLASSES[rec.offense_level] || OFFENSE_LEVEL_CLASSES.unknown
                        }`}
                      >
                        {toDisplayLabel(rec.offense_level)}
                      </span>
                    )}
                    <span className="text-white font-semibold text-[11px] flex-1">{rec.offense}</span>
                    <span className="text-rmpg-400 text-[10px]">{formatDate(rec.offense_date)}</span>
                    <button type="button" onClick={() => handleEdit(rec)} className="p-0.5 text-rmpg-400 hover:text-brand-400" title="Edit">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => handleDelete(rec.id)} className="p-0.5 text-rmpg-400 hover:text-red-400" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-rmpg-500 flex-wrap">
                    {rec.statute && <span className="font-mono">{rec.statute}</span>}
                    {rec.case_number && <span>Case: {rec.case_number}</span>}
                    {rec.agency && <span>{rec.agency}</span>}
                    {rec.jurisdiction && <span>{rec.jurisdiction}</span>}
                  </div>
                  {(rec.disposition || rec.sentence) && (
                    <div className="flex items-center gap-3 text-[10px] text-rmpg-400">
                      {rec.disposition && (
                        <span>
                          <span className="text-rmpg-500">Disp:</span>{' '}
                          <span className={rec.disposition.toLowerCase().includes('guilty') || rec.disposition.toLowerCase().includes('convicted') ? 'text-red-400 font-semibold' : rec.disposition.toLowerCase().includes('dismiss') ? 'text-green-400' : ''}>
                            {(rec.disposition || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                          </span>
                          {rec.disposition_date && <span className="text-rmpg-500 ml-1">({formatDate(rec.disposition_date)})</span>}
                        </span>
                      )}
                      {rec.sentence && <span><span className="text-rmpg-500">Sentence:</span> {rec.sentence}</span>}
                    </div>
                  )}
                  {rec.source && (
                    <div className="text-[9px] text-rmpg-600">Source: {rec.source}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
