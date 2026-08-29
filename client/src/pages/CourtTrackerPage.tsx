// ============================================================
// RMPG Flex — Court / Legal Tracker Page
// ============================================================
// Court event management with calendar, upcoming events,
// officer subpoena tracking, and outcome recording.
// Features: calendar view, schedule conflict check, continuance
// tracking, verdict recording, appearance confirmation, bail/bond,
// document upload, judge notes, deadline countdown, disposition stats.
// ============================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import RichTextArea from '../components/RichTextArea';
import { formatPhoneInput, formatEnumValue, toDisplayLabel } from '../utils/formatters';
import {
  Gavel, Search, Plus, Calendar, Clock, User, X, Save, Loader2, AlertTriangle,
  CheckCircle, FileText, Scale, ChevronLeft, ChevronRight, Shield, DollarSign,
  BookOpen, AlertCircle, Check, RefreshCw, Users, Eye, Copy, Printer,
} from 'lucide-react';
import type { CourtEvent, CourtEventType, CourtOutcome } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useFormValidation } from '../hooks/useFormValidation';
import { useFormDraft } from '../hooks/useFormDraft';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import { isValidDate } from '../utils/validate';
import { formatDate, localToday, parseTimestamp } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';
import { openCourtAppearancePdf } from '../utils/courtAppearancePdf';
import { useSlashFocus } from '../hooks/useSlashFocus';
import { courtDocketToCsv, downloadTextFile } from '../utils/rmsListExport';

const EVENT_TYPES: { value: CourtEventType; label: string }[] = [
  { value: 'arraignment', label: 'Arraignment' }, { value: 'hearing', label: 'Hearing' },
  { value: 'trial', label: 'Trial' }, { value: 'sentencing', label: 'Sentencing' },
  { value: 'motion', label: 'Motion' }, { value: 'subpoena', label: 'Subpoena' },
  { value: 'continuance', label: 'Continuance' }, { value: 'disposition', label: 'Disposition' },
];

const EVENT_TYPE_COLORS: Record<string, string> = {
  arraignment: 'bg-surface-sunken/50 text-rmpg-400 border-border-default/50',
  hearing: 'bg-surface-sunken/50 text-rmpg-400 border-border-default/50',
  trial: 'bg-red-900/50 text-red-400 border-red-700/50',
  sentencing: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  motion: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  subpoena: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
  continuance: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  disposition: 'bg-green-900/50 text-green-400 border-green-700/50',
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-surface-sunken/50 text-rmpg-400 border-border-default/50',
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
  prosecutor: '', defense_attorney: '',
  officers_required: '' as string,
  citation_id: '' as string, incident_id: '' as string, case_id: '' as string,
  defendant_person_id: '' as string,
  notes: '',
};

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
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

  // Role gate — admin/manager can create and edit court events; all
  // other roles (officer, dispatcher, etc.) are read-only on this page.
  // Matches the pattern in DailyActivityReportsPage / Victim Services.
  const canManage = ['admin', 'manager'].includes((user as any)?.role || '');

  const [activeView, setActiveView] = useState<'list' | 'upcoming' | 'calendar' | 'stats'>('upcoming');
  const [events, setEvents] = useState<CourtEvent[]>([]);
  const [upcoming, setUpcoming] = useState<CourtEvent[]>([]);
  const [selected, setSelected] = useState<CourtEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const {
    form: formData,
    setForm: setFormData,
    isDirty: formIsDirty,
    wasRestored: formWasRestored,
    clearDraft: clearFormDraft,
    snapshot: snapshotForm,
  } = useFormDraft<typeof EMPTY_FORM>({
    storageKey: 'rmpg_court_event_form',
    defaultValue: EMPTY_FORM,
    isActive: formOpen,
  });
  const [submitting, setSubmitting] = useState(false);

  // Historical entry flag — when checked in the New form, auto-set
  // status to 'completed' so the entry shows up under past events
  // immediately and outcome/sentence can be entered without going through
  // the live-event flow.
  const [historicalEntry, setHistoricalEntry] = useState(false);

  // Inline edit state for the detail panel header. When `editingHeader`
  // is true, every top-level field (event_type, status, event_date,
  // event_time, court_name, courtroom, judge_name, court_case_number,
  // defendant_name, prosecutor, defense_attorney) becomes an input;
  // Save calls PUT /api/court/events/:id with the draft.
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerDraft, setHeaderDraft] = useState<Partial<CourtEvent>>({});
  const [savingHeader, setSavingHeader] = useState(false);

  const startEditHeader = useCallback((evt: CourtEvent | null) => {
    if (!evt) return;
    setHeaderDraft({
      event_type: evt.event_type,
      status: evt.status,
      event_date: evt.event_date,
      event_time: evt.event_time,
      court_name: evt.court_name,
      courtroom: evt.courtroom,
      judge_name: evt.judge_name,
      court_case_number: evt.court_case_number,
      defendant_name: evt.defendant_name,
      prosecutor: evt.prosecutor,
      defense_attorney: (evt as any).defense_attorney,
    });
    setEditingHeader(true);
  }, []);

  const saveHeader = useCallback(async (evt: CourtEvent | null) => {
    if (!evt) return;
    setSavingHeader(true);
    try {
      await apiFetch(`/court/events/${evt.id}`, {
        method: 'PUT',
        body: JSON.stringify(headerDraft),
      });
      setEditingHeader(false);
      addToast('Event updated', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Update failed', 'error');
    } finally {
      setSavingHeader(false);
    }
  }, [headerDraft, addToast]);

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

  // Clone-for-continuance modal — replaces `window.prompt()` (v1037).
  // Stores both the source event-id (so the same modal can be triggered
  // from the context menu and the in-detail action) and the proposed new
  // date string, validated like the rest of this page's date inputs.
  const [cloneEventId, setCloneEventId] = useState<number | null>(null);
  const [cloneDate, setCloneDate] = useState('');
  const [cloneSubmitting, setCloneSubmitting] = useState(false);

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

  // Feature 10b: Clone event for continuance — opens the inline modal
  // instead of `window.prompt()` (v1037). prompt() is browser-chrome that
  // can't be styled, can't validate inline, can't be Esc-cascaded with
  // the rest of the page, and is the same anti-pattern killed across
  // Cases / Field Interviews / Criminal History / Evidence in
  // v1024–v1028.
  const handleCloneEvent = (eventId: number) => {
    setCloneEventId(eventId);
    setCloneDate('');
  };

  const confirmCloneEvent = async () => {
    if (cloneEventId == null) return;
    if (!cloneDate || !/^\d{4}-\d{2}-\d{2}$/.test(cloneDate) || !isValidDate(cloneDate)) {
      addToast('Valid date required (YYYY-MM-DD)', 'error');
      return;
    }
    setCloneSubmitting(true);
    try {
      const res = await apiFetch<{ data: any }>(`/court/events/${cloneEventId}/clone`, {
        method: 'POST', body: JSON.stringify({ new_date: cloneDate }),
      });
      addToast(`Event cloned: ${res.data?.event_number}`, 'success');
      setCloneEventId(null); setCloneDate('');
      fetchEvents({ silent: true }); fetchUpcoming();
    } catch (err: any) { addToast(err?.message || 'Clone failed', 'error'); }
    finally { setCloneSubmitting(false); }
  };

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const menu = useMenuActions();
  const buildEventMenu = (evt: CourtEvent): ContextMenuItem[] => {
    return [
      menu.action('Open record', () => setSelected(evt), { icon: <Eye size={12} /> }),
      menu.separator(),
      menu.copy('Copy event #', evt.event_number),
      menu.copyId(evt.id),
      ...(evt.defendant_name ? [menu.copy('Copy defendant', evt.defendant_name, <User size={12} />)] : []),
      ...(evt.court_case_number ? [menu.copy('Copy case #', evt.court_case_number, <FileText size={12} />)] : []),
      menu.separator(),
      menu.action('Clone for continuance', () => handleCloneEvent(parseInt(String(evt.id))), { icon: <Copy size={12} /> }),
    ];
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
      // ?case_id= deep-link sets searchQuery to "case:<id>" so the param
      // is visible in the filter bar (operator can clear it) and routes to
      // the dedicated case_id= API filter rather than the text search.
      const caseIdMatch = searchQuery.match(/^case:(\d+)$/);
      const params = new URLSearchParams({
        page: String(page), limit: '50',
        ...(caseIdMatch ? { case_id: caseIdMatch[1] } : searchQuery ? { search: searchQuery } : {}),
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
  // Reset conflicts immediately when the selection changes so a previous
  // event's red banner doesn't ghost over a clean selection until the
  // fetch resolves.
  useEffect(() => {
    setConflicts([]);
    if (selected?.id) fetchConflicts(selected.id as any);
  }, [selected?.id, fetchConflicts]);
  useLiveSync('records', () => { fetchEvents({ silent: true }); fetchUpcoming(); });

  // Lookup-backed typeahead values (admin-managed under Admin → Court Tracker Lookups).
  // Failure is silent — the inputs degrade to free-text. Auth-gated; when the
  // user isn't logged in, lookups stay empty and the datalists are inert.
  const [lookups, setLookups] = useState<{ court: string[]; judge: string[]; prosecutor: string[]; defense: string[] }>({ court: [], judge: [], prosecutor: [], defense: [] });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cats: Array<keyof typeof lookups> = ['court', 'judge', 'prosecutor', 'defense'];
        const results = await Promise.all(cats.map(c =>
          apiFetch<any[]>(`/court/lookups?category=${c}`).catch(() => [])
        ));
        if (cancelled) return;
        const next: any = {};
        cats.forEach((c, i) => {
          const rows = Array.isArray(results[i]) ? results[i] : [];
          next[c] = rows
            .filter((r: any) => r.is_active !== 0 && r.is_active !== false)
            .map((r: any) => r.display_label || r.value)
            .filter(Boolean);
        });
        setLookups(next);
      } catch { /* lookups stay empty — datalists become inert, inputs are free-text */ }
    })();
    return () => { cancelled = true; };
  }, []);

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
      clearFormDraft();
      setFormOpen(false);
      setFormData({ ...EMPTY_FORM });
      setHistoricalEntry(false);
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
    const d = Math.ceil((parseTimestamp(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
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

  // Court-ready appearance prep PDF \u2014 wired from the detail toolbar.
  // The page already loaded the row, so this is a same-frame jsPDF
  // build with no extra fetch; the officer can hit "Print" and have
  // the docket+witnesses+judge-notes briefing in their hand before
  // they walk into court.
  const handlePrintCourtPdf = useCallback(() => {
    if (!selected) return;
    try {
      const preparedBy = user
        ? [user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email, user.badge_number ? `#${user.badge_number}` : '']
            .filter(Boolean)
            .join(' ')
        : undefined;
      openCourtAppearancePdf({
        id: selected.id,
        event_number: selected.event_number,
        event_type: selected.event_type,
        status: selected.status,
        event_date: selected.event_date,
        event_time: selected.event_time,
        court_name: selected.court_name,
        courtroom: selected.courtroom,
        judge_name: selected.judge_name,
        court_case_number: selected.court_case_number,
        defendant_name: selected.defendant_name,
        prosecutor: selected.prosecutor as any,
        defense_attorney: selected.defense_attorney,
        outcome: selected.outcome,
        sentence: selected.sentence,
        fine_amount: selected.fine_amount,
        notes: selected.notes,
        judge_notes: (selected as any).judge_notes,
        bail_amount: (selected as any).bail_amount,
        bond_status: (selected as any).bond_status,
        surety_info: (selected as any).surety_info,
        witnesses: (selected as any).witnesses,
        court_fees: (selected as any).court_fees,
        continuance_log: (selected as any).continuance_log,
        officers_required: (selected as any).officers_required,
        officer_confirmations: (selected as any).officer_confirmations,
        continuance_count: (selected as any).continuance_count,
        preparedBy,
      });
    } catch (err: any) {
      addToast(err?.message || 'Failed to generate PDF', 'error');
    }
  }, [selected, user, addToast]);

  // \u2500\u2500 ?event_id= / ?case_id= URL deep-link \u2500\u2500
  // ?event_id= (or ?court_event_id=) pre-selects a specific event.
  // ?case_id= switches to List view filtered to that case's events so
  // the operator arrives pre-scoped when navigating from Case Management.
  // Both params are stripped after hydration so a refresh doesn't re-run.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingEventIdRef = useRef<string | null>(
    searchParams.get('hearing_id') || searchParams.get('event_id') || searchParams.get('court_event_id')
  );
  const pendingCaseIdRef = useRef<string | null>(searchParams.get('case_id'));
  useEffect(() => {
    const caseTarget = pendingCaseIdRef.current;
    if (caseTarget) {
      pendingCaseIdRef.current = null;
      // Switch to list view with a case_id filter pre-applied so the
      // operator immediately sees only that case's court events.
      setActiveView('list');
      setSearchQuery(`case:${caseTarget}`);
      const next = new URLSearchParams(searchParams);
      next.delete('case_id');
      setSearchParams(next, { replace: true });
      return;
    }
    const target = pendingEventIdRef.current;
    if (!target) return;
    pendingEventIdRef.current = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ data: CourtEvent }>(`/court/events/${target}`);
        if (cancelled) return;
        const evt = (res?.data && (res.data as any).id != null) ? res.data : null;
        if (!evt) { addToast(`Court event ${target} not found`, 'warning'); return; }
        setSelected(evt);
      } catch {
        if (!cancelled) addToast(`Failed to load court event ${target}`, 'error');
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('hearing_id');
          next.delete('event_id');
          next.delete('court_event_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc smart-cascade \u2014 closes the smallest-open-first modal so a single
  // tap doesn't blow away the form draft if a nested confirm is showing.
  // Order matches "most-recently-opened-on-top". Replaces the old
  // hard-coded `setFormOpen(false)` that ignored every other modal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (cloneEventId != null) { e.stopPropagation(); setCloneEventId(null); return; }
      if (witnessOpen) { e.stopPropagation(); setWitnessOpen(false); return; }
      if (feeOpen) { e.stopPropagation(); setFeeOpen(false); return; }
      if (prosecutorOpen) { e.stopPropagation(); setProsecutorOpen(false); return; }
      if (judgeNotesOpen) { e.stopPropagation(); setJudgeNotesOpen(false); return; }
      if (bailOpen) { e.stopPropagation(); setBailOpen(false); return; }
      if (continuanceOpen) { e.stopPropagation(); setContinuanceOpen(false); return; }
      if (outcomeOpen) { e.stopPropagation(); setOutcomeOpen(false); return; }
      if (citationSearchOpen) { e.stopPropagation(); setCitationSearchOpen(false); return; }
      if (formOpen) { e.stopPropagation(); setFormOpen(false); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cloneEventId, witnessOpen, feeOpen, prosecutorOpen, judgeNotesOpen, bailOpen, continuanceOpen, outcomeOpen, citationSearchOpen, formOpen]);

  // "N" keyboard shortcut \u2192 opens the New Event modal, typing-suppressed
  // (skipped while focus is in any input/textarea/contenteditable). Same
  // contract used across MDT / Patrol / Field Interviews / Cases.
  // Only fires for admin/manager roles \u2014 read-only roles can't create events.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      // Don't open New on top of an already-open modal.
      if (formOpen || outcomeOpen || continuanceOpen || bailOpen || judgeNotesOpen ||
          prosecutorOpen || feeOpen || witnessOpen || citationSearchOpen || cloneEventId != null) return;
      if (!canManage) return;
      e.preventDefault();
      clearAllErrors();
      setFormData({ ...EMPTY_FORM });
      setFormOpen(true);
      snapshotForm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [formOpen, outcomeOpen, continuanceOpen, bailOpen, judgeNotesOpen, prosecutorOpen, feeOpen, witnessOpen, citationSearchOpen, cloneEventId, canManage, clearAllErrors, setFormData, snapshotForm]);

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* Left Panel */}
      <div className={`flex flex-col min-h-0 ${isMobile ? 'h-1/2' : 'w-[400px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Court / Legal Tracker" icon={Gavel}>
          <button
            type="button"
            className="toolbar-btn"
            disabled={events.length === 0}
            onClick={() => downloadTextFile('court-docket.csv', courtDocketToCsv(events.map((ev) => ({
              event_number: ev.event_number,
              event_type: ev.event_type,
              status: ev.status,
              event_date: ev.event_date,
              court_name: ev.court_name,
              court_case_number: ev.court_case_number,
            }))))}
          >CSV</button>
          {canManage && (
            <button type="button" onClick={() => setCitationSearchOpen(true)} className="toolbar-btn text-[10px]">
              <FileText style={{ width: 11, height: 11 }} /> From Citation
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => { clearAllErrors(); setFormData({ ...EMPTY_FORM }); setFormOpen(true); snapshotForm(); }} className="toolbar-btn toolbar-btn-primary print:hidden">
              <Plus style={{ width: 11, height: 11 }} /> New
            </button>
          )}
        </PanelTitleBar>

        {fetchError && (
          <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" /> <span>{fetchError}</span>
            <button type="button" className="toolbar-btn" onClick={() => { void fetchEvents(); }}>Retry</button>
            <IconButton onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300" aria-label="Dismiss error"><X style={{ width: 12, height: 12 }} /></IconButton>
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
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${activeView === tab.id ? 'text-rmpg-100 border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500'}`}
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
              <input id="ff-courttrackerpage-0" ref={searchRef} value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }} placeholder="Search events... (/)" aria-label="Search events..." className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 placeholder-rmpg-500 focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 outline-none" />
            </div>
            <select id="ff-courttrackerpage-1" value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none">
              <option value="">All Types</option>
              {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}

        {/* Feature 1: Calendar View */}
        {activeView === 'calendar' && (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent p-2">
            <div className="flex items-center justify-between mb-2">
              <IconButton onClick={() => { if (calendarMonth === 1) { setCalendarMonth(12); setCalendarYear(y => y - 1); } else setCalendarMonth(m => m - 1); }} className="toolbar-btn p-1" aria-label="Previous month">
                <ChevronLeft style={{ width: 14, height: 14 }} />
              </IconButton>
              <span className="text-xs font-bold text-rmpg-100">{monthNames[calendarMonth - 1]} {calendarYear}</span>
              <IconButton onClick={() => { if (calendarMonth === 12) { setCalendarMonth(1); setCalendarYear(y => y + 1); } else setCalendarMonth(m => m + 1); }} className="toolbar-btn p-1" aria-label="Next month">
                <ChevronRight style={{ width: 14, height: 14 }} />
              </IconButton>
            </div>
            <div className="grid grid-cols-7 gap-px">
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                <div key={d} className="text-[8px] text-rmpg-500 text-center py-1 font-bold">{d}</div>
              ))}
              {calendarDays.map((day, idx) => {
                const dateStr = day ? `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                const dayEvents = dateStr ? (calendarData[dateStr] || []) : [];
                const isToday = dateStr === localToday();
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
                              <div key={e.id} className={`w-full text-[7px] px-0.5 truncate ${EVENT_TYPE_COLORS[e.event_type] || 'text-rmpg-100'}`}>
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
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent p-3 space-y-3">
            {statsLoading ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading...</span></div>
            ) : stats ? (
              <>
                {/* Totals */}
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-2">Overview (Last 12 Months)</div>
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
                        <div className="text-sm font-bold text-rmpg-100">{val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By Outcome */}
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-2">Outcomes</div>
                  {(stats.byOutcome || []).map((r: any) => (
                    <div key={r.outcome} className="flex items-center justify-between py-1 border-b border-rmpg-800 last:border-0">
                      <span className="text-[10px] text-rmpg-300">{toDisplayLabel(r.outcome || '').toUpperCase()}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-rmpg-800 overflow-hidden">
                          <div
                            className="h-full bg-brand-500"
                            style={{ width: `${Math.min(100, (r.count / Math.max(1, stats.totals?.total || 1)) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-rmpg-100 w-6 text-right">{r.count}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* By Type */}
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-2">By Event Type</div>
                  {(stats.byType || []).map((r: any) => (
                    <div key={r.event_type} className="flex items-center justify-between py-1 border-b border-rmpg-800 last:border-0">
                      <span className={`text-[10px] px-1.5 py-0.5 border ${EVENT_TYPE_COLORS[r.event_type] || ''}`}>
                        {formatEnumValue(r.event_type)}
                      </span>
                      <span className="text-[10px] font-bold text-rmpg-100">{r.count}</span>
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
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
            {loading && activeView === 'list' ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading...</span></div>
            ) : displayEvents.length === 0 ? (
              // Distinguish "no court events anywhere yet" from "your
              // filter/search returned nothing" so the operator doesn't
              // hit "New Event" when they actually wanted to clear a
              // filter. Active-filter / search / non-upcoming-tab cases
              // each get their own copy + CTA.
              (() => {
                const hasFilter = activeView === 'list' && (searchQuery.trim() !== '' || filterType !== '');
                if (hasFilter) {
                  return (
                    <EmptyState
                      icon={Search}
                      title="No matches"
                      description="No court events match the current search or filter."
                      action={{ label: 'Clear filters', onClick: () => { setSearchQuery(''); setFilterType(''); setPage(1); } }}
                    />
                  );
                }
                if (activeView === 'upcoming') {
                  return (
                    <EmptyState
                      icon={Calendar}
                      title="No upcoming court dates"
                      description="No events scheduled in the next 30 days. New events with future dates land here automatically."
                      action={canManage ? { label: 'New Event', onClick: () => { clearAllErrors(); setFormData({ ...EMPTY_FORM }); setFormOpen(true); snapshotForm(); } } : undefined}
                    />
                  );
                }
                return (
                  <EmptyState
                    icon={Scale}
                    title="No court events"
                    description={canManage ? 'Create a new court event, or pull one from a citation, to get started.' : 'No court events on record.'}
                    action={canManage ? { label: 'New Event', onClick: () => { clearAllErrors(); setFormData({ ...EMPTY_FORM }); setFormOpen(true); snapshotForm(); } } : undefined}
                  />
                );
              })()
            ) : (
              displayEvents.map(evt => {
                const countdown = evt.event_date ? daysUntil(evt.event_date) : { text: '-', color: 'text-rmpg-500' };
                return (
                  <button type="button"
                    key={evt.id}
                    onClick={() => setSelected(evt)}
                    onContextMenu={(e) => openMenu(e, buildEventMenu(evt))}
                    aria-label={`Court event ${evt.event_number}`}
                    className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-colors ${
                      selected?.id === evt.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-rmpg-100">{evt.event_number}</span>
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
      <div className="flex-1 min-h-0 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`${selected.event_number} -- ${EVENT_TYPES.find(t => t.value === selected.event_type)?.label}`} icon={Gavel}>
              {/* Court-ready appearance prep PDF (v1037) — Arial banner +
                  judge notes + witnesses + bail + countdown; the artifact
                  the officer carries into court. */}
              <button type="button" onClick={handlePrintCourtPdf} className="toolbar-btn text-[10px]" title="Print court appearance prep PDF">
                <Printer style={{ width: 11, height: 11 }} /> Print PDF
              </button>
              {/* Feature 5: Confirm attendance */}
              {selected.status !== 'completed' && !editingHeader && (
                <button type="button" onClick={handleConfirmAttendance} className="toolbar-btn text-[10px]" title="Confirm your attendance">
                  <Check style={{ width: 11, height: 11 }} /> Confirm
                </button>
              )}
              {/* Feature 3: Continuance — admin/manager only */}
              {canManage && selected.status !== 'completed' && (
                <button type="button" onClick={() => { setContinuanceData({ reason: '', new_date: '', new_time: '' }); setContinuanceOpen(true); }} className="toolbar-btn text-[10px]">
                  <RefreshCw style={{ width: 11, height: 11 }} /> Continuance
                </button>
              )}
              {/* Feature 4: Outcome — admin/manager only */}
              {canManage && selected.status !== 'completed' && (
                <button type="button" onClick={() => { setOutcomeData({ outcome: '', sentence: '', fine_amount: '' }); setOutcomeOpen(true); }} className="toolbar-btn toolbar-btn-primary print:hidden">
                  <CheckCircle style={{ width: 11, height: 11 }} /> Record Outcome
                </button>
              )}
            </PanelTitleBar>

            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent p-4 space-y-4">
              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border rounded-sm font-bold ${EVENT_TYPE_COLORS[selected.event_type] || ''}`}>
                  {selected.event_type.toUpperCase()}
                </span>
                <span className={`text-[10px] px-2 py-1 border rounded-sm font-bold ${STATUS_COLORS[selected.status] || ''}`}>
                  {formatEnumValue(selected.status)}
                </span>
                {selected.outcome && (
                  <span className="text-[10px] px-2 py-1 border rounded-sm bg-purple-900/50 text-purple-400 border-purple-700/50 font-bold">
                    {toDisplayLabel(selected.outcome).toUpperCase()}
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
                    <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider">{label}</div>
                    <div className="text-xs text-rmpg-100 mt-0.5">{value || '--'}</div>
                  </div>
                ))}
                <div className="text-[10px] text-rmpg-500">
                  Tip: dropdown values for Court / Judge / Prosecutor / Defense Attorney are admin-managed under Admin → Court Tracker Lookups.
                </div>
              </div>

              {/* Feature 6: Bail/Bond Info */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider flex items-center gap-1">
                    <DollarSign style={{ width: 10, height: 10 }} /> Bail / Bond
                  </div>
                  {canManage && (
                    <button type="button" onClick={() => {
                      setBailData({
                        bail_amount: (selected as any).bail_amount || '',
                        bond_status: (selected as any).bond_status || '',
                        surety_info: (selected as any).surety_info || '',
                      });
                      setBailOpen(true);
                    }} className="toolbar-btn text-[9px]">Edit</button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><span className="text-[9px] text-rmpg-500">Amount:</span> <span className="text-xs text-rmpg-100">{(selected as any).bail_amount ? `$${Number((selected as any).bail_amount).toLocaleString()}` : '--'}</span></div>
                  <div><span className="text-[9px] text-rmpg-500">Status:</span> <span className="text-xs text-rmpg-100">{(selected as any).bond_status || '--'}</span></div>
                  <div><span className="text-[9px] text-rmpg-500">Surety:</span> <span className="text-xs text-rmpg-100">{(selected as any).surety_info || '--'}</span></div>
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
                    <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-2 flex items-center gap-1">
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
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider flex items-center gap-1">
                    <BookOpen style={{ width: 10, height: 10 }} /> Judge Preferences / Notes
                  </div>
                  {canManage && (
                    <button type="button" onClick={() => { setJudgeNotesText((selected as any).judge_notes || ''); setJudgeNotesOpen(true); }} className="toolbar-btn text-[9px]">Edit</button>
                  )}
                </div>
                <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{(selected as any).judge_notes || 'No notes recorded.'}</div>
              </div>

              {/* Feature 7: Court documents */}
              <div className="panel-beveled p-3">
                <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <FileText style={{ width: 10, height: 10 }} /> Court Documents
                </div>
                {(() => {
                  let docs: any[] = [];
                  try { docs = JSON.parse((selected as any).documents || '[]'); } catch { /* invalid JSON */ }
                  if (!Array.isArray(docs) || docs.length === 0) return <div className="text-[10px] text-rmpg-500">No documents uploaded.</div>;
                  return docs.map((d: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-rmpg-800 last:border-0">
                      <FileText style={{ width: 10, height: 10 }} className="text-brand-400" />
                      <span className="text-[10px] text-rmpg-100">{d.file_name}</span>
                      <span className="text-[9px] text-rmpg-500">{formatEnumValue(d.doc_type)}</span>
                    </div>
                  ));
                })()}
              </div>

              {/* Feature 7: Prosecutor Contact Info */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider flex items-center gap-1">
                    <User style={{ width: 10, height: 10 }} /> Prosecutor Contact
                  </div>
                  {canManage && (
                    <button type="button" onClick={() => {
                      const parsed = (() => { try { return JSON.parse(selected.prosecutor || '{}'); } catch { return { name: selected.prosecutor || '' }; } })();
                      setProsecutorData({ prosecutor_name: parsed.name || '', prosecutor_phone: parsed.phone || '', prosecutor_email: parsed.email || '' });
                      setProsecutorOpen(true);
                    }} className="toolbar-btn text-[9px]">Edit</button>
                  )}
                </div>
                {(() => {
                  try {
                    const p = JSON.parse(selected.prosecutor || '{}');
                    return (
                      <div className="grid grid-cols-3 gap-2">
                        <div><span className="text-[9px] text-rmpg-500">Name:</span> <span className="text-xs text-rmpg-100">{p.name || '--'}</span></div>
                        <div><span className="text-[9px] text-rmpg-500">Phone:</span> <span className="text-xs text-rmpg-100">{p.phone || '--'}</span></div>
                        <div><span className="text-[9px] text-rmpg-500">Email:</span> <span className="text-xs text-rmpg-100">{p.email || '--'}</span></div>
                      </div>
                    );
                  } catch { return <div className="text-xs text-rmpg-300">{selected.prosecutor || '--'}</div>; }
                })()}
              </div>

              {/* Feature 8b: Court Fee Tracking */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider flex items-center gap-1">
                    <DollarSign style={{ width: 10, height: 10 }} /> Court Fees
                  </div>
                  {canManage && (
                    <button type="button" onClick={() => {
                      let fees: any = {};
                      try { fees = JSON.parse((selected as any).court_fees || '{}'); } catch { /* invalid JSON */ }
                      setFeeData({ filing_fee: fees.filing_fee || '', service_fee: fees.service_fee || '', other_fees: fees.other_fees || '', fee_notes: fees.fee_notes || '' });
                      setFeeOpen(true);
                    }} className="toolbar-btn text-[9px]">Edit</button>
                  )}
                </div>
                {(() => {
                  let fees: any = {};
                  try { fees = JSON.parse((selected as any).court_fees || '{}'); } catch { /* invalid JSON */ }
                  // The save modal stores values as strings (input
                  // type=number still emits a string). Without explicit
                  // Number() coercion the "total" line concatenated
                  // strings ("50" + "25" = "5025") instead of summing.
                  const filing = Number(fees.filing_fee ?? 0) || 0;
                  const service = Number(fees.service_fee ?? 0) || 0;
                  const other = Number(fees.other_fees ?? 0) || 0;
                  const total = filing + service + other;
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div><span className="text-[9px] text-rmpg-500">Filing:</span> <span className="text-xs text-rmpg-100">{filing > 0 ? `$${filing.toFixed(2)}` : '--'}</span></div>
                      <div><span className="text-[9px] text-rmpg-500">Service:</span> <span className="text-xs text-rmpg-100">{service > 0 ? `$${service.toFixed(2)}` : '--'}</span></div>
                      <div><span className="text-[9px] text-rmpg-500">Other:</span> <span className="text-xs text-rmpg-100">{other > 0 ? `$${other.toFixed(2)}` : '--'}</span></div>
                      <div><span className="text-[9px] text-rmpg-500 font-bold">Total:</span> <span className="text-xs text-brand-300 font-bold">{total > 0 ? `$${total.toFixed(2)}` : '--'}</span></div>
                    </div>
                  );
                })()}
              </div>

              {/* Feature 9: Witness List */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider flex items-center gap-1">
                    <Users style={{ width: 10, height: 10 }} /> Witnesses
                  </div>
                  {canManage && (
                    <button type="button" onClick={() => {
                      try { setWitnesses(JSON.parse((selected as any).witnesses || '[]')); } catch { setWitnesses([]); }
                      setWitnessOpen(true);
                    }} className="toolbar-btn text-[9px]">Manage</button>
                  )}
                </div>
                {(() => {
                  let w: any[] = [];
                  try { w = JSON.parse((selected as any).witnesses || '[]'); } catch { /* invalid JSON */ }
                  if (w.length === 0) return <div className="text-[10px] text-rmpg-500">No witnesses recorded.</div>;
                  return w.map((wit: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-rmpg-800 last:border-0">
                      <span className={`w-2 h-2 rounded-full ${wit.contact_status === 'confirmed' ? 'bg-green-500' : wit.contact_status === 'contacted' ? 'bg-amber-500' : 'bg-rmpg-600'}`} />
                      <span className="text-[10px] text-rmpg-100 flex-1">{wit.name}</span>
                      <span className="text-[9px] text-rmpg-500">{toDisplayLabel(wit.role)}</span>
                      <span className="text-[9px] text-rmpg-600">{toDisplayLabel(wit.contact_status)}</span>
                    </div>
                  ));
                })()}
              </div>

              {/* Feature 10b: Clone Event + Feature 6: Reminders — admin/manager only */}
              {canManage && (
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
              )}

              {/* Feature 3: Continuance log */}
              {(() => {
                let log: any[] = [];
                try { log = JSON.parse((selected as any).continuance_log || '[]'); } catch { /* invalid JSON */ }
                if (log.length === 0) return null;
                return (
                  <div className="panel-beveled p-3">
                    <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-2">Continuance History</div>
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
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-2">Outcome</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><span className="text-[9px] text-rmpg-500">Verdict:</span> <span className="text-xs text-rmpg-100 font-bold">{toDisplayLabel(selected.outcome)}</span></div>
                    {selected.sentence && <div><span className="text-[9px] text-rmpg-500">Sentence:</span> <span className="text-xs text-rmpg-100">{selected.sentence}</span></div>}
                    {selected.fine_amount && !isNaN(Number(selected.fine_amount)) && <div><span className="text-[9px] text-rmpg-500">Fine:</span> <span className="text-xs text-amber-400">${Number(selected.fine_amount).toFixed(2)}</span></div>}
                  </div>
                </div>
              )}

              {selected.notes && (
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-1">Notes</div>
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
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="New Court Event">
          <div className="panel-surface w-full max-w-lg mx-4 my-auto">
            <PanelTitleBar title="New Court Event" icon={Plus}>
              <div className="flex items-center gap-2">
                {formIsDirty && (
                  <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">UNSAVED</span>
                )}
                <IconButton onClick={() => { clearFormDraft(); setFormOpen(false); }} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
              </div>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              {formWasRestored && (
                <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30 bg-amber-950/40">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-amber-400" />
                    <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
                  </div>
                  <button type="button" onClick={clearFormDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">
                    Discard
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-courttrackerpage-2" className="field-label">Type</label>
                  <select id="ff-courttrackerpage-2" value={formData.event_type} onChange={e => setFormData(p => ({ ...p, event_type: e.target.value as CourtEventType }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600">
                    {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-courttrackerpage-3" className="field-label">Date *</label>
                  <input id="ff-courttrackerpage-3" type="date" value={formData.event_date} onChange={e => setFormData(p => ({ ...p, event_date: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-rmpg-100 outline-none ${formErrors.event_date ? 'border-red-500' : 'border-rmpg-700'}`} />
                  {formErrors.event_date && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.event_date}</p>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="ff-courttrackerpage-4" className="field-label">Time</label>
                  <input id="ff-courttrackerpage-4" type="time" value={formData.event_time} onChange={e => setFormData(p => ({ ...p, event_time: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                </div>
                <div>
                  <label htmlFor="ff-courttrackerpage-5" className="field-label">Court *</label>
                  <input id="ff-courttrackerpage-5" value={formData.court_name} onChange={e => setFormData(p => ({ ...p, court_name: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-rmpg-100 outline-none ${formErrors.court_name ? 'border-red-500' : 'border-rmpg-700'}`} />
                  {formErrors.court_name && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.court_name}</p>}
                </div>
                <div>
                  <label htmlFor="ff-courttrackerpage-6" className="field-label">Courtroom</label>
                  <input id="ff-courttrackerpage-6" value={formData.courtroom} onChange={e => setFormData(p => ({ ...p, courtroom: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-courttrackerpage-7" className="field-label">Defendant Name</label>
                  <input id="ff-courttrackerpage-7" value={formData.defendant_name} onChange={e => setFormData(p => ({ ...p, defendant_name: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                </div>
                <div>
                  <label htmlFor="ff-courttrackerpage-8" className="field-label">Judge</label>
                  <input id="ff-courttrackerpage-8" value={formData.judge_name} onChange={e => setFormData(p => ({ ...p, judge_name: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                </div>
                <div>
                  <label htmlFor="ff-courttrackerpage-9" className="field-label">Prosecutor</label>
                  <input id="ff-courttrackerpage-9" value={formData.prosecutor} onChange={e => setFormData(p => ({ ...p, prosecutor: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                </div>
                <div>
                  <label htmlFor="ff-courttrackerpage-10" className="field-label">Defense Attorney</label>
                  <input id="ff-courttrackerpage-10" value={formData.defense_attorney} onChange={e => setFormData(p => ({ ...p, defense_attorney: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => { clearFormDraft(); setFormOpen(false); }} className="toolbar-btn">Cancel</button>
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
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Record Outcome">
          <div className="panel-surface w-full max-w-md mx-4 my-auto">
            <PanelTitleBar title="Record Outcome" icon={CheckCircle}>
              <IconButton onClick={() => setOutcomeOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="ff-courttrackerpage-11" className="field-label">Outcome *</label>
                <select id="ff-courttrackerpage-11" value={outcomeData.outcome} onChange={e => setOutcomeData(p => ({ ...p, outcome: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600">
                  <option value="">Select outcome...</option>
                  {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ff-courttrackerpage-26" className="field-label">Sentence</label>
                <RichTextArea value={outcomeData.sentence} onChange={e => setOutcomeData(p => ({ ...p, sentence: e.target.value }))} rows={2} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600 resize-none" />
              </div>
              <div>
                <label htmlFor="ff-courttrackerpage-12" className="field-label">Fine Amount ($)</label>
                <input id="ff-courttrackerpage-12" value={outcomeData.fine_amount} onChange={e => setOutcomeData(p => ({ ...p, fine_amount: e.target.value }))} type="number" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
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
              <IconButton onClick={() => setContinuanceOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="ff-courttrackerpage-25" className="field-label">Reason *</label>
                <RichTextArea value={continuanceData.reason} onChange={e => setContinuanceData(p => ({ ...p, reason: e.target.value }))} rows={2} placeholder="Reason for continuance..." className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-courttrackerpage-13" className="field-label">New Date</label>
                  <input id="ff-courttrackerpage-13" type="date" value={continuanceData.new_date} onChange={e => setContinuanceData(p => ({ ...p, new_date: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                </div>
                <div>
                  <label htmlFor="ff-courttrackerpage-14" className="field-label">New Time</label>
                  <input id="ff-courttrackerpage-14" type="time" value={continuanceData.new_time} onChange={e => setContinuanceData(p => ({ ...p, new_time: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
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
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Bail/Bond Info">
          <div className="panel-surface w-full max-w-md mx-4 my-auto">
            <PanelTitleBar title="Bail / Bond Information" icon={DollarSign}>
              <IconButton onClick={() => setBailOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="ff-courttrackerpage-15" className="field-label">Bail Amount ($)</label>
                <input id="ff-courttrackerpage-15" type="number" value={bailData.bail_amount} onChange={e => setBailData(p => ({ ...p, bail_amount: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
              </div>
              <div>
                <label htmlFor="ff-courttrackerpage-16" className="field-label">Bond Status</label>
                <select id="ff-courttrackerpage-16" value={bailData.bond_status} onChange={e => setBailData(p => ({ ...p, bond_status: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600">
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
                <label htmlFor="ff-courttrackerpage-17" className="field-label">Surety Info</label>
                <input id="ff-courttrackerpage-17" value={bailData.surety_info} onChange={e => setBailData(p => ({ ...p, surety_info: e.target.value }))} placeholder="Bonding company, etc." className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
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
              <IconButton onClick={() => setJudgeNotesOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <RichTextArea value={judgeNotesText} onChange={e => setJudgeNotesText(e.target.value)} rows={6} placeholder="Judge preferences, courtroom rules, etc." className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600 resize-none" />
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
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-md mx-4 my-auto">
            <PanelTitleBar title="Prosecutor Contact Info" icon={User}>
              <IconButton onClick={() => setProsecutorOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div><label htmlFor="ff-courttrackerpage-18" className="field-label">Name</label>
                <input id="ff-courttrackerpage-18" value={prosecutorData.prosecutor_name} onChange={e => setProsecutorData(p => ({ ...p, prosecutor_name: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
              <div><label htmlFor="ff-courttrackerpage-19" className="field-label">Phone</label>
                <input id="ff-courttrackerpage-19" value={prosecutorData.prosecutor_phone} onChange={e => setProsecutorData(p => ({ ...p, prosecutor_phone: formatPhoneInput(e.target.value) }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" placeholder="(555) 123-4567" /></div>
              <div><label htmlFor="ff-courttrackerpage-20" className="field-label">Email</label>
                <input id="ff-courttrackerpage-20" type="email" value={prosecutorData.prosecutor_email} onChange={e => setProsecutorData(p => ({ ...p, prosecutor_email: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
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
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-md mx-4 my-auto">
            <PanelTitleBar title="Court Fee Tracking" icon={DollarSign}>
              <IconButton onClick={() => setFeeOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div><label htmlFor="ff-courttrackerpage-21" className="field-label">Filing Fee ($)</label>
                <input id="ff-courttrackerpage-21" type="number" step="0.01" value={feeData.filing_fee} onChange={e => setFeeData(p => ({ ...p, filing_fee: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
              <div><label htmlFor="ff-courttrackerpage-22" className="field-label">Service Fee ($)</label>
                <input id="ff-courttrackerpage-22" type="number" step="0.01" value={feeData.service_fee} onChange={e => setFeeData(p => ({ ...p, service_fee: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
              <div><label htmlFor="ff-courttrackerpage-23" className="field-label">Other Fees ($)</label>
                <input id="ff-courttrackerpage-23" type="number" step="0.01" value={feeData.other_fees} onChange={e => setFeeData(p => ({ ...p, other_fees: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
              <div><label htmlFor="ff-courttrackerpage-24" className="field-label">Notes</label>
                <RichTextArea value={feeData.fee_notes} onChange={e => setFeeData(p => ({ ...p, fee_notes: e.target.value }))} rows={2} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600 resize-none" /></div>
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
              <IconButton onClick={() => setWitnessOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent space-y-2">
                {/* IDs stripped from the mapped inputs (was emitting the
                    same `id` for every witness row, fails HTML5 unique-id
                    rule + breaks accessibility tools). aria-label keeps
                    each input identifiable. */}
                {witnesses.map((w, i) => (
                  <div key={i} className="panel-beveled p-2 space-y-1">
                    <div className="flex gap-2">
                      <input value={w.name} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, name: e.target.value } : ww))} placeholder="Name" aria-label={`Witness ${i + 1} name`} className="flex-1 px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                      <select value={w.contact_status} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, contact_status: e.target.value } : ww))} aria-label={`Witness ${i + 1} contact status`} className="px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600">
                        <option value="pending">Pending</option>
                        <option value="contacted">Contacted</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="unavailable">Unavailable</option>
                      </select>
                      <IconButton onClick={() => setWitnesses(ws => ws.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300" aria-label={`Remove witness ${i + 1}`}><X style={{ width: 12, height: 12 }} /></IconButton>
                    </div>
                    <div className="flex gap-2">
                      <input value={w.phone || ''} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, phone: formatPhoneInput(e.target.value) } : ww))} placeholder="Phone" aria-label={`Witness ${i + 1} phone`} className="flex-1 px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                      <input value={w.email || ''} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, email: e.target.value } : ww))} placeholder="Email" aria-label={`Witness ${i + 1} email`} className="flex-1 px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                      <input value={w.role || ''} onChange={e => setWitnesses(ws => ws.map((ww, j) => j === i ? { ...ww, role: e.target.value } : ww))} placeholder="Role" aria-label={`Witness ${i + 1} role`} className="w-24 px-2 py-1 w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
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
              <IconButton onClick={() => setCitationSearchOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input id="ff-courttrackerpage-29" value={citationSearchQ} onChange={e => setCitationSearchQ(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearchCitations()}
                  placeholder="Search by citation number, name, or statute..." aria-label="Search by citation number, name, or statute..."
                  className="flex-1 px-2 py-1.5 w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                <button type="button" onClick={handleSearchCitations} disabled={citationSearching} className="toolbar-btn toolbar-btn-primary text-[10px] px-3">
                  {citationSearching ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Search style={{ width: 11, height: 11 }} />}
                  Search
                </button>
              </div>
              {citationSearchResults.length > 0 ? (
                <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent space-y-1">
                  {citationSearchResults.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 border border-rmpg-700 bg-surface-sunken hover:bg-rmpg-800/50">
                      <div>
                        <div className="text-[11px] font-mono font-bold text-rmpg-100">{c.citation_number}</div>
                        <div className="text-[10px] text-rmpg-300">{c.person_name || 'Unknown'} -- {c.statute_citation || c.violation_description || ''}</div>
                        <div className="text-[9px] text-rmpg-500">{c.court_date ? `Court: ${c.court_date}` : 'No court date'} {c.court_name ? `at ${c.court_name}` : ''}</div>
                      </div>
                      <button type="button" onClick={() => handleCreateFromCitation(c.id)} disabled={creatingFromCitation} className="toolbar-btn toolbar-btn-primary text-[10px] px-2 py-1 flex-shrink-0">
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

      {/* Clone-for-continuance modal — replaces window.prompt() (v1037).
          Uses ConfirmDialog so it inherits a11y + focus-trap + Esc-close,
          and renders a proper date input inside `details` (the dialog
          supports rich children). */}
      <ConfirmDialog
        isOpen={cloneEventId != null}
        onClose={() => { setCloneEventId(null); setCloneDate(''); }}
        onConfirm={confirmCloneEvent}
        title="Clone for Continuance"
        message="Pick the new court date. The original event keeps its history; the clone gets a new event #."
        details={
          <div className="mt-3">
            <label className="field-label" htmlFor="ff-courttrackerpage-clone-date">New date *</label>
            <input
              id="ff-courttrackerpage-clone-date"
              type="date"
              value={cloneDate}
              onChange={e => setCloneDate(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600"
              autoFocus
            />
          </div>
        }
        confirmLabel={cloneSubmitting ? 'Cloning…' : 'Clone Event'}
        confirmVariant="default"
        isLoading={cloneSubmitting}
        confirmDisabled={!cloneDate || !/^\d{4}-\d{2}-\d{2}$/.test(cloneDate)}
      />

      <UnsavedChangesGuard hasUnsavedChanges={formOpen && formIsDirty} />
      <FloatingSaveBar
        visible={formOpen && formIsDirty}
        onSave={handleCreate}
        onCancel={() => { clearFormDraft(); setFormOpen(false); }}
        isSaving={submitting}
        saveLabel="Create Event"
      />
    </div>
  );
}
