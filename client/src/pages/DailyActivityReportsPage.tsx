// ============================================================
// RMPG Flex — Daily Activity Reports (DAR) Page
// ============================================================
// Structured shift reports with auto-populate from calls,
// incidents, citations, and patrol scans. Supports draft →
// submit → approve/return supervisor workflow.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, Search, Plus, Clock, User, FileText,
  X, Save, Loader2, CheckCircle, AlertTriangle, Send, RotateCcw,
  Zap, Calendar,
} from 'lucide-react';
import type { DailyActivityReport, DARStatus } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
// ExportButton omitted — no dedicated export endpoint
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  submitted: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  approved: 'bg-green-900/50 text-green-400 border-green-700/50',
  returned: 'bg-red-900/50 text-red-400 border-red-700/50',
  archived: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

export default function DailyActivityReportsPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { addToast } = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const [dars, setDars] = useState<DailyActivityReport[]>([]);
  const [selected, setSelected] = useState<DailyActivityReport | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // New DAR form
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [newDarDate, setNewDarDate] = useState(new Date().toISOString().slice(0, 10));
  const [newDarShiftStart, setNewDarShiftStart] = useState('');
  const [newDarShiftEnd, setNewDarShiftEnd] = useState('');
  const [autoPopulateData, setAutoPopulateData] = useState<any>(null);
  const [autoPopLoading, setAutoPopLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Edit mode for narrative
  const [editing, setEditing] = useState(false);
  const [editNarrative, setEditNarrative] = useState('');
  const [editHighlights, setEditHighlights] = useState('');
  const [editIssues, setEditIssues] = useState('');

  const fetchDars = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
      });
      const res = await apiFetch<{ data: DailyActivityReport[]; pagination: any }>(`/dar?${params}`);
      setDars(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [page, searchQuery, filterStatus]);

  useEffect(() => { fetchDars(); }, [fetchDars]);
  useLiveSync('admin', () => fetchDars({ silent: true }));

  const handleAutoPopulate = async () => {
    setAutoPopLoading(true);
    try {
      const res = await apiFetch<{ data: any }>('/dar/auto-populate', {
        method: 'POST',
        body: JSON.stringify({
          officer_id: user?.id,
          shift_date: newDarDate,
        }),
      });
      setAutoPopulateData(res.data);
      addToast('Activity data populated', 'success');
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setAutoPopLoading(false); }
  };

  const handleCreate = async () => {
    if (!newDarDate) { addToast('Shift date required', 'error'); return; }
    setSubmitting(true);
    try {
      const body: any = {
        shift_date: newDarDate,
        shift_start: newDarShiftStart || undefined,
        shift_end: newDarShiftEnd || undefined,
      };
      // Include auto-populated data if available
      if (autoPopulateData) {
        body.calls_handled = JSON.stringify(autoPopulateData.calls_handled || []);
        body.incidents_created = JSON.stringify(autoPopulateData.incidents_created || []);
        body.citations_issued = JSON.stringify(autoPopulateData.citations_issued || []);
        body.patrols_completed = JSON.stringify(autoPopulateData.patrols_completed || []);
      }
      await apiFetch('/dar', { method: 'POST', body: JSON.stringify(body) });
      addToast('DAR created', 'success');
      setCreateFormOpen(false);
      setAutoPopulateData(null);
      fetchDars({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleSubmit = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/dar/${selected.id}/submit`, { method: 'PUT' });
      addToast('DAR submitted for review', 'success');
      const updated = await apiFetch<{ data: DailyActivityReport }>(`/dar/${selected.id}`);
      setSelected(updated.data);
      fetchDars({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
  };

  const handleApprove = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/dar/${selected.id}/approve`, { method: 'PUT' });
      addToast('DAR approved', 'success');
      const updated = await apiFetch<{ data: DailyActivityReport }>(`/dar/${selected.id}`);
      setSelected(updated.data);
      fetchDars({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
  };

  const handleReturn = async () => {
    const notes = prompt('Enter review notes (required):');
    if (!notes || !selected) return;
    try {
      await apiFetch(`/dar/${selected.id}/return`, { method: 'PUT', body: JSON.stringify({ review_notes: notes }) });
      addToast('DAR returned for revision', 'success');
      const updated = await apiFetch<{ data: DailyActivityReport }>(`/dar/${selected.id}`);
      setSelected(updated.data);
      fetchDars({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
  };

  const handleSaveNarrative = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/dar/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          activities_narrative: editNarrative,
          notable_events: editHighlights,
          safety_concerns: editIssues,
        }),
      });
      addToast('Narrative saved', 'success');
      setEditing(false);
      const updated = await apiFetch<{ data: DailyActivityReport }>(`/dar/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) { addToast(err.message, 'error'); }
  };

  const parseJson = (val: any) => {
    if (!val) return [];
    if (typeof val === 'string') try { return JSON.parse(val); } catch { return []; }
    return Array.isArray(val) ? val : [];
  };

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left Panel ── */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[380px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Daily Activity Reports" icon={ClipboardCheck}>
          <button onClick={() => { setCreateFormOpen(true); setAutoPopulateData(null); }} className="toolbar-btn toolbar-btn-primary">
            <Plus style={{ width: 11, height: 11 }} /> New
          </button>
          <span className="text-[9px] font-mono text-rmpg-500">{totalCount}</span>
        </PanelTitleBar>

        {/* Filters */}
        <div className="flex gap-1 p-1.5 border-b border-rmpg-700 bg-surface-base">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
            <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }} placeholder="Search DARs..." className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 outline-none" />
          </div>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="returned">Returned</option>
          </select>
        </div>

        {/* DAR List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>
          ) : dars.length === 0 ? (
            <div className="text-center py-8 text-rmpg-500 text-xs">No DARs found</div>
          ) : (
            dars.map(dar => (
              <button
                key={dar.id}
                onClick={() => { setSelected(dar); setEditing(false); }}
                className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-colors ${
                  selected?.id === dar.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-white">{dar.dar_number}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${STATUS_COLORS[dar.status] || ''}`}>
                    {dar.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  <Calendar style={{ width: 9, height: 9 }} />
                  {dar.shift_date ? new Date(dar.shift_date.includes('T') ? dar.shift_date : `${dar.shift_date}T00:00:00`).toLocaleDateString() : '—'}
                  {dar.officer_name && (
                    <span className="flex items-center gap-1">
                      <User style={{ width: 9, height: 9 }} />
                      {dar.officer_name}
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

      {/* ── Right Panel ── */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`${selected.dar_number} — ${selected.shift_date ? new Date(selected.shift_date.includes('T') ? selected.shift_date : `${selected.shift_date}T00:00:00`).toLocaleDateString() : ''}`} icon={ClipboardCheck}>
              {selected.status === 'draft' && (
                <button onClick={handleSubmit} className="toolbar-btn toolbar-btn-primary">
                  <Send style={{ width: 11, height: 11 }} /> Submit
                </button>
              )}
              {selected.status === 'submitted' && isAdmin && (
                <>
                  <button onClick={handleApprove} className="toolbar-btn" style={{ color: '#22c55e' }}>
                    <CheckCircle style={{ width: 11, height: 11 }} /> Approve
                  </button>
                  <button onClick={handleReturn} className="toolbar-btn" style={{ color: '#ef4444' }}>
                    <RotateCcw style={{ width: 11, height: 11 }} /> Return
                  </button>
                </>
              )}
            </PanelTitleBar>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Status + Info */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border font-bold ${STATUS_COLORS[selected.status] || ''}`}>
                  {selected.status.toUpperCase()}
                </span>
                {selected.officer_name && (
                  <span className="text-[10px] px-2 py-1 border bg-rmpg-700/30 text-rmpg-300 border-rmpg-600/50">
                    {selected.officer_name}
                  </span>
                )}
              </div>

              {/* Return notes */}
              {selected.status === 'returned' && selected.review_notes && (
                <div className="panel-beveled p-3 border-l-2 border-l-red-500">
                  <div className="text-[9px] font-mono text-red-400 uppercase mb-1">Supervisor Notes (Returned)</div>
                  <div className="text-xs text-rmpg-300">{selected.review_notes}</div>
                </div>
              )}

              {/* Auto-populated counts */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ['Calls', parseJson(selected.calls_handled).length, 'text-blue-400'],
                  ['Incidents', parseJson(selected.incidents_created).length, 'text-red-400'],
                  ['Citations', parseJson(selected.citations_issued).length, 'text-amber-400'],
                  ['Patrols', parseJson(selected.patrols_completed).length, 'text-green-400'],
                ].map(([label, count, color]) => (
                  <div key={label as string} className="panel-beveled p-2 text-center">
                    <div className="text-[9px] font-mono text-rmpg-500">{label}</div>
                    <div className={`text-lg font-bold ${color}`}>{count}</div>
                  </div>
                ))}
              </div>

              {/* Shift Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><div className="text-[9px] font-mono text-rmpg-500">Shift Date</div><div className="text-xs text-white">{selected.shift_date ? new Date(selected.shift_date.includes('T') ? selected.shift_date : `${selected.shift_date}T00:00:00`).toLocaleDateString() : '—'}</div></div>
                <div><div className="text-[9px] font-mono text-rmpg-500">Start</div><div className="text-xs text-white">{selected.shift_start || '—'}</div></div>
                <div><div className="text-[9px] font-mono text-rmpg-500">End</div><div className="text-xs text-white">{selected.shift_end || '—'}</div></div>
              </div>

              {/* Narrative Section */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-mono text-rmpg-500 uppercase">Narrative / Summary</span>
                  {(selected.status === 'draft' || selected.status === 'returned') && (
                    <button
                      onClick={() => {
                        if (editing) handleSaveNarrative();
                        else {
                          setEditNarrative(selected.activities_narrative || '');
                          setEditHighlights(selected.notable_events || '');
                          setEditIssues(selected.safety_concerns || '');
                          setEditing(true);
                        }
                      }}
                      className="toolbar-btn"
                    >
                      {editing ? <><Save style={{ width: 10, height: 10 }} /> Save</> : 'Edit'}
                    </button>
                  )}
                </div>
                {editing ? (
                  <div className="space-y-2">
                    <div>
                      <label className="text-[9px] text-rmpg-500">Narrative</label>
                      <textarea value={editNarrative} onChange={e => setEditNarrative(e.target.value)} rows={5} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none" />
                    </div>
                    <div>
                      <label className="text-[9px] text-rmpg-500">Highlights</label>
                      <textarea value={editHighlights} onChange={e => setEditHighlights(e.target.value)} rows={2} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none" />
                    </div>
                    <div>
                      <label className="text-[9px] text-rmpg-500">Issues Encountered</label>
                      <textarea value={editIssues} onChange={e => setEditIssues(e.target.value)} rows={2} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none" />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-rmpg-300 whitespace-pre-wrap">
                    {selected.activities_narrative || 'No narrative yet — click Edit to add.'}
                    {selected.notable_events && (
                      <div className="mt-3 pt-2 border-t border-rmpg-700">
                        <span className="text-[9px] text-rmpg-500">Highlights: </span>{selected.notable_events}
                      </div>
                    )}
                    {selected.safety_concerns && (
                      <div className="mt-2">
                        <span className="text-[9px] text-rmpg-500">Issues: </span>{selected.safety_concerns}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <ClipboardCheck className="w-10 h-10 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500">Select a DAR to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* ── New DAR Modal ── */}
      {createFormOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="New Daily Activity Report" icon={Plus}>
              <button onClick={() => setCreateFormOpen(false)} className="toolbar-btn"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Shift Date *</label>
                <input type="date" value={newDarDate} onChange={e => setNewDarDate(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Shift Start</label>
                  <input type="time" value={newDarShiftStart} onChange={e => setNewDarShiftStart(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
                <div>
                  <label className="field-label">Shift End</label>
                  <input type="time" value={newDarShiftEnd} onChange={e => setNewDarShiftEnd(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
              </div>

              {/* Auto-populate button */}
              <button onClick={handleAutoPopulate} disabled={autoPopLoading} className="w-full toolbar-btn justify-center py-2">
                {autoPopLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap style={{ width: 12, height: 12 }} />}
                Auto-Populate from System Data
              </button>

              {autoPopulateData && (
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-green-400 mb-1">Data Populated:</div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-rmpg-300">
                    <span>Calls: {(autoPopulateData.calls || []).length}</span>
                    <span>Incidents: {(autoPopulateData.incidents || []).length}</span>
                    <span>Citations: {(autoPopulateData.citations || []).length}</span>
                    <span>Patrols: {(autoPopulateData.patrols || []).length}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button onClick={() => setCreateFormOpen(false)} className="toolbar-btn">Cancel</button>
                <button onClick={handleCreate} disabled={submitting} className="toolbar-btn toolbar-btn-primary">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create DAR
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
