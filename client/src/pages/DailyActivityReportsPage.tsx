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
  Zap, Calendar, RefreshCw,
} from 'lucide-react';
import type { DailyActivityReport, DARStatus } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import ExportButton from '../components/ExportButton';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  submitted: 'bg-gray-900/50 text-gray-400 border-gray-700/50',
  approved: 'bg-green-900/50 text-green-400 border-green-700/50',
  returned: 'bg-red-900/50 text-red-400 border-red-700/50',
  archived: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function DailyActivityReportsPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { addToast } = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isGodMode = user?.role === 'admin'; // Admin God Mode — unrestricted access

  const [dars, setDars] = useState<DailyActivityReport[]>([]);
  const [selected, setSelected] = useState<DailyActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // New DAR form
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [newDarDate, setNewDarDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
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

  // Document title
  useEffect(() => { document.title = 'Daily Activity Reports \u2014 RMPG Flex'; }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') { setCreateFormOpen(false); setSelected(null); }
      if (e.key === 'n' || e.key === 'N') { setCreateFormOpen(true); setAutoPopulateData(null); }
      if (e.key === 'r' || e.key === 'R') { fetchDars({ silent: true }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const fetchDars = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFetchError('');
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
    } catch (err: any) { setFetchError(err?.message || 'Failed to load data'); } finally { setLoading(false); }
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
        body.calls_handled = JSON.stringify(autoPopulateData.calls || []);
        body.incidents_created = JSON.stringify(autoPopulateData.incidents || []);
        body.citations_issued = JSON.stringify(autoPopulateData.citations || []);
        body.patrols_completed = JSON.stringify(autoPopulateData.patrols || []);
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
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''} bg-surface-base`}>
      {fetchError && (
        <div className="absolute left-0 right-0 z-10 mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2 shadow-lg">
          <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
          <span className="flex-1">{fetchError}</span>
          <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300 text-[10px]">Dismiss</button>
        </div>
      )}
      {/* ── Left Panel ── */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[380px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Daily Activity Reports" icon={ClipboardCheck}>
          <ExportButton exportUrl="/api/dar/export/csv" exportFilename="daily_activity_reports_export.csv" />
          <IconButton onClick={() => fetchDars({ silent: true })} className="toolbar-btn print:hidden" title="Refresh (R)" aria-label="Refresh">
            <RefreshCw style={{ width: 11, height: 11 }} />
          </IconButton>
          <button type="button" onClick={() => { setCreateFormOpen(true); setAutoPopulateData(null); }} className="toolbar-btn toolbar-btn-primary print:hidden">
            <Plus style={{ width: 11, height: 11 }} /> New
          </button>
          <span className="text-[9px] font-mono text-rmpg-500 bg-rmpg-800 px-1.5 py-0.5 rounded-sm">{totalCount}</span>
        </PanelTitleBar>

        {/* Filters */}
        <div className="flex gap-1.5 p-1.5 border-b border-rmpg-700 bg-surface-sunken">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
            <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }} placeholder="Search DARs..." aria-label="Search DARs..." className="w-full pl-7 pr-2 py-1.5 text-xs bg-surface-base border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 outline-none transition-colors" />
          </div>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} className="text-[10px] bg-surface-base border border-rmpg-700 text-rmpg-300 px-2 outline-none focus:border-brand-600 transition-colors">
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="returned">Returned</option>
          </select>
        </div>

        {/* DAR List */}
        <div className="flex-1 overflow-y-auto scrollbar-dark" role="list" aria-label="Daily activity reports">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading daily activity reports" /><span className="text-[10px] text-rmpg-500">Loading...</span></div>
          ) : dars.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-rmpg-500" role="status">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                <ClipboardCheck className="w-7 h-7 text-rmpg-600" />
              </div>
              <p className="text-sm font-medium text-rmpg-400">No DARs found</p>
              <p className="text-[10px] text-rmpg-600 mt-1">Try adjusting your filters or create a new one</p>
            </div>
          ) : (
            dars.map(dar => (
              <button type="button"
                key={dar.id}
                role="listitem"
                onClick={() => { setSelected(dar); setEditing(false); }}
                className={`w-full text-left px-3 py-2.5 border-b border-rmpg-800 transition-all duration-150 ${
                  selected?.id === dar.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500 shadow-sm' : 'hover:bg-rmpg-800/40 hover:shadow-sm border-l-2 border-l-transparent'
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
                  {dar.shift_date ? new Date(dar.shift_date).toLocaleDateString() : '—'}
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
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-sunken">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-[10px] text-rmpg-400 hover:text-white disabled:opacity-30 disabled:hover:text-rmpg-400 transition-colors">← Prev</button>
            <span className="text-[9px] font-mono text-rmpg-500 tabular-nums">Page {page}/{totalPages}</span>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="text-[10px] text-rmpg-400 hover:text-white disabled:opacity-30 disabled:hover:text-rmpg-400 transition-colors">Next →</button>
          </div>
        )}
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`${selected.dar_number} — ${selected.shift_date ? new Date(selected.shift_date).toLocaleDateString() : ''}`} icon={ClipboardCheck}>
              {(selected.status === 'draft' || isGodMode) && (
                <button type="button" onClick={handleSubmit} className="toolbar-btn toolbar-btn-primary print:hidden">
                  <Send style={{ width: 11, height: 11 }} /> Submit
                </button>
              )}
              {(isGodMode || (selected.status === 'submitted' && isAdmin)) && (
                <>
                  <button type="button" onClick={handleApprove} className="toolbar-btn" style={{ color: '#22c55e' }}>
                    <CheckCircle style={{ width: 11, height: 11 }} /> Approve
                  </button>
                  <button type="button" onClick={handleReturn} className="toolbar-btn" style={{ color: '#ef4444' }}>
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
                  ['Calls', parseJson(selected.calls_handled).length, 'text-gray-400'],
                  ['Incidents', parseJson(selected.incidents_created).length, 'text-red-400'],
                  ['Citations', parseJson(selected.citations_issued).length, 'text-amber-400'],
                  ['Patrols', parseJson(selected.patrols_completed).length, 'text-green-400'],
                ].map(([label, count, color]) => (
                  <div key={label as string} className="panel-beveled p-2.5 text-center hover:bg-surface-raised/30 transition-colors">
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider">{label}</div>
                    <div className={`text-lg font-bold font-mono tabular-nums ${color}`}>{count}</div>
                  </div>
                ))}
              </div>

              {/* Shift Info */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div><div className="text-[9px] font-mono text-rmpg-500">Shift Date</div><div className="text-xs text-white">{selected.shift_date ? new Date(selected.shift_date).toLocaleDateString() : '—'}</div></div>
                <div><div className="text-[9px] font-mono text-rmpg-500">Start</div><div className="text-xs text-white">{selected.shift_start || '—'}</div></div>
                <div><div className="text-[9px] font-mono text-rmpg-500">End</div><div className="text-xs text-white">{selected.shift_end || '—'}</div></div>
                <div><div className="text-[9px] font-mono text-rmpg-500">Total Hours</div><div className="text-xs font-bold text-brand-400">{(() => {
                  if (!selected.shift_start || !selected.shift_end) return '—';
                  const [sh, sm] = selected.shift_start.split(':').map(Number);
                  const [eh, em] = selected.shift_end.split(':').map(Number);
                  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return '—';
                  let diff = (eh * 60 + em) - (sh * 60 + sm);
                  if (diff < 0) diff += 24 * 60; // overnight shift
                  const hrs = Math.floor(diff / 60);
                  const mins = diff % 60;
                  return `${hrs}h ${mins > 0 ? `${mins}m` : ''}`;
                })()}</div></div>
              </div>

              {/* Narrative Section */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-mono text-rmpg-500 uppercase">Narrative / Summary</span>
                  {(selected.status === 'draft' || selected.status === 'returned') && (
                    <button type="button"
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
                      <label htmlFor="dar-narrative" className="text-[9px] text-rmpg-500">Narrative</label>
                      <p className="text-[8px] text-rmpg-600 mb-0.5">Describe all activities during this shift</p>
                      <textarea id="dar-narrative" value={editNarrative} onChange={e => setEditNarrative(e.target.value)} rows={5} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 transition-colors" />
                    </div>
                    <div>
                      <label htmlFor="dar-highlights" className="text-[9px] text-rmpg-500">Highlights</label>
                      <textarea id="dar-highlights" value={editHighlights} onChange={e => setEditHighlights(e.target.value)} rows={2} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 transition-colors" />
                    </div>
                    <div>
                      <label htmlFor="dar-issues" className="text-[9px] text-rmpg-500">Issues Encountered</label>
                      <textarea id="dar-issues" value={editIssues} onChange={e => setEditIssues(e.target.value)} rows={2} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 transition-colors" />
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
              <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                <ClipboardCheck className="w-7 h-7 text-rmpg-600" />
              </div>
              <div className="text-sm font-medium text-rmpg-400">Select a DAR to view details</div>
              <div className="text-[10px] text-rmpg-600 mt-1">or create a new one with the + New button</div>
            </div>
          </div>
        )}
      </div>

      {/* ── New DAR Modal ── */}
      {createFormOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setCreateFormOpen(false)}>
          <div className="panel-surface w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <PanelTitleBar title="New Daily Activity Report" icon={Plus}>
              <IconButton onClick={() => setCreateFormOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="dar-shift-date" className="field-label">Shift Date *</label>
                <input id="dar-shift-date" type="date" value={newDarDate} onChange={e => setNewDarDate(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none min-h-[44px]" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="dar-shift-start" className="field-label">Shift Start</label>
                  <input id="dar-shift-start" type="time" value={newDarShiftStart} onChange={e => setNewDarShiftStart(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none min-h-[44px]" />
                </div>
                <div>
                  <label htmlFor="dar-shift-end" className="field-label">Shift End</label>
                  <input id="dar-shift-end" type="time" value={newDarShiftEnd} onChange={e => setNewDarShiftEnd(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none min-h-[44px]" />
                </div>
              </div>

              {/* Auto-populate button */}
              <button type="button" onClick={handleAutoPopulate} disabled={autoPopLoading} className="w-full toolbar-btn justify-center py-2">
                {autoPopLoading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Zap style={{ width: 12, height: 12 }} />}
                Auto-Populate from System Data
              </button>

              {autoPopulateData && (
                <div className="panel-beveled p-3 border-l-2 border-l-green-500">
                  <div className="text-[9px] font-mono text-green-400 mb-2 flex items-center gap-1">
                    <CheckCircle style={{ width: 10, height: 10 }} /> Shift Stats Auto-Populated
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Calls Handled', data: autoPopulateData.calls || [], color: 'text-gray-400' },
                      { label: 'Incidents Created', data: autoPopulateData.incidents || [], color: 'text-red-400' },
                      { label: 'Citations Issued', data: autoPopulateData.citations || [], color: 'text-amber-400' },
                      { label: 'Patrols Completed', data: autoPopulateData.patrols || [], color: 'text-green-400' },
                    ].map(item => (
                      <div key={item.label} className="panel-beveled p-2">
                        <div className="text-[8px] text-rmpg-500 uppercase">{item.label}</div>
                        <div className={`text-lg font-bold font-mono ${item.color}`}>{item.data.length}</div>
                      </div>
                    ))}
                  </div>
                  {autoPopulateData.miles_patrolled != null && (
                    <div className="mt-2 text-[10px] text-rmpg-300">
                      Miles Patrolled: <span className="text-white font-bold">{autoPopulateData.miles_patrolled || 0}</span>
                    </div>
                  )}
                  {autoPopulateData.arrests != null && (
                    <div className="text-[10px] text-rmpg-300">
                      Arrests: <span className="text-white font-bold">{(autoPopulateData.arrests || []).length}</span>
                    </div>
                  )}
                  <div className="text-[8px] text-rmpg-500 mt-1">Values can be edited after creation</div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setCreateFormOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleCreate} disabled={submitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
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
