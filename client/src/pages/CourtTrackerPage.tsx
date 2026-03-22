// ============================================================
// RMPG Flex — Court / Legal Tracker Page
// ============================================================
// Court event management with calendar, upcoming events,
// officer subpoena tracking, and outcome recording.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Gavel, Search, Plus, Calendar, Clock, User, MapPin,
  X, Save, Loader2, AlertTriangle, CheckCircle, FileText, Scale,
} from 'lucide-react';
import type { CourtEvent, CourtEventType, CourtEventStatus, CourtOutcome } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import EmptyState from '../components/EmptyState';
// ExportButton omitted — no dedicated export endpoint
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useFormValidation } from '../hooks/useFormValidation';
import { isValidDate } from '../utils/validate';
import { formatDate } from '../utils/dateUtils';

const EVENT_TYPES: { value: CourtEventType; label: string }[] = [
  { value: 'arraignment', label: 'Arraignment' }, { value: 'hearing', label: 'Hearing' },
  { value: 'trial', label: 'Trial' }, { value: 'sentencing', label: 'Sentencing' },
  { value: 'motion', label: 'Motion' }, { value: 'subpoena', label: 'Subpoena' },
  { value: 'continuance', label: 'Continuance' }, { value: 'disposition', label: 'Disposition' },
];

const EVENT_TYPE_COLORS: Record<string, string> = {
  arraignment: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  hearing: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50',
  trial: 'bg-red-900/50 text-red-400 border-red-700/50',
  sentencing: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  motion: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  subpoena: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
  continuance: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  disposition: 'bg-green-900/50 text-green-400 border-green-700/50',
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  confirmed: 'bg-green-900/50 text-green-400 border-green-700/50',
  continued: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  completed: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  cancelled: 'bg-red-900/50 text-red-400 border-red-700/50',
};

const OUTCOME_OPTIONS: { value: CourtOutcome; label: string }[] = [
  { value: 'guilty', label: 'Guilty' }, { value: 'not_guilty', label: 'Not Guilty' },
  { value: 'dismissed', label: 'Dismissed' }, { value: 'plea_deal', label: 'Plea Deal' },
  { value: 'deferred', label: 'Deferred' }, { value: 'continued', label: 'Continued' },
  { value: 'warrant_issued', label: 'Warrant Issued' },
];

const EMPTY_FORM = {
  event_type: 'hearing' as CourtEventType,
  event_date: '', event_time: '',
  court_name: '', courtroom: '', judge_name: '', court_case_number: '',
  defendant_name: '', defendant_dob: '',
  notes: '',
};

export default function CourtTrackerPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();

  const [activeView, setActiveView] = useState<'list' | 'upcoming'>('upcoming');
  const [events, setEvents] = useState<CourtEvent[]>([]);
  const [upcoming, setUpcoming] = useState<CourtEvent[]>([]);
  const [selected, setSelected] = useState<CourtEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  // Outcome modal
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcomeData, setOutcomeData] = useState({ outcome: '' as string, sentence: '', fine_amount: '' });
  const [outcomeSubmitting, setOutcomeSubmitting] = useState(false);

  // Create from citation
  const [citationSearchOpen, setCitationSearchOpen] = useState(false);
  const [citationSearchQ, setCitationSearchQ] = useState('');
  const [citationSearchResults, setCitationSearchResults] = useState<any[]>([]);
  const [citationSearching, setCitationSearching] = useState(false);
  const [creatingFromCitation, setCreatingFromCitation] = useState(false);

  const handleSearchCitations = async () => {
    if (!citationSearchQ || citationSearchQ.length < 2) return;
    setCitationSearching(true);
    try {
      const res = await apiFetch<{ data: any[] }>(`/citations/search?q=${encodeURIComponent(citationSearchQ)}`);
      setCitationSearchResults(res.data || []);
    } catch { setCitationSearchResults([]); }
    finally { setCitationSearching(false); }
  };

  const handleCreateFromCitation = async (citationId: number) => {
    setCreatingFromCitation(true);
    try {
      await apiFetch('/court/events/from-citation', {
        method: 'POST', body: JSON.stringify({ citation_id: citationId }),
      });
      addToast('Court event created from citation', 'success');
      setCitationSearchOpen(false);
      setCitationSearchQ('');
      setCitationSearchResults([]);
      fetchEvents({ silent: true }); fetchUpcoming();
    } catch (err: any) { addToast(err?.message || 'Failed to create event', 'error'); }
    finally { setCreatingFromCitation(false); }
  };

  const fetchEvents = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFetchError('');
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterType ? { event_type: filterType } : {}),
      });
      const res = await apiFetch<{ data: CourtEvent[]; pagination: any }>(`/court/events?${params}`);
      setEvents(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) { setFetchError(err?.message || 'Failed to load data'); } finally { setLoading(false); }
  }, [page, searchQuery, filterType]);

  const fetchUpcoming = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: CourtEvent[] }>('/court/events/upcoming');
      setUpcoming(res.data || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => { fetchUpcoming(); }, [fetchUpcoming]);
  useLiveSync('records', () => { fetchEvents({ silent: true }); fetchUpcoming(); });

  const handleCreate = async () => {
    const isValid = validateForm(formData, {
      event_date: { required: true, custom: isValidDate, customMessage: 'Valid date required (YYYY-MM-DD)' },
      court_name: { required: true, minLength: 2 },
    });
    if (!isValid) return;
    setSubmitting(true);
    try {
      await apiFetch('/court/events', { method: 'POST', body: JSON.stringify(formData) });
      addToast('Court event created', 'success');
      setFormOpen(false);
      setFormData({ ...EMPTY_FORM });
      fetchEvents({ silent: true }); fetchUpcoming();
    } catch (err: any) { addToast(err?.message || 'Operation failed', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleOutcome = async () => {
    if (!selected || !outcomeData.outcome) return;
    setOutcomeSubmitting(true);
    try {
      await apiFetch(`/court/events/${selected.id}/outcome`, {
        method: 'PUT',
        body: JSON.stringify(outcomeData),
      });
      addToast('Outcome recorded', 'success');
      setOutcomeOpen(false);
      const updated = await apiFetch<{ data: CourtEvent }>(`/court/events/${selected.id}`);
      setSelected(updated.data);
      fetchEvents({ silent: true }); fetchUpcoming();
    } catch (err: any) { addToast(err?.message || 'Operation failed', 'error'); }
    finally { setOutcomeSubmitting(false); }
  };

  const displayEvents = activeView === 'upcoming' ? upcoming : events;

  const daysUntil = (dateStr: string) => {
    const d = Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (isNaN(d)) return '-';
    if (d < 0) return 'PAST';
    if (d === 0) return 'TODAY';
    if (d === 1) return 'TOMORROW';
    return `${d} days`;
  };

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left Panel ── */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[400px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Court / Legal Tracker" icon={Gavel}>
          <button onClick={() => setCitationSearchOpen(true)} className="toolbar-btn text-[10px]">
            <FileText style={{ width: 11, height: 11 }} /> From Citation
          </button>
          <button onClick={() => { clearAllErrors(); setFormOpen(true); setFormData({ ...EMPTY_FORM }); }} className="toolbar-btn toolbar-btn-primary">
            <Plus style={{ width: 11, height: 11 }} /> New
          </button>
        </PanelTitleBar>

        {fetchError && (
          <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
            <span>⚠ {fetchError}</span>
            <button onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300">✕</button>
          </div>
        )}

        {/* View Toggle */}
        <div className="flex border-b border-rmpg-700">
          <button
            onClick={() => setActiveView('upcoming')}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${activeView === 'upcoming' ? 'text-white border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500'}`}
          >
            Upcoming ({upcoming.length})
          </button>
          <button
            onClick={() => setActiveView('list')}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${activeView === 'list' ? 'text-white border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500'}`}
          >
            All Events ({totalCount})
          </button>
        </div>

        {/* Filters (list view only) */}
        {activeView === 'list' && (
          <div className="flex gap-1 p-1.5 border-b border-rmpg-700 bg-surface-base">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
              <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }} placeholder="Search events..." className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 outline-none" />
            </div>
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none">
              <option value="">All Types</option>
              {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}

        {/* Event List */}
        <div className="flex-1 overflow-y-auto">
          {loading && activeView === 'list' ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>
          ) : displayEvents.length === 0 ? (
            <EmptyState
              icon={Scale}
              title="No events found"
              description="Create a new court event to get started."
              action={{ label: 'New Event', onClick: () => { clearAllErrors(); setFormOpen(true); setFormData({ ...EMPTY_FORM }); } }}
            />
          ) : (
            displayEvents.map(evt => {
              const countdown = evt.event_date ? daysUntil(evt.event_date) : '';
              const isUrgent = countdown === 'TODAY' || countdown === 'TOMORROW';
              return (
                <button
                  key={evt.id}
                  onClick={() => setSelected(evt)}
                  className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-colors ${
                    selected?.id === evt.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono font-bold text-white">{evt.event_number}</span>
                    <div className="flex items-center gap-1">
                      {isUrgent && <span className="text-[9px] font-bold text-red-400 animate-pulse">{countdown}</span>}
                      <span className={`text-[9px] px-1.5 py-0.5 border ${EVENT_TYPE_COLORS[evt.event_type] || ''}`}>
                        {evt.event_type.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-rmpg-300 truncate mt-0.5">
                    {evt.defendant_name || 'No defendant'} — {evt.court_name}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                    <Calendar style={{ width: 9, height: 9 }} />
                    {evt.event_date ? formatDate(evt.event_date) : '—'}
                    {evt.event_time && <span>{evt.event_time}</span>}
                    {evt.courtroom && <span>Rm {evt.courtroom}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`${selected.event_number} — ${EVENT_TYPES.find(t => t.value === selected.event_type)?.label}`} icon={Gavel}>
              {selected.status !== 'completed' && (
                <button onClick={() => { setOutcomeData({ outcome: '', sentence: '', fine_amount: '' }); setOutcomeOpen(true); }} className="toolbar-btn toolbar-btn-primary">
                  <CheckCircle style={{ width: 11, height: 11 }} /> Record Outcome
                </button>
              )}
            </PanelTitleBar>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border font-bold ${EVENT_TYPE_COLORS[selected.event_type] || ''}`}>
                  {selected.event_type.toUpperCase()}
                </span>
                <span className={`text-[10px] px-2 py-1 border font-bold ${STATUS_COLORS[selected.status] || ''}`}>
                  {selected.status.toUpperCase()}
                </span>
                {selected.outcome && (
                  <span className="text-[10px] px-2 py-1 border bg-purple-900/50 text-purple-400 border-purple-700/50 font-bold">
                    {selected.outcome.replace(/_/g, ' ').toUpperCase()}
                  </span>
                )}
              </div>

              {/* Detail Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ['Event Date', selected.event_date ? formatDate(selected.event_date) : '—'],
                  ['Time', selected.event_time || '—'],
                  ['Court', selected.court_name],
                  ['Courtroom', selected.courtroom || '—'],
                  ['Judge', selected.judge_name || '—'],
                  ['Court Case #', selected.court_case_number || '—'],
                  ['Defendant', selected.defendant_name || '—'],
                  ['Prosecutor', selected.prosecutor || '—'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                    <div className="text-xs text-white mt-0.5">{value || '—'}</div>
                  </div>
                ))}
              </div>

              {/* Outcome section */}
              {selected.outcome && (
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2">Outcome</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><span className="text-[9px] text-rmpg-500">Verdict:</span> <span className="text-xs text-white font-bold">{selected.outcome.replace(/_/g, ' ')}</span></div>
                    {selected.sentence && <div><span className="text-[9px] text-rmpg-500">Sentence:</span> <span className="text-xs text-white">{selected.sentence}</span></div>}
                    {selected.fine_amount && !isNaN(Number(selected.fine_amount)) && <div><span className="text-[9px] text-rmpg-500">Fine:</span> <span className="text-xs text-amber-400">${Number(selected.fine_amount).toFixed(2)}</span></div>}
                  </div>
                </div>
              )}

              {selected.notes && (
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1">Notes</div>
                  <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selected.notes}</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Gavel className="w-10 h-10 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500">Select a court event to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* ── New Event Modal ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel-surface w-full max-w-lg mx-4">
            <PanelTitleBar title="New Court Event" icon={Plus}>
              <button onClick={() => setFormOpen(false)} className="toolbar-btn"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Type</label>
                  <select value={formData.event_type} onChange={e => setFormData(p => ({ ...p, event_type: e.target.value as CourtEventType }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Date *</label>
                  <input type="date" value={formData.event_date} onChange={e => setFormData(p => ({ ...p, event_date: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white outline-none ${formErrors.event_date ? 'border-red-500' : 'border-rmpg-700'}`} />
                  {formErrors.event_date && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.event_date}</p>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="field-label">Time</label>
                  <input type="time" value={formData.event_time} onChange={e => setFormData(p => ({ ...p, event_time: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
                <div>
                  <label className="field-label">Court *</label>
                  <input value={formData.court_name} onChange={e => setFormData(p => ({ ...p, court_name: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white outline-none ${formErrors.court_name ? 'border-red-500' : 'border-rmpg-700'}`} />
                  {formErrors.court_name && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.court_name}</p>}
                </div>
                <div>
                  <label className="field-label">Courtroom</label>
                  <input value={formData.courtroom} onChange={e => setFormData(p => ({ ...p, courtroom: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Defendant Name</label>
                  <input value={formData.defendant_name} onChange={e => setFormData(p => ({ ...p, defendant_name: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
                <div>
                  <label className="field-label">Judge</label>
                  <input value={formData.judge_name} onChange={e => setFormData(p => ({ ...p, judge_name: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button onClick={() => setFormOpen(false)} className="toolbar-btn">Cancel</button>
                <button onClick={handleCreate} disabled={submitting} className="toolbar-btn toolbar-btn-primary">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create Event
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Outcome Modal ── */}
      {outcomeOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Record Outcome" icon={CheckCircle}>
              <button onClick={() => setOutcomeOpen(false)} className="toolbar-btn"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Outcome *</label>
                <select value={outcomeData.outcome} onChange={e => setOutcomeData(p => ({ ...p, outcome: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                  <option value="">Select outcome...</option>
                  {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Sentence</label>
                <textarea value={outcomeData.sentence} onChange={e => setOutcomeData(p => ({ ...p, sentence: e.target.value }))} rows={2} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none" />
              </div>
              <div>
                <label className="field-label">Fine Amount ($)</label>
                <input value={outcomeData.fine_amount} onChange={e => setOutcomeData(p => ({ ...p, fine_amount: e.target.value }))} type="number" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button onClick={() => setOutcomeOpen(false)} className="toolbar-btn">Cancel</button>
                <button onClick={handleOutcome} disabled={outcomeSubmitting || !outcomeData.outcome} className="toolbar-btn toolbar-btn-primary">
                  {outcomeSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: 11, height: 11 }} />}
                  Save Outcome
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create from Citation Modal */}
      {citationSearchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setCitationSearchOpen(false)}>
          <div className="panel-surface w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <PanelTitleBar title="Create Court Event from Citation" icon={FileText}>
              <button onClick={() => setCitationSearchOpen(false)} className="toolbar-btn"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input value={citationSearchQ} onChange={e => setCitationSearchQ(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearchCitations()}
                  placeholder="Search by citation number, name, or statute..."
                  className="flex-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                <button onClick={handleSearchCitations} disabled={citationSearching} className="toolbar-btn-primary text-[10px] px-3">
                  {citationSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search style={{ width: 11, height: 11 }} />}
                  Search
                </button>
              </div>
              {citationSearchResults.length > 0 ? (
                <div className="max-h-[300px] overflow-y-auto space-y-1">
                  {citationSearchResults.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 border border-rmpg-700 bg-surface-sunken hover:bg-rmpg-800/50">
                      <div>
                        <div className="text-[11px] font-mono font-bold text-white">{c.citation_number}</div>
                        <div className="text-[10px] text-rmpg-300">{c.person_name || 'Unknown'} -- {c.statute_citation || c.violation_description || ''}</div>
                        <div className="text-[9px] text-rmpg-500">{c.court_date ? `Court: ${c.court_date}` : 'No court date'} {c.court_name ? `at ${c.court_name}` : ''}</div>
                      </div>
                      <button onClick={() => handleCreateFromCitation(c.id)} disabled={creatingFromCitation} className="toolbar-btn-primary text-[10px] px-2 py-1 flex-shrink-0">
                        {creatingFromCitation ? '...' : 'Create Event'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : citationSearchQ && !citationSearching ? (
                <div className="text-center text-[10px] text-rmpg-500 py-4">No citations found. Try a different search.</div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
