// ============================================================
// RMPG Flex — Court / Legal Tracker Page
// ============================================================
// Court event management with calendar, upcoming events,
// officer subpoena tracking, and outcome recording.
// Features: calendar view, schedule conflict check, continuance
// tracking, verdict recording, appearance confirmation, bail/bond,
// document upload, judge notes, deadline countdown, disposition stats.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Gavel, Search, Plus, Calendar, Clock, User, MapPin,
  X, Save, Loader2, AlertTriangle, CheckCircle, FileText, Scale,
  ChevronLeft, ChevronRight, Upload, Shield, DollarSign, BarChart3,
  BookOpen, AlertCircle, Check, RefreshCw, Users,
} from 'lucide-react';
import type { CourtEvent, CourtEventType, CourtEventStatus, CourtOutcome } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useFormValidation } from '../hooks/useFormValidation';
import { isValidDate } from '../utils/validate';
import { formatDate } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';

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

export default function CourtTrackerPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();

  const [activeView, setActiveView] = useState<'list' | 'upcoming' | 'calendar' | 'stats'>('upcoming');
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

  // Feature 1: Calendar state
  const [calendarData, setCalendarData] = useState<Record<string, any[]>>({});
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());

  // Feature 2: Conflicts
  const [conflicts, setConflicts] = useState<any[]>([]);

  // Feature 3: Continuance modal
  const [continuanceOpen, setContinuanceOpen] = useState(false);
  const [continuanceData, setContinuanceData] = useState({ reason: '', new_date: '', new_time: '' });
  const [continuanceSubmitting, setContinuanceSubmitting] = useState(false);

  // Feature 6: Bail/bond modal
  const [bailOpen, setBailOpen] = useState(false);
  const [bailData, setBailData] = useState({ bail_amount: '', bond_status: '', surety_info: '' });
  const [bailSubmitting, setBailSubmitting] = useState(false);

  // Feature 8: Judge notes modal
  const [judgeNotesOpen, setJudgeNotesOpen] = useState(false);
  const [judgeNotesText, setJudgeNotesText] = useState('');
  const [judgeNotesSubmitting, setJudgeNotesSubmitting] = useState(false);

  // Feature 10: Statistics
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Feature 7: Prosecutor contact info
  const [prosecutorOpen, setProsecutorOpen] = useState(false);
  const [prosecutorData, setProsecutorData] = useState({ prosecutor_name: '', prosecutor_phone: '', prosecutor_email: '' });
  const [prosecutorSubmitting, setProsecutorSubmitting] = useState(false);

  // Feature 8b: Court fee tracking
  const [feeOpen, setFeeOpen] = useState(false);
  const [feeData, setFeeData] = useState({ filing_fee: '', service_fee: '', other_fees: '', fee_notes: '' });
  const [feeSubmitting, setFeeSubmitting] = useState(false);

  // Feature 9: Witness list
  const [witnessOpen, setWitnessOpen] = useState(false);
  const [witnesses, setWitnesses] = useState<any[]>([]);
  const [witnessSubmitting, setWitnessSubmitting] = useState(false);

  // Feature 7: Save prosecutor info
  const handleSaveProsecutor = async () => {
    if (!selected) return;
    setProsecutorSubmitting(true);
    try {
      await apiFetch(`/court/events/${selected.id}/prosecutor`, {
        method: 'PUT', body: JSON.stringify(prosecutorData),
      });
      addToast('Prosecutor info saved', 'success');
      setProsecutorOpen(false);
      fetchEvents({ silent: true });
    } catch (err: any) { addToast(err?.message || 'Failed to save', 'error'); }
    finally { setProsecutorSubmitting(false); }
  };

  // Feature 8b: Save court fees
  const handleSaveFees = async () => {
    if (!selected) return;
    setFeeSubmitting(true);
    try {
      await apiFetch(`/court/events/${selected.id}/fees`, {
        method: 'PUT', body: JSON.stringify(feeData),
      });
      addToast('Court fees saved', 'success');
      setFeeOpen(false);
      fetchEvents({ silent: true });
    } catch (err: any) { addToast(err?.message || 'Failed to save', 'error'); }
    finally { setFeeSubmitting(false); }
  };

  // Feature 9: Save witnesses
  const handleSaveWitnesses = async () => {
    if (!selected) return;
    setWitnessSubmitting(true);
    try {
      await apiFetch(`/court/events/${selected.id}/witnesses`, {
        method: 'PUT', body: JSON.stringify({ witnesses }),
      });
      addToast('Witness list saved', 'success');
      setWitnessOpen(false);
      fetchEvents({ silent: true });
    } catch (err: any) { addToast(err?.message || 'Failed to save', 'error'); }
    finally { setWitnessSubmitting(false); }
  };

  // Feature 10b: Clone event for continuance
  const handleCloneEvent = async (eventId: number) => {
    const newDate = prompt('Enter new date for the cloned event (YYYY-MM-DD):');
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    try {
      const res = await apiFetch<{ data: any }>(`/court/events/${eventId}/clone`, {
        method: 'POST', body: JSON.stringify({ new_date: newDate }),
      });
      addToast(`Event cloned: ${res.data?.event_number}`, 'success');
      fetchEvents({ silent: true }); fetchUpcoming();
    } catch (err: any) { addToast(err?.message || 'Clone failed', 'error'); }
  };

  // Feature 6: Generate 24h reminders
  const handleGenerateReminders = async () => {
    try {
      const res = await apiFetch<{ reminders_sent: number; events_tomorrow: number }>('/court/events/generate-reminders', { method: 'POST' });
      addToast(`${res.reminders_sent} reminders sent for ${res.events_tomorrow} events tomorrow`, 'success');
    } catch (err: any) { addToast(err?.message || 'Failed to generate reminders', 'error'); }
  };

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

  // Feature 1: Calendar fetch
  const fetchCalendar = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: Record<string, any[]> }>(`/court/calendar?month=${calendarMonth}&year=${calendarYear}`);
      setCalendarData(res.data || {});
    } catch { /* silent */ }
  }, [calendarMonth, calendarYear]);

  // Feature 10: Stats fetch
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await apiFetch<{ data: any }>('/court/statistics');
      setStats(res.data || null);
    } catch { /* silent */ }
    finally { setStatsLoading(false); }
  }, []);

  // Feature 2: Conflict check
  const fetchConflicts = useCallback(async (eventId: number) => {
    try {
      const res = await apiFetch<{ data: any[] }>(`/court/events/${eventId}/conflicts`);
      setConflicts(res.data || []);
    } catch { setConflicts([]); }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => { fetchUpcoming(); }, [fetchUpcoming]);
  useEffect(() => { if (activeView === 'calendar') fetchCalendar(); }, [activeView, fetchCalendar]);
  useEffect(() => { if (activeView === 'stats') fetchStats(); }, [activeView, fetchStats]);
  useEffect(() => { if (selected?.id) fetchConflicts(selected.id as any); }, [selected?.id, fetchConflicts]);
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

  // Feature 5: Confirm attendance
  const handleConfirmAttendance = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/court/events/${selected.id}/confirm`, { method: 'PUT' });
      addToast('Attendance confirmed', 'success');
      const updated = await apiFetch<{ data: CourtEvent }>(`/court/events/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) { addToast(err?.message || 'Failed', 'error'); }
  };

  // Feature 3: Submit continuance
  const handleContinuance = async () => {
    if (!selected || !continuanceData.reason) return;
    setContinuanceSubmitting(true);
    try {
      await apiFetch(`/court/events/${selected.id}/continuance`, {
        method: 'POST', body: JSON.stringify(continuanceData),
      });
      addToast('Continuance recorded', 'success');
      setContinuanceOpen(false);
      setContinuanceData({ reason: '', new_date: '', new_time: '' });
      const updated = await apiFetch<{ data: CourtEvent }>(`/court/events/${selected.id}`);
      setSelected(updated.data);
      fetchEvents({ silent: true }); fetchUpcoming();
    } catch (err: any) { addToast(err?.message || 'Failed', 'error'); }
    finally { setContinuanceSubmitting(false); }
  };

  // Feature 6: Submit bail/bond
  const handleBailSubmit = async () => {
    if (!selected) return;
    setBailSubmitting(true);
    try {
      await apiFetch(`/court/events/${selected.id}/bail`, {
        method: 'PUT', body: JSON.stringify(bailData),
      });
      addToast('Bail/bond info updated', 'success');
      setBailOpen(false);
      const updated = await apiFetch<{ data: CourtEvent }>(`/court/events/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) { addToast(err?.message || 'Failed', 'error'); }
    finally { setBailSubmitting(false); }
  };

  // Feature 8: Submit judge notes
  const handleJudgeNotesSubmit = async () => {
    if (!selected) return;
    setJudgeNotesSubmitting(true);
    try {
      await apiFetch(`/court/events/${selected.id}/judge-notes`, {
        method: 'PUT', body: JSON.stringify({ judge_notes: judgeNotesText }),
      });
      addToast('Judge notes saved', 'success');
      setJudgeNotesOpen(false);
      const updated = await apiFetch<{ data: CourtEvent }>(`/court/events/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) { addToast(err?.message || 'Failed', 'error'); }
    finally { setJudgeNotesSubmitting(false); }
  };

  const displayEvents = activeView === 'upcoming' ? upcoming : events;

  // Feature 9: Deadline countdown with urgency colors
  const daysUntil = (dateStr: string) => {
    const d = Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (isNaN(d)) return { text: '-', color: 'text-rmpg-500' };
    if (d < 0) return { text: 'PAST', color: 'text-red-500' };
    if (d === 0) return { text: 'TODAY', color: 'text-red-400 animate-pulse' };
    if (d === 1) return { text: 'TOMORROW', color: 'text-orange-400' };
    if (d <= 3) return { text: `${d} days`, color: 'text-amber-400' };
    if (d <= 7) return { text: `${d} days`, color: 'text-yellow-400' };
    return { text: `${d} days`, color: 'text-green-400' };
  };

  // Feature 1: Calendar helpers
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calendarYear, calendarMonth - 1, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [calendarMonth, calendarYear]);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Set document title
  useEffect(() => { document.title = 'Court Tracker \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFormOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* Left Panel */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[400px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Court / Legal Tracker" icon={Gavel}>
          <button type="button" onClick={() => setCitationSearchOpen(true)} className="toolbar-btn text-[10px]">
            <FileText style={{ width: 11, height: 11 }} /> From Citation
          </button>
          <button type="button" onClick={() => { clearAllErrors(); setFormOpen(true); setFormData({ ...EMPTY_FORM }); }} className="toolbar-btn toolbar-btn-primary print:hidden">
            <Plus style={{ width: 11, height: 11 }} /> New
          </button>
        </PanelTitleBar>

        {fetchError && (
          <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" /> <span>{fetchError}</span>
            <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300"><X style={{ width: 12, height: 12 }} /></button>
          </div>
        )}

        {/* View Toggle — 4 tabs */}
        <div className="flex border-b border-rmpg-700">
          {[
            { id: 'upcoming' as const, label: `Upcoming (${upcoming.length})` },
            { id: 'list' as const, label: `All (${totalCount})` },
            { id: 'calendar' as const, label: 'Calendar' },
            { id: 'stats' as const, label: 'Stats' },
          ].map(tab => (
            <button type="button"
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${activeView === tab.id ? 'text-white border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filters (list view only) */}
        {activeView === 'list' && (
          <div className="flex gap-1 p-1.5 border-b border-rmpg-700 bg-surface-base">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
              <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }} placeholder="Search events..." aria-label="Search events..." className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 outline-none" />
            </div>
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none">
              <option value="">All Types</option>
              {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}

        {/* Feature 1: Calendar View */}
        {activeView === 'calendar' && (
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent p-2">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => { if (calendarMonth === 1) { setCalendarMonth(12); setCalendarYear(y => y - 1); } else setCalendarMonth(m => m - 1); }} className="toolbar-btn p-1">
                <ChevronLeft style={{ width: 14, height: 14 }} />
              </button>
              <span className="text-xs font-bold text-white">{monthNames[calendarMonth - 1]} {calendarYear}</span>
              <button type="button" onClick={() => { if (calendarMonth === 12) { setCalendarMonth(1); setCalendarYear(y => y + 1); } else setCalendarMonth(m => m + 1); }} className="toolbar-btn p-1">
                <ChevronRight style={{ width: 14, height: 14 }} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-px">
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                <div key={d} className="text-[8px] text-rmpg-500 text-center py-1 font-bold">{d}</div>
              ))}
              {calendarDays.map((day, idx) => {
                const dateStr = day ? `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                const dayEvents = dateStr ? (calendarData[dateStr] || []) : [];
                const isToday = dateStr === new Date().toISOString().split('T')[0];
                return (
                  <div
                    key={idx}
                    className={`min-h-[40px] p-0.5 border border-rmpg-800 ${day ? 'cursor-pointer hover:bg-rmpg-800/50' : ''} ${isToday ? 'bg-brand-900/20 border-brand-600' : ''}`}
                    onClick={() => {
                      if (dayEvents.length > 0) {
                        const evt = dayEvents[0];
                        setSelected(evt);
                        setActiveView('upcoming');
                      }
                    }}
                  >
                    {day && (
                      <>
                        <div className={`text-[9px] ${isToday ? 'text-brand-400 font-bold' : 'text-rmpg-400'}`}>{day}</div>
                        {dayEvents.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 mt-0.5">
                            {dayEvents.slice(0, 3).map((e: any) => (
                              <div key={e.id} className={`w-full text-[7px] px-0.5 truncate ${EVENT_TYPE_COLORS[e.event_type] || 'text-white'}`}>
                                {e.event_time || ''} {e.defendant_name || e.event_number}
                              </div>
                            ))}
                            {dayEvents.length > 3 && <div className="text-[7px] text-rmpg-500">+{dayEvents.length - 3} more</div>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Feature 10: Statistics View */}
        {activeView === 'stats' && (
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent p-3 space-y-3">
            {statsLoading ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading...</span></div>
            ) : stats ? (
              <>
                {/* Totals */}
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider mb-2">Overview (Last 12 Months)</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['Total Events', stats.totals?.total || 0],
                      ['Completed', stats.totals?.completed || 0],
                      ['Scheduled', stats.totals?.scheduled || 0],
                      ['Total Continuances', stats.totals?.total_continuances || 0],
                      ['Avg Fine', stats.totals?.avg_fine ? `$${Number(stats.totals.avg_fine).toFixed(0)}` : '$0'],
                    ].map(([label, val]) => (
                      <div key={label as string}>
                        <div className="text-[8px] text-rmpg-500">{label}</div>
                        <div className="text-sm font-bold text-white">{val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By Outcome */}
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider mb-2">Outcomes</div>
                  {(stats.byOutcome || []).map((r: any) => (
                    <div key={r.outcome} className="flex items-center justify-between py-1 border-b border-rmpg-800 last:border-0">
                      <span className="text-[10px] text-rmpg-300">{(r.outcome || '').replace(/_/g, ' ')}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-rmpg-800 overflow-hidden">
                          <div
                            className="h-full bg-brand-500"
                            style={{ width: `${Math.min(100, (r.count / Math.max(1, stats.totals?.total || 1)) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-white w-6 text-right">{r.count}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* By Type */}
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider mb-2">By Event Type</div>
                  {(stats.byType || []).map((r: any) => (
                    <div key={r.event_type} className="flex items-center justify-between py-1 border-b border-rmpg-800 last:border-0">
                      <span className={`text-[10px] px-1.5 py-0.5 border ${EVENT_TYPE_COLORS[r.event_type] || ''}`}>
                        {r.event_type}
                      </span>
                      <span className="text-[10px] font-bold text-white">{r.count}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center text-[10px] text-rmpg-500 py-8">No statistics available</div>
            )}
          </div>
        )}

        {/* Event List (upcoming + list views) */}
        {(activeView === 'upcoming' || activeView === 'list') && (
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
            {loading && activeView === 'list' ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading...</span></div>
            ) : displayEvents.length === 0 ? (
              <EmptyState
                icon={Scale}
                title="No events found"
                description="Create a new court event to get started."
                action={{ label: 'New Event', onClick: () => { clearAllErrors(); setFormOpen(true); setFormData({ ...EMPTY_FORM }); } }}
              />
            ) : (
              displayEvents.map(evt => {
                const countdown = evt.event_date ? daysUntil(evt.event_date) : { text: '-', color: 'text-rmpg-500' };
                return (
                  <button type="button"
                    key={evt.id}
                    onClick={() => setSelected(evt)}
                    aria-label={`Court event ${evt.event_number}`}
                    className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-colors ${
                      selected?.id === evt.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-white">{evt.event_number}</span>
                      <div className="flex items-center gap-1">
                        {/* Feature 9: Countdown with urgency colors */}
                        <span className={`text-[9px] font-bold ${countdown.color}`}>{countdown.text}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 border rounded-sm ${EVENT_TYPE_COLORS[evt.event_type] || ''}`}>
                          {evt.event_type.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] text-rmpg-300 truncate mt-0.5">
                      {evt.defendant_name || 'No defendant'} -- {evt.court_name}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                      <Calendar style={{ width: 9, height: 9 }} />
                      {evt.event_date ? formatDate(evt.event_date) : '--'}
                      {evt.event_time && <span>{evt.event_time}</span>}
                      {evt.courtroom && <span>Rm {evt.courtroom}</span>}
                      {(evt as any).continuance_count > 0 && (
                        <span className="text-amber-400 font-bold">({(evt as any).continuance_count}x continued)</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`${selected.event_number} -- ${EVENT_TYPES.find(t => t.value === selected.event_type)?.label}`} icon={Gavel}>
              {/* Feature 5: Confirm attendance */}
              {selected.status !== 'completed' && (
                <button type="button" onClick={handleConfirmAttendance} className="toolbar-btn text-[10px]" title="Confirm your attendance">
                  <Check style={{ width: 11, height: 11 }} /> Confirm
                </button>
              )}
              {/* Feature 3: Continuance */}
              {selected.status !== 'completed' && (
                <button type="button" onClick={() => { setContinuanceData({ reason: '', new_date: '', new_time: '' }); setContinuanceOpen(true); }} className="toolbar-btn text-[10px]">
                  <RefreshCw style={{ width: 11, height: 11 }} /> Continuance
                </button>
              )}
              {/* Feature 4: Outcome */}
              {selected.status !== 'completed' && (
                <button type="button" onClick={() => { setOutcomeData({ outcome: '', sentence: '', fine_amount: '' }); setOutcomeOpen(true); }} className="toolbar-btn toolbar-btn-primary print:hidden">
                  <CheckCircle style={{ width: 11, height: 11 }} /> Record Outcome
                </button>
              )}
            </PanelTitleBar>

            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent p-4 space-y-4">
              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border rounded-sm font-bold ${EVENT_TYPE_COLORS[selected.event_type] || ''}`}>
                  {selected.event_type.toUpperCase()}
                </span>
                <span className={`text-[10px] px-2 py-1 border rounded-sm font-bold ${STATUS_COLORS[selected.status] || ''}`}>
                  {selected.status.toUpperCase()}
                </span>
                {selected.outcome && (
                  <span className="text-[10px] px-2 py-1 border rounded-sm bg-purple-900/50 text-purple-400 border-purple-700/50 font-bold">
                    {selected.outcome.replace(/_/g, ' ').toUpperCase()}
                  </span>
                )}
                {(selected as any).continuance_count > 0 && (
                  <span className="text-[10px] px-2 py-1 border bg-amber-900/50 text-amber-400 border-amber-700/50 font-bold">
                    {(selected as any).continuance_count}x CONTINUED
                  </span>
                )}
              </div>

              {/* Feature 2: Schedule conflict warnings */}
              {conflicts.length > 0 && (
                <div className="panel-beveled p-3 border-l-2 border-l-red-500 bg-red-900/10">
                  <div className="text-[9px] font-mono text-red-400 uppercase mb-1 flex items-center gap-1">
                    <AlertTriangle style={{ width: 10, height: 10 }} /> Schedule Conflicts ({conflicts.length})
                  </div>
                  {conflicts.map((c: any, i: number) => (
                    <div key={i} className="text-[10px] text-red-300 py-0.5">
                      <strong>{c.officer_name}</strong>: {c.details}
                    </div>
                  ))}
                </div>
              )}

              {/* Feature 9: Deadline countdown bar */}
              {selected.event_date && selected.status !== 'completed' && (
                <div className="panel-beveled p-2 flex items-center gap-3">
                  <Clock style={{ width: 14, height: 14 }} className="text-rmpg-500" />
                  <div>
                    <div className="text-[9px] text-rmpg-500">COURT DATE COUNTDOWN</div>
                    <div className={`text-sm font-bold ${daysUntil(selected.event_date).color}`}>
                      {daysUntil(selected.event_date).text}
                    </div>
                  </div>
                </div>
              )}

              {/* Detail Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ['Event Date', selected.event_date ? formatDate(selected.event_date) : '--'],
                  ['Time', selected.event_time || '--'],
                  ['Court', selected.court_name],
                  ['Courtroom', selected.courtroom || '--'],
                  ['Judge', selected.judge_name || '--'],
                  ['Court Case #', selected.court_case_number || '--'],
                  ['Defendant', selected.defendant_name || '--'],
                  ['Prosecutor', selected.prosecutor || '--'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider">{label}</div>
                    <div className="text-xs text-white mt-0.5">{value || '--'}</div>
                  </div>
                ))}
              </div>

              {/* Feature 6: Bail/Bond Info */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider flex items-center gap-1">
                    <DollarSign style={{ width: 10, height: 10 }} /> Bail / Bond
                  </div>
                  <button type="button" onClick={() => {
                    setBailData({
                      bail_amount: (selected as any).bail_amount || '',
                      bond_status: (selected as any).bond_status || '',
                      surety_info: (selected as any).surety_info || '',
                    });
                    setBailOpen(true);
                  }} className="toolbar-btn text-[9px]">Edit</button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><span className="text-[9px] text-rmpg-500">Amount:</span> <span className="text-xs text-white">{(selected as any).bail_amount ? `$${Number((selected as any).bail_amount).toLocaleString()}` : '--'}</span></div>
                  <div><span className="text-[9px] text-rmpg-500">Status:</span> <span className="text-xs text-white">{(selected as any).bond_status || '--'}</span></div>
                  <div><span className="text-[9px] text-rmpg-500">Surety:</span> <span className="text-xs text-white">{(selected as any).surety_info || '--'}</span></div>
                </div>
              </div>

              {/* Feature 5: Officer confirmations */}
              {(() => {
                let confirmations: Record<string, any> = {};
                let officers: any[] = [];
                try { confirmations = JSON.parse((selected as any).officer_confirmations || '{}'); } catch { /* invalid JSON */ }
                try { officers = JSON.parse((selected as any).officers_required || '[]'); } catch { /* invalid JSON */ }
                if (!Array.isArray(officers) || officers.length === 0) return null;
                return (
                  <div className="panel-beveled p-3">
                    <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Shield style={{ width: 10, height: 10 }} /> Officer Confirmations
                    </div>
                    {officers.map((oid: any) => {
                      const confirmed = confirmations[String(oid)];
                      return (
                        <div key={oid} className="flex items-center gap-2 py-0.5">
                          {confirmed ? (
                            <CheckCircle style={{ width: 10, height: 10 }} className="text-green-400" />
                          ) : (
                            <AlertCircle style={{ width: 10, height: 10 }} className="text-amber-400" />
                          )}
                          <span className="text-[10px] text-rmpg-300">Officer #{oid}</span>
                          {confirmed && <span className="text-[9px] text-green-400">Confirmed at {confirmed.at}</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Feature 8: Judge notes */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider flex items-center gap-1">
                    <BookOpen style={{ width: 10, height: 10 }} /> Judge Preferences / Notes
                  </div>
                  <button type="button" onClick={() => { setJudgeNotesText((selected as any).judge_notes || ''); setJudgeNotesOpen(true); }} className="toolbar-btn text-[9px]">Edit</button>
                </div>
                <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{(selected as any).judge_notes || 'No notes recorded.'}</div>
              </div>

              {/* Feature 7: Court documents */}
              <div className="panel-beveled p-3">
                <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <FileText style={{ width: 10, height: 10 }} /> Court Documents
                </div>
                {(() => {
                  let docs: any[] = [];
                  try { docs = JSON.parse((selected as any).documents || '[]'); } catch { /* invalid JSON */ }
                  if (!Array.isArray(docs) || docs.length === 0) return <div className="text-[10px] text-rmpg-500">No documents uploaded.</div>;
                  return docs.map((d: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-rmpg-800 last:border-0">
                      <FileText style={{ width: 10, height: 10 }} className="text-brand-400" />
                      <span className="text-[10px] text-white">{d.file_name}</span>
                      <span className="text-[9px] text-rmpg-500">{d.doc_type}</span>
                    </div>
                  ));
                })()}
              </div>

              {/* Feature 7: Prosecutor Contact Info */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider flex items-center gap-1">
                    <User style={{ width: 10, height: 10 }} /> Prosecutor Contact
                  </div>
                  <button type="button" onClick={() => {
                    const parsed = (() => { try { return JSON.parse(selected.prosecutor || '{}'); } catch { return { name: selected.prosecutor || '' }; } })();
                    setProsecutorData({ prosecutor_name: parsed.name || '', prosecutor_phone: parsed.phone || '', prosecutor_email: parsed.email || '' });
                    setProsecutorOpen(true);
                  }} className="toolbar-btn text-[9px]">Edit</button>
                </div>
                {(() => {
                  try {
                    const p = JSON.parse(selected.prosecutor || '{}');
                    return (
                      <div className="grid grid-cols-3 gap-2">
                        <div><span className="text-[9px] text-rmpg-500">Name:</span> <span className="text-xs text-white">{p.name || '--'}</span></div>
                        <div><span className="text-[9px] text-rmpg-500">Phone:</span> <span className="text-xs text-white">{p.phone || '--'}</span></div>
                        <div><span className="text-[9px] text-rmpg-500">Email:</span> <span className="text-xs text-white">{p.email || '--'}</span></div>
                      </div>
                    );
                  } catch { return <div className="text-xs text-rmpg-300">{selected.prosecutor || '--'}</div>; }
                })()}
              </div>

              {/* Feature 8b: Court Fee Tracking */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider flex items-center gap-1">
                    <DollarSign style={{ width: 10, height: 10 }} /> Court Fees
                  </div>
                  <button type="button" onClick={() => {
                    let fees: any = {};
                    try { fees = JSON.parse((selected as any).court_fees || '{}'); } catch { /* invalid JSON */ }
                    setFeeData({ filing_fee: fees.filing_fee || '', service_fee: fees.service_fee || '', other_fees: fees.other_fees || '', fee_notes: fees.fee_notes || '' });
                    setFeeOpen(true);
                  }} className="toolbar-btn text-[9px]">Edit</button>
                </div>
                {(() => {
                  let fees: any = {};
                  try { fees = JSON.parse((selected as any).court_fees || '{}'); } catch { /* invalid JSON */ }
                  const total = (fees.filing_fee || 0) + (fees.service_fee || 0) + (fees.other_fees || 0);
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div><span className="text-[9px] text-rmpg-500">Filing:</span> <span className="text-xs text-white">{fees.filing_fee ? `$${fees.filing_fee}` : '--'}</span></div>
                      <div><span className="text-[9px] text-rmpg-500">Service:</span> <span className="text-xs text-white">{fees.service_fee ? `$${fees.service_fee}` : '--'}</span></div>
                      <div><span className="text-[9px] text-rmpg-500">Other:</span> <span className="text-xs text-white">{fees.other_fees ? `$${fees.other_fees}` : '--'}</span></div>
                      <div><span className="text-[9px] text-rmpg-500 font-bold">Total:</span> <span className="text-xs text-brand-300 font-bold">{total > 0 ? `$${total.toFixed(2)}` : '--'}</span></div>
                    </div>
                  );
                })()}
              </div>

              {/* Feature 9: Witness List */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider flex items-center gap-1">
                    <Users style={{ width: 10, height: 10 }} /> Witnesses
                  </div>
                  <button type="button" onClick={() => {
                    setWitnesses(JSON.parse((selected as any).witnesses || '[]'));
                    setWitnessOpen(true);
                  }} className="toolbar-btn text-[9px]">Manage</button>
                </div>
                {(() => {
                  const w = JSON.parse((selected as any).witnesses || '[]');
                  if (w.length === 0) return <div className="text-[10px] text-rmpg-500">No witnesses recorded.</div>;
                  return w.map((wit: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-rmpg-800 last:border-0">
                      <span className={`w-2 h-2 rounded-full ${wit.contact_status === 'confirmed' ? 'bg-green-500' : wit.contact_status === 'contacted' ? 'bg-amber-500' : 'bg-rmpg-600'}`} />
                      <span className="text-[10px] text-white flex-1">{wit.name}</span>
                      <span className="text-[9px] text-rmpg-500">{wit.role}</span>
                      <span className="text-[9px] text-rmpg-600">{wit.contact_status}</span>
                    </div>
                  ));
                })()}
              </div>

              {/* Feature 10b: Clone Event + Feature 6: Reminders */}
              <div className="flex items-center gap-2 flex-wrap">
                {selected.status !== 'completed' && (
                  <button type="button" onClick={() => handleCloneEvent(parseInt(String(selected.id)))} className="toolbar-btn text-[10px] px-2 py-1">
                    <RefreshCw style={{ width: 10, height: 10 }} /> Clone for Continuance
                  </button>
                )}
                <button type="button" onClick={handleGenerateReminders} className="toolbar-btn text-[10px] px-2 py-1">
                  <Clock style={{ width: 10, height: 10 }} /> Generate 24h Reminders
                </button>
              </div>

              {/* Feature 3: Continuance log */}
              {(() => {
                const log = JSON.parse((selected as any).continuance_log || '[]');
                if (log.length === 0) return null;
                return (
                  <div className="panel-beveled p-3">
                    <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider mb-2">Continuance History</div>
                    {log.map((entry: any, i: number) => (
                      <div key={i} className="py-1 border-b border-rmpg-800 last:border-0">
                        <div className="text-[10px] text-amber-400 font-bold">#{i + 1}: {entry.reason}</div>
                        <div className="text-[9px] text-rmpg-500">
                          {entry.old_date} -&gt; {entry.new_date || 'TBD'} | Requested {entry.date}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Outcome section */}
              {selected.outcome && (
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider mb-2">Outcome</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><span className="text-[9px] text-rmpg-500">Verdict:</span> <span className="text-xs text-white font-bold">{selected.outcome.replace(/_/g, ' ')}</span></div>
                    {selected.sentence && <div><span className="text-[9px] text-rmpg-500">Sentence:</span> <span className="text-xs text-white">{selected.sentence}</span></div>}
                    {selected.fine_amount && !isNaN(Number(selected.fine_amount)) && <div><span className="text-[9px] text-rmpg-500">Fine:</span> <span className="text-xs text-amber-400">${Number(selected.fine_amount).toFixed(2)}</span></div>}
                  </div>
                </div>
              )}

              {selected.notes && (
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-[#d4a017] uppercase tracking-wider mb-1">Notes</div>
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

      {/* New Event Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="New Court Event">
          <div className="panel-surface w-full max-w-lg mx-4">
            <PanelTitleBar title="New Court Event" icon={Plus}>
              <button type="button" onClick={() => setFormOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Type</label>
                  <select value={formData.event_type} onChange={e => setFormData(p => ({ ...p, event_type: e.target.value as CourtEventType }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600">
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
                  <input type="time" value={formData.event_time} onChange={e => setFormData(p => ({ ...p, event_time: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                </div>
                <div>
                  <label className="field-label">Court *</label>
                  <input value={formData.court_name} onChange={e => setFormData(p => ({ ...p, court_name: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white outline-none ${formErrors.court_name ? 'border-red-500' : 'border-rmpg-700'}`} />
                  {formErrors.court_name && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.court_name}</p>}
                </div>
                <div>
                  <label className="field-label">Courtroom</label>
                  <input value={formData.courtroom} onChange={e => setFormData(p => ({ ...p, courtroom: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Defendant Name</label>
                  <input value={formData.defendant_name} onChange={e => setFormData(p => ({ ...p, defendant_name: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                </div>
                <div>
                  <label className="field-label">Judge</label>
                  <input value={formData.judge_name} onChange={e => setFormData(p => ({ ...p, judge_name: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setFormOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleCreate} disabled={submitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create Event
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Outcome Modal */}
      {outcomeOpen && selected && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Record Outcome">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Record Outcome" icon={CheckCircle}>
              <button type="button" onClick={() => setOutcomeOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Outcome *</label>
                <select value={outcomeData.outcome} onChange={e => setOutcomeData(p => ({ ...p, outcome: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600">
                  <option value="">Select outcome...</option>
                  {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Sentence</label>
                <textarea value={outcomeData.sentence} onChange={e => setOutcomeData(p => ({ ...p, sentence: e.target.value }))} rows={2} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600 resize-none" />
              </div>
              <div>
                <label className="field-label">Fine Amount ($)</label>
                <input value={outcomeData.fine_amount} onChange={e => setOutcomeData(p => ({ ...p, fine_amount: e.target.value }))} type="number" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setOutcomeOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleOutcome} disabled={outcomeSubmitting || !outcomeData.outcome} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {outcomeSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Save Outcome
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feature 3: Continuance Modal */}
      {continuanceOpen && selected && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Log Continuance">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Log Continuance" icon={RefreshCw}>
              <button type="button" onClick={() => setContinuanceOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Reason *</label>
                <textarea value={continuanceData.reason} onChange={e => setContinuanceData(p => ({ ...p, reason: e.target.value }))} rows={2} placeholder="Reason for continuance..." className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">New Date</label>
                  <input type="date" value={continuanceData.new_date} onChange={e => setContinuanceData(p => ({ ...p, new_date: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                </div>
                <div>
                  <label className="field-label">New Time</label>
                  <input type="time" value={continuanceData.new_time} onChange={e => setContinuanceData(p => ({ ...p, new_time: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setContinuanceOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleContinuance} disabled={continuanceSubmitting || !continuanceData.reason} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {continuanceSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Save Continuance
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feature 6: Bail/Bond Modal */}
      {bailOpen && selected && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Bail/Bond Info">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Bail / Bond Information" icon={DollarSign}>
              <button type="button" onClick={() => setBailOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Bail Amount ($)</label>
                <input type="number" value={bailData.bail_amount} onChange={e => setBailData(p => ({ ...p, bail_amount: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
              </div>
              <div>
                <label className="field-label">Bond Status</label>
                <select value={bailData.bond_status} onChange={e => setBailData(p => ({ ...p, bond_status: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600">
                  <option value="">Select...</option>
                  <option value="posted">Posted</option>
                  <option value="cash">Cash Bond</option>
                  <option value="surety">Surety Bond</option>
                  <option value="or_release">Own Recognizance</option>
                  <option value="denied">Denied</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
              <div>
                <label className="field-label">Surety Info</label>
                <input value={bailData.surety_info} onChange={e => setBailData(p => ({ ...p, surety_info: e.target.value }))} placeholder="Bonding company, etc." className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setBailOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleBailSubmit} disabled={bailSubmitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {bailSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feature 8: Judge Notes Modal */}
      {judgeNotesOpen && selected && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Judge Notes">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Judge Preferences / Notes" icon={BookOpen}>
              <button type="button" onClick={() => setJudgeNotesOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <textarea value={judgeNotesText} onChange={e => setJudgeNotesText(e.target.value)} rows={6} placeholder="Judge preferences, courtroom rules, etc." className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600 resize-none" />
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setJudgeNotesOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleJudgeNotesSubmit} disabled={judgeNotesSubmitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {judgeNotesSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Save Notes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feature 7: Prosecutor Contact Modal */}
      {prosecutorOpen && selected && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Prosecutor Contact Info" icon={User}>
              <button type="button" onClick={() => setProsecutorOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div><label className="field-label">Name</label>
                <input value={prosecutorData.prosecutor_name} onChange={e => setProsecutorData(p => ({ ...p, prosecutor_name: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" /></div>
              <div><label className="field-label">Phone</label>
                <input value={prosecutorData.prosecutor_phone} onChange={e => setProsecutorData(p => ({ ...p, prosecutor_phone: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" placeholder="(555) 123-4567" /></div>
              <div><label className="field-label">Email</label>
                <input type="email" value={prosecutorData.prosecutor_email} onChange={e => setProsecutorData(p => ({ ...p, prosecutor_email: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" /></div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setProsecutorOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleSaveProsecutor} disabled={prosecutorSubmitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {prosecutorSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feature 8b: Court Fees Modal */}
      {feeOpen && selected && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Court Fee Tracking" icon={DollarSign}>
              <button type="button" onClick={() => setFeeOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div><label className="field-label">Filing Fee ($)</label>
                <input type="number" step="0.01" value={feeData.filing_fee} onChange={e => setFeeData(p => ({ ...p, filing_fee: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" /></div>
              <div><label className="field-label">Service Fee ($)</label>
                <input type="number" step="0.01" value={feeData.service_fee} onChange={e => setFeeData(p => ({ ...p, service_fee: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" /></div>
              <div><label className="field-label">Other Fees ($)</label>
                <input type="number" step="0.01" value={feeData.other_fees} onChange={e => setFeeData(p => ({ ...p, other_fees: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" /></div>
              <div><label className="field-label">Notes</label>
                <textarea value={feeData.fee_notes} onChange={e => setFeeData(p => ({ ...p, fee_notes: e.target.value }))} rows={2} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600 resize-none" /></div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setFeeOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleSaveFees} disabled={feeSubmitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {feeSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feature 9: Witness List Modal */}
      {witnessOpen && selected && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-lg mx-4">
            <PanelTitleBar title="Witness Management" icon={Users}>
              <button type="button" onClick={() => setWitnessOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent space-y-2">
                {witnesses.map((w, i) => (
                  <div key={i} className="panel-beveled p-2 space-y-1">
                    <div className="flex gap-2">
                      <input value={w.name} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, name: e.target.value } : ww))} placeholder="Name" className="flex-1 px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                      <select value={w.contact_status} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, contact_status: e.target.value } : ww))} className="px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600">
                        <option value="pending">Pending</option>
                        <option value="contacted">Contacted</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="unavailable">Unavailable</option>
                      </select>
                      <button type="button" onClick={() => setWitnesses(ws => ws.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300"><X style={{ width: 12, height: 12 }} /></button>
                    </div>
                    <div className="flex gap-2">
                      <input value={w.phone || ''} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, phone: e.target.value } : ww))} placeholder="Phone" className="flex-1 px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                      <input value={w.email || ''} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, email: e.target.value } : ww))} placeholder="Email" className="flex-1 px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                      <input value={w.role || ''} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, role: e.target.value } : ww))} placeholder="Role" className="w-24 px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setWitnesses(ws => [...ws, { name: '', phone: '', email: '', role: 'witness', contact_status: 'pending', notes: '' }])} className="toolbar-btn text-[10px] w-full justify-center">
                <Plus style={{ width: 10, height: 10 }} /> Add Witness
              </button>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setWitnessOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleSaveWitnesses} disabled={witnessSubmitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {witnessSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />} Save Witnesses
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create from Citation Modal */}
      {citationSearchOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Create from Citation" onClick={() => setCitationSearchOpen(false)}>
          <div className="panel-surface w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <PanelTitleBar title="Create Court Event from Citation" icon={FileText}>
              <button type="button" onClick={() => setCitationSearchOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input value={citationSearchQ} onChange={e => setCitationSearchQ(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearchCitations()}
                  placeholder="Search by citation number, name, or statute..." aria-label="Search by citation number, name, or statute..."
                  className="flex-1 px-2 py-1.5 w-full text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none focus:border-brand-600" />
                <button type="button" onClick={handleSearchCitations} disabled={citationSearching} className="toolbar-btn-primary text-[10px] px-3">
                  {citationSearching ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Search style={{ width: 11, height: 11 }} />}
                  Search
                </button>
              </div>
              {citationSearchResults.length > 0 ? (
                <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent space-y-1">
                  {citationSearchResults.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 border border-rmpg-700 bg-surface-sunken hover:bg-rmpg-800/50">
                      <div>
                        <div className="text-[11px] font-mono font-bold text-white">{c.citation_number}</div>
                        <div className="text-[10px] text-rmpg-300">{c.person_name || 'Unknown'} -- {c.statute_citation || c.violation_description || ''}</div>
                        <div className="text-[9px] text-rmpg-500">{c.court_date ? `Court: ${c.court_date}` : 'No court date'} {c.court_name ? `at ${c.court_name}` : ''}</div>
                      </div>
                      <button type="button" onClick={() => handleCreateFromCitation(c.id)} disabled={creatingFromCitation} className="toolbar-btn-primary text-[10px] px-2 py-1 flex-shrink-0">
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
