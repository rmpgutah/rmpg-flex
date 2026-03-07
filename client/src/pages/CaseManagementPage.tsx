// ============================================================
// RMPG Flex — Case Management Page
// ============================================================
// Investigative case tracking with solvability scoring,
// investigator assignment, case notes, and linked records.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, Search, Plus, ChevronDown, User, Clock, FileText,
  X, Save, Loader2, AlertTriangle, Target, MessageSquare,
  ArrowRight, CheckCircle, Pause, Hash, FolderOpen,
} from 'lucide-react';
import type { Case, CaseNote, CaseStatus, CaseType, CasePriority } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
// ExportButton omitted — no dedicated export endpoint
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';

const STATUS_OPTIONS: { value: CaseStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: 'bg-blue-900/50 text-blue-400 border-blue-700/50' },
  { value: 'assigned', label: 'Assigned', color: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50' },
  { value: 'active', label: 'Active', color: 'bg-green-900/50 text-green-400 border-green-700/50' },
  { value: 'suspended', label: 'Suspended', color: 'bg-amber-900/50 text-amber-400 border-amber-700/50' },
  { value: 'closed_cleared', label: 'Closed (Cleared)', color: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50' },
  { value: 'closed_unfounded', label: 'Closed (Unfounded)', color: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50' },
  { value: 'closed_exception', label: 'Closed (Exception)', color: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50' },
];

const TYPE_OPTIONS: { value: CaseType; label: string }[] = [
  { value: 'general', label: 'General' }, { value: 'theft', label: 'Theft' },
  { value: 'assault', label: 'Assault' }, { value: 'fraud', label: 'Fraud' },
  { value: 'narcotics', label: 'Narcotics' }, { value: 'missing_person', label: 'Missing Person' },
  { value: 'other', label: 'Other' },
];

const PRIORITY_OPTIONS: { value: CasePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-rmpg-400' },
  { value: 'normal', label: 'Normal', color: 'text-blue-400' },
  { value: 'high', label: 'High', color: 'text-amber-400' },
  { value: 'critical', label: 'Critical', color: 'text-red-400' },
];

const SOLVABILITY_FACTORS = [
  { key: 'witness_available', label: 'Witness Available', weight: 15 },
  { key: 'physical_evidence', label: 'Physical Evidence', weight: 20 },
  { key: 'suspect_named', label: 'Suspect Named', weight: 25 },
  { key: 'suspect_described', label: 'Suspect Described', weight: 10 },
  { key: 'suspect_vehicle', label: 'Suspect Vehicle Known', weight: 10 },
  { key: 'video_available', label: 'Video Available', weight: 10 },
  { key: 'traceable_property', label: 'Traceable Property', weight: 5 },
  { key: 'significant_modus', label: 'Significant MO', weight: 5 },
];

const EMPTY_FORM = {
  title: '', case_type: 'general' as CaseType, priority: 'normal' as CasePriority,
  summary: '', lead_investigator_id: '',
};

export default function CaseManagementPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();

  const [cases, setCases] = useState<Case[]>([]);
  const [selected, setSelected] = useState<Case | null>(null);
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  // Detail tab
  const [detailTab, setDetailTab] = useState<'detail' | 'notes' | 'solvability'>('detail');
  const [newNote, setNewNote] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  // Solvability
  const [solvFactors, setSolvFactors] = useState<Record<string, boolean>>({});
  const [solvSubmitting, setSolvSubmitting] = useState(false);

  // Status change
  const [statusChanging, setStatusChanging] = useState(false);

  const fetchCases = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterType ? { case_type: filterType } : {}),
        ...(filterPriority ? { priority: filterPriority } : {}),
      });
      const res = await apiFetch<{ data: Case[]; pagination: any }>(`/cases?${params}`);
      setCases(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [page, searchQuery, filterStatus, filterType, filterPriority]);

  const fetchStats = useCallback(async () => {
    try { const res = await apiFetch<{ data: any }>('/cases/stats'); setStats(res.data); } catch {}
  }, []);

  const fetchNotes = useCallback(async (caseId: number) => {
    try { const res = await apiFetch<{ data: CaseNote[] }>(`/cases/${caseId}/notes`); setNotes(res.data || []); } catch {}
  }, []);

  useEffect(() => { fetchCases(); }, [fetchCases]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    apiFetch<{ data: any[] }>('/personnel?per_page=200').then(r => setUsers(r.data || [])).catch(() => {});
  }, []);
  useLiveSync('records', () => { fetchCases({ silent: true }); fetchStats(); });

  useEffect(() => {
    if (selected) {
      fetchNotes(selected.id);
      const factors = selected.solvability_factors
        ? (typeof selected.solvability_factors === 'string' ? JSON.parse(selected.solvability_factors) : selected.solvability_factors)
        : {};
      setSolvFactors(factors);
    }
  }, [selected, fetchNotes]);

  const handleCreate = async () => {
    if (!formData.title.trim()) { addToast('Title is required', 'error'); return; }
    setSubmitting(true);
    try {
      await apiFetch('/cases', { method: 'POST', body: JSON.stringify(formData) });
      addToast('Case created', 'success');
      setFormOpen(false);
      setFormData({ ...EMPTY_FORM });
      fetchCases({ silent: true });
      fetchStats();
    } catch (err: any) { addToast(err.message || 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleAddNote = async () => {
    if (!selected || !newNote.trim()) return;
    setNoteSubmitting(true);
    try {
      await apiFetch(`/cases/${selected.id}/notes`, { method: 'POST', body: JSON.stringify({ content: newNote }) });
      setNewNote('');
      fetchNotes(selected.id);
      addToast('Note added', 'success');
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setNoteSubmitting(false); }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selected) return;
    setStatusChanging(true);
    try {
      await apiFetch(`/cases/${selected.id}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
      addToast(`Case status → ${newStatus.replace(/_/g, ' ')}`, 'success');
      const updated = await apiFetch<{ data: Case }>(`/cases/${selected.id}`);
      setSelected(updated.data);
      fetchCases({ silent: true });
      fetchStats();
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setStatusChanging(false); }
  };

  const handleCalculateSolvability = async () => {
    if (!selected) return;
    setSolvSubmitting(true);
    try {
      const res = await apiFetch<{ data: { score: number } }>(`/cases/${selected.id}/calculate-solvability`, {
        method: 'POST', body: JSON.stringify({ factors: solvFactors }),
      });
      addToast(`Solvability score: ${res.data.score}/100`, 'success');
      const updated = await apiFetch<{ data: Case }>(`/cases/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setSolvSubmitting(false); }
  };

  const getStatusColor = (status: string) => STATUS_OPTIONS.find(s => s.value === status)?.color || '';
  const getPriorityColor = (priority: string) => PRIORITY_OPTIONS.find(p => p.value === priority)?.color || '';

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left: Case List ── */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[400px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Case Management" icon={Briefcase}>
          <button onClick={() => { setFormOpen(true); setFormData({ ...EMPTY_FORM }); }} className="toolbar-btn toolbar-btn-primary">
            <Plus style={{ width: 11, height: 11 }} /> New
          </button>
          <span className="text-[9px] font-mono text-rmpg-500">{totalCount}</span>
        </PanelTitleBar>

        {/* Stats */}
        {stats && (
          <div className="flex gap-2 px-2 py-1.5 border-b border-rmpg-700 bg-surface-sunken overflow-x-auto">
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">TOTAL</div>
              <div className="text-sm font-bold text-white">{stats.total || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">ACTIVE</div>
              <div className="text-sm font-bold text-green-400">{(stats.by_status?.open || 0) + (stats.by_status?.active || 0) + (stats.by_status?.assigned || 0)}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">SOLVABILITY</div>
              <div className="text-sm font-bold text-amber-400">{stats.avg_solvability || 0}%</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-1 p-1.5 border-b border-rmpg-700 bg-surface-base">
          <div className="flex-1 min-w-[120px] relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
            <input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search cases..."
              className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 outline-none"
            />
          </div>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1 outline-none">
            <option value="">All Status</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1 outline-none">
            <option value="">All Types</option>
            {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {/* Case List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>
          ) : cases.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No cases found"
              description="Create a new case to get started."
              action={{ label: 'New Case', onClick: () => { setFormOpen(true); setFormData({ ...EMPTY_FORM }); } }}
            />
          ) : (
            cases.map(c => (
              <button
                key={c.id}
                onClick={() => { setSelected(c); setDetailTab('detail'); }}
                className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-colors ${
                  selected?.id === c.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-white">{c.case_number}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${getStatusColor(c.status)}`}>
                    {c.status.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{c.title}</div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  <span className={`font-bold ${getPriorityColor(c.priority)}`}>{c.priority.toUpperCase()}</span>
                  <span>{TYPE_OPTIONS.find(t => t.value === c.case_type)?.label || c.case_type}</span>
                  {c.solvability_score != null && (
                    <span className="flex items-center gap-0.5">
                      <Target style={{ width: 9, height: 9 }} />
                      {c.solvability_score}%
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-base">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-[10px] text-rmpg-400 disabled:opacity-30">← Prev</button>
            <span className="text-[9px] font-mono text-rmpg-500">Page {page}/{totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="text-[10px] text-rmpg-400 disabled:opacity-30">Next →</button>
          </div>
        )}
      </div>

      {/* ── Right: Detail ── */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`${selected.case_number} — ${selected.title}`} icon={Briefcase}>
            </PanelTitleBar>

            {/* Tabs */}
            <div className="flex border-b border-rmpg-700">
              {(['detail', 'notes', 'solvability'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    detailTab === tab ? 'text-white border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  {tab === 'detail' ? 'Details' : tab === 'notes' ? `Notes (${notes.length})` : 'Solvability'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {detailTab === 'detail' && (
                <div className="space-y-4">
                  {/* Status + Priority badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-1 border font-bold ${getStatusColor(selected.status)}`}>
                      {selected.status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <span className={`text-[10px] px-2 py-1 border bg-rmpg-700/30 border-rmpg-600/50 font-bold ${getPriorityColor(selected.priority)}`}>
                      {selected.priority.toUpperCase()}
                    </span>
                    {selected.solvability_score != null && (
                      <span className="text-[10px] px-2 py-1 border bg-amber-900/30 text-amber-400 border-amber-700/50 font-bold">
                        SOLVABILITY: {selected.solvability_score}%
                      </span>
                    )}
                  </div>

                  {/* Status change */}
                  <div className="panel-beveled p-3">
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2">Change Status</div>
                    <div className="flex flex-wrap gap-1">
                      {STATUS_OPTIONS.filter(s => s.value !== selected.status).map(s => (
                        <button
                          key={s.value}
                          onClick={() => handleStatusChange(s.value)}
                          disabled={statusChanging}
                          className="text-[10px] px-2 py-1 border border-rmpg-600 text-rmpg-300 hover:bg-rmpg-700/40 transition-colors"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Detail grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      ['Case Number', selected.case_number],
                      ['Type', TYPE_OPTIONS.find(t => t.value === selected.case_type)?.label],
                      ['Lead Investigator', selected.lead_investigator_name || '—'],
                      ['Opened', selected.opened_date ? new Date(selected.opened_date).toLocaleDateString() : '—'],
                      ['Due Date', selected.due_date ? new Date(selected.due_date).toLocaleDateString() : '—'],
                      ['Closed', selected.closed_date ? new Date(selected.closed_date).toLocaleDateString() : '—'],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                        <div className="text-xs text-white mt-0.5">{value || '—'}</div>
                      </div>
                    ))}
                  </div>

                  {selected.summary && (
                    <div className="panel-beveled p-3">
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1">Summary</div>
                      <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selected.summary}</div>
                    </div>
                  )}
                  {selected.narrative && (
                    <div className="panel-beveled p-3">
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1">Narrative</div>
                      <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selected.narrative}</div>
                    </div>
                  )}
                </div>
              )}

              {detailTab === 'notes' && (
                <div className="space-y-3">
                  {/* Add note */}
                  <div className="panel-beveled p-3">
                    <textarea
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      placeholder="Add a case note..."
                      rows={3}
                      className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 outline-none resize-none"
                    />
                    <div className="flex justify-end mt-2">
                      <button onClick={handleAddNote} disabled={noteSubmitting || !newNote.trim()} className="toolbar-btn toolbar-btn-primary">
                        {noteSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare style={{ width: 11, height: 11 }} />}
                        Add Note
                      </button>
                    </div>
                  </div>

                  {notes.map(note => (
                    <div key={note.id} className="panel-beveled p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-white">{note.author_name || 'Unknown'}</span>
                        <span className="text-[9px] font-mono text-rmpg-500">
                          {note.created_at ? new Date(note.created_at).toLocaleString() : ''}
                        </span>
                      </div>
                      <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{note.content}</div>
                    </div>
                  ))}
                  {notes.length === 0 && <div className="text-center py-6 text-rmpg-500 text-xs">No notes yet</div>}
                </div>
              )}

              {detailTab === 'solvability' && (
                <div className="space-y-4">
                  <div className="panel-beveled p-4">
                    <div className="text-[10px] font-mono text-rmpg-500 uppercase mb-3">Solvability Factors</div>
                    <div className="space-y-2">
                      {SOLVABILITY_FACTORS.map(f => (
                        <label key={f.key} className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!solvFactors[f.key]}
                            onChange={e => setSolvFactors(prev => ({ ...prev, [f.key]: e.target.checked }))}
                            className="accent-brand-500"
                          />
                          <span className="text-xs text-white flex-1">{f.label}</span>
                          <span className="text-[9px] font-mono text-rmpg-500">+{f.weight}pts</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-rmpg-700">
                      <span className="text-xs text-rmpg-400">
                        Projected: <span className="font-bold text-amber-400">
                          {SOLVABILITY_FACTORS.reduce((sum, f) => sum + (solvFactors[f.key] ? f.weight : 0), 0)}/100
                        </span>
                      </span>
                      <button onClick={handleCalculateSolvability} disabled={solvSubmitting} className="toolbar-btn toolbar-btn-primary">
                        {solvSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target style={{ width: 11, height: 11 }} />}
                        Calculate & Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Briefcase className="w-10 h-10 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500">Select a case to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* ── New Case Modal ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel-surface w-full max-w-lg mx-4">
            <PanelTitleBar title="New Case" icon={Plus}>
              <button onClick={() => setFormOpen(false)} className="toolbar-btn"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Title *</label>
                <input value={formData.title} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="field-label">Type</label>
                  <select value={formData.case_type} onChange={e => setFormData(p => ({ ...p, case_type: e.target.value as CaseType }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Priority</label>
                  <select value={formData.priority} onChange={e => setFormData(p => ({ ...p, priority: e.target.value as CasePriority }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Lead Investigator</label>
                  <select value={formData.lead_investigator_id} onChange={e => setFormData(p => ({ ...p, lead_investigator_id: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    <option value="">Unassigned</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">Summary</label>
                <textarea value={formData.summary} onChange={e => setFormData(p => ({ ...p, summary: e.target.value }))} rows={3} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button onClick={() => setFormOpen(false)} className="toolbar-btn">Cancel</button>
                <button onClick={handleCreate} disabled={submitting} className="toolbar-btn toolbar-btn-primary">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create Case
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
