import React, { useState, useEffect, useCallback } from 'react';
import {
  Gavel,
  Plus,
  Search,
  Loader2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  User,
  MapPin,
  FileText,
  Scale,
  X,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
  Briefcase,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { formatDate, formatDateTime } from '../utils/dateUtils';

// ============================================================
// Types
// ============================================================

interface CourtEvent {
  id: number;
  event_number: string;
  event_type: string;
  status: string;
  event_date: string;
  event_time: string | null;
  court_name: string | null;
  courtroom: string | null;
  judge_name: string | null;
  court_case_number: string | null;
  citation_id: number | null;
  incident_id: number | null;
  case_id: number | null;
  defendant_person_id: number | null;
  defendant_name: string | null;
  defendant_full_name: string | null;
  prosecutor: string | null;
  defense_attorney: string | null;
  officers_required: string | null;
  notes: string | null;
  outcome: string | null;
  sentence: string | null;
  fine_amount: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ============================================================
// Constants
// ============================================================

const EVENT_TYPES = [
  { value: 'arraignment', label: 'Arraignment' },
  { value: 'preliminary_hearing', label: 'Preliminary Hearing' },
  { value: 'trial', label: 'Trial' },
  { value: 'sentencing', label: 'Sentencing' },
  { value: 'motion_hearing', label: 'Motion Hearing' },
  { value: 'status_conference', label: 'Status Conference' },
  { value: 'plea_hearing', label: 'Plea Hearing' },
  { value: 'probation_hearing', label: 'Probation Hearing' },
  { value: 'appeal', label: 'Appeal' },
  { value: 'subpoena', label: 'Subpoena' },
  { value: 'other', label: 'Other' },
];

const STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'continued', label: 'Continued' },
  { value: 'completed', label: 'Completed' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'convicted', label: 'Convicted' },
];

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  continued: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  completed: 'bg-green-900/50 text-green-400 border-green-700/50',
  dismissed: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  convicted: 'bg-red-900/50 text-red-400 border-red-700/50',
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  scheduled: Clock,
  continued: AlertTriangle,
  completed: CheckCircle,
  dismissed: XCircle,
  convicted: Scale,
};

const OUTCOMES = [
  { value: 'guilty', label: 'Guilty' },
  { value: 'not_guilty', label: 'Not Guilty' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'plea_deal', label: 'Plea Deal' },
  { value: 'continued', label: 'Continued' },
  { value: 'mistrial', label: 'Mistrial' },
  { value: 'deferred', label: 'Deferred' },
];

function eventTypeLabel(val: string): string {
  return EVENT_TYPES.find(t => t.value === val)?.label || val.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ============================================================
const timeAgo = (date: string) => {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// Component
// ============================================================

export default function CourtRecordsPage() {
  // ── Data state ──
  const [events, setEvents] = useState<CourtEvent[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Filter state ──
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // ── UI state ──
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOutcomeModal, setShowOutcomeModal] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // ── UPGRADE: Verdict, Subpoena, Compliance, Links ──
  const [showVerdictModal, setShowVerdictModal] = useState<number | null>(null);
  const [verdictForm, setVerdictForm] = useState({
    verdict: '', sentence_type: '', sentence_details: '', fine_amount: '',
    probation_length: '', jail_time: '', community_service_hours: '', appeal_deadline: '',
  });
  const [showSubpoenaModal, setShowSubpoenaModal] = useState(false);
  const [subpoenaForm, setSubpoenaForm] = useState({
    officer_id: '', hearing_date: '', hearing_time: '', court_name: '',
    court_case_number: '', served_date: '', served_method: '',
  });
  const [complianceData, setComplianceData] = useState<any>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [showCompliancePanel, setShowCompliancePanel] = useState(false);
  const [linkedRecords, setLinkedRecords] = useState<any>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [showLinksPanel, setShowLinksPanel] = useState(false);
  const [reminderResult, setReminderResult] = useState<string | null>(null);

  // ── Create form state ──
  const [formData, setFormData] = useState({
    event_type: '',
    event_date: '',
    event_time: '',
    court_name: '',
    courtroom: '',
    judge_name: '',
    court_case_number: '',
    defendant_name: '',
    prosecutor: '',
    defense_attorney: '',
    notes: '',
  });

  // ── Outcome form state ──
  const [outcomeData, setOutcomeData] = useState({
    outcome: '',
    sentence: '',
    fine_amount: '',
    notes: '',
  });

  // ── Fetch events ──
  const fetchEvents = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('event_type', typeFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (searchTerm) params.set('search', searchTerm);

      const res = await apiFetch<{ data: CourtEvent[]; pagination: Pagination }>(
        `/court/events?${params.toString()}`
      );
      setEvents(res.data);
      setPagination(res.pagination);
    } catch (err: any) {
      setError(err.message || 'Failed to load court events');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, dateFrom, dateTo, searchTerm]);

  useEffect(() => {
    fetchEvents(1);
  }, [fetchEvents]);

  // ── Search on Enter ──
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setSearchTerm(searchInput);
    }
  };

  // ── UPGRADE: Verdict Handler ──
  const handleVerdict = async () => {
    if (!showVerdictModal || !verdictForm.verdict) return;
    setSaving(true);
    try {
      await apiFetch(`/court/events/${showVerdictModal}/verdict`, {
        method: 'PUT',
        body: JSON.stringify({
          ...verdictForm,
          fine_amount: verdictForm.fine_amount ? parseFloat(verdictForm.fine_amount) : undefined,
          community_service_hours: verdictForm.community_service_hours ? parseInt(verdictForm.community_service_hours) : undefined,
        }),
      });
      setShowVerdictModal(null);
      setVerdictForm({ verdict: '', sentence_type: '', sentence_details: '', fine_amount: '', probation_length: '', jail_time: '', community_service_hours: '', appeal_deadline: '' });
      fetchEvents(pagination.page);
    } catch { /* silent */ } finally { setSaving(false); }
  };

  // ── UPGRADE: Subpoena Handler ──
  const handleSubpoena = async () => {
    if (!subpoenaForm.officer_id || !subpoenaForm.hearing_date) return;
    setSaving(true);
    try {
      await apiFetch('/court/subpoenas', {
        method: 'POST',
        body: JSON.stringify(subpoenaForm),
      });
      setShowSubpoenaModal(false);
      setSubpoenaForm({ officer_id: '', hearing_date: '', hearing_time: '', court_name: '', court_case_number: '', served_date: '', served_method: '' });
      fetchEvents(pagination.page);
    } catch { /* silent */ } finally { setSaving(false); }
  };

  // ── UPGRADE: Generate Reminders ──
  const handleGenerateReminders = async (type: '1day' | '7day') => {
    try {
      const endpoint = type === '7day' ? '/court/events/generate-7day-reminders' : '/court/events/generate-reminders';
      const res = await apiFetch<any>(endpoint, { method: 'POST' });
      setReminderResult(`Sent ${res.reminders_sent || 0} ${type} reminders for ${res.events_tomorrow || res.events_in_7_days || 0} events`);
      setTimeout(() => setReminderResult(null), 5000);
    } catch { setReminderResult('Failed to send reminders'); }
  };

  // ── UPGRADE: Compliance Rate ──
  const fetchCompliance = async () => {
    setComplianceLoading(true);
    try {
      const res = await apiFetch<any>('/court/compliance-rate');
      setComplianceData(res?.data || null);
    } catch { setComplianceData(null); } finally { setComplianceLoading(false); }
  };

  // ── UPGRADE: Linked Records ──
  const fetchLinkedRecords = async (eventId: number) => {
    setLinksLoading(true);
    try {
      const res = await apiFetch<any>(`/court/events/${eventId}/linked-records`);
      setLinkedRecords(res?.data || null);
    } catch { setLinkedRecords(null); } finally { setLinksLoading(false); }
  };

  // ── Create event ──
  const handleCreate = async () => {
    if (!formData.event_type || !formData.event_date) return;
    setSaving(true);
    try {
      await apiFetch('/court/events', {
        method: 'POST',
        body: JSON.stringify(formData),
      });
      setShowCreateModal(false);
      setFormData({
        event_type: '', event_date: '', event_time: '', court_name: '',
        courtroom: '', judge_name: '', court_case_number: '', defendant_name: '',
        prosecutor: '', defense_attorney: '', notes: '',
      });
      fetchEvents(pagination.page);
    } catch (err: any) {
      setError(err.message || 'Failed to create court event');
    } finally {
      setSaving(false);
    }
  };

  // ── Record outcome ──
  const handleOutcome = async () => {
    if (!outcomeData.outcome || showOutcomeModal === null) return;
    setSaving(true);
    try {
      await apiFetch(`/court/events/${showOutcomeModal}/outcome`, {
        method: 'PUT',
        body: JSON.stringify({
          ...outcomeData,
          fine_amount: outcomeData.fine_amount ? parseFloat(outcomeData.fine_amount) : null,
        }),
      });
      setShowOutcomeModal(null);
      setOutcomeData({ outcome: '', sentence: '', fine_amount: '', notes: '' });
      fetchEvents(pagination.page);
    } catch (err: any) {
      setError(err.message || 'Failed to record outcome');
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle row expand ──
  const toggleExpand = (id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  // Set document title
  useEffect(() => { document.title = 'Court Records \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCreateModal(false); setShowCreateModal(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="app-grid-bg h-full flex flex-col overflow-hidden">
      {/* ── Header Panel ── */}
      <PanelTitleBar title="COURT RECORDS" icon={Gavel} statusLed="green" ledPulse>
        <button type="button" onClick={() => setShowSubpoenaModal(true)}
          className="toolbar-btn text-[10px]">
          <Briefcase className="w-3 h-3" /> Subpoena
        </button>
        <button type="button" onClick={() => handleGenerateReminders('7day')}
          className="toolbar-btn text-[10px]">
          <AlertTriangle className="w-3 h-3" /> 7-Day Reminders
        </button>
        <button type="button" onClick={() => handleGenerateReminders('1day')}
          className="toolbar-btn text-[10px]">
          <Clock className="w-3 h-3" /> 1-Day Reminders
        </button>
        <button type="button" onClick={() => { setShowCompliancePanel(!showCompliancePanel); if (!complianceData) fetchCompliance(); }}
          className="toolbar-btn text-[10px]">
          <Scale className="w-3 h-3" /> Compliance
        </button>
        <button type="button"
          onClick={() => setShowCreateModal(true)}
          className="toolbar-btn toolbar-btn-primary text-[10px]"
        >
          <Plus className="w-3 h-3" /> New Event
        </button>
      </PanelTitleBar>

      {/* Reminder result banner */}
      {reminderResult && (
        <div className="mx-2 mt-1 px-3 py-1.5 bg-brand-900/30 border border-brand-700/50 rounded text-xs text-brand-300 flex items-center justify-between">
          <span>{reminderResult}</span>
          <button type="button" onClick={() => setReminderResult(null)} className="text-brand-500 hover:text-white"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Compliance Rate Panel */}
      {showCompliancePanel && (
        <div className="mx-2 mt-1 card-glass p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">Court Appearance Compliance</span>
            <button type="button" onClick={() => setShowCompliancePanel(false)} className="text-rmpg-500 hover:text-white"><X className="w-3 h-3" /></button>
          </div>
          {complianceLoading ? (
            <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-brand-400" /></div>
          ) : complianceData ? (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2">
                <div className="panel-beveled p-2 text-center">
                  <div className="text-sm font-bold text-white">{complianceData.overall?.total_events || 0}</div>
                  <div className="text-[8px] text-rmpg-500 uppercase">Total Events</div>
                </div>
                <div className="panel-beveled p-2 text-center">
                  <div className="text-sm font-bold text-green-400">{complianceData.overall?.completed || 0}</div>
                  <div className="text-[8px] text-rmpg-500 uppercase">Completed</div>
                </div>
                <div className="panel-beveled p-2 text-center">
                  <div className="text-sm font-bold text-amber-400">{complianceData.overall?.continued || 0}</div>
                  <div className="text-[8px] text-rmpg-500 uppercase">Continued</div>
                </div>
                <div className="panel-beveled p-2 text-center">
                  <div className="text-sm font-bold text-brand-400">{complianceData.overall?.compliance_rate || 0}%</div>
                  <div className="text-[8px] text-rmpg-500 uppercase">Rate</div>
                </div>
              </div>
              {complianceData.by_officer?.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold">By Officer</div>
                  {complianceData.by_officer.slice(0, 8).map((o: any) => (
                    <div key={o.officer_id} className="flex justify-between text-[10px] py-0.5">
                      <span className="text-rmpg-300">{o.officer_name}</span>
                      <span className="text-rmpg-400 font-mono">{o.compliance_rate}% ({o.total_events} events)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : <div className="text-xs text-rmpg-500">No data available</div>}
        </div>
      )}

      {/* ── Filters Bar ── */}
      <div className="card-glass mx-2 mt-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-[280px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
            <input
              type="text"
              placeholder="Search event #, defendant, court..." aria-label="Search court records"
              autoComplete="off"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onBlur={() => setSearchTerm(searchInput)}
              className="input-dark text-[10px] w-full pl-7"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="select-dark text-[10px]"
          >
            <option value="">All Statuses</option>
            {STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="select-dark text-[10px]"
          >
            <option value="">All Types</option>
            {EVENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {/* Date range */}
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="select-dark text-[10px]"
            />
            <span className="text-[9px] text-rmpg-500">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="select-dark text-[10px]"
            />
          </div>

          {/* Clear filters */}
          {(statusFilter || typeFilter || dateFrom || dateTo || searchTerm) && (
            <button type="button"
              onClick={() => {
                setStatusFilter('');
                setTypeFilter('');
                setDateFrom('');
                setDateTo('');
                setSearchTerm('');
                setSearchInput('');
              }}
              className="toolbar-btn text-[9px] text-rmpg-400 hover:text-white"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}

          {/* Result count */}
          <span className="ml-auto text-[9px] text-rmpg-500 font-mono">
            {pagination.total} record{pagination.total !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="mx-2 mt-1 px-3 py-1.5 bg-red-900/30 border border-red-700/50 text-red-400 text-[10px] flex items-center gap-2">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-300">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto mx-2 mt-2 mb-2 card-glass">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" />
            <span className="text-[10px] text-rmpg-500">Loading court records...</span>
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No Court Records Found"
            description="No court events match your current filters."
            action={{ label: 'Create Court Event', onClick: () => setShowCreateModal(true) }}
          />
        ) : (
          <>
            {/* Table header */}
            <div className="sticky top-0 z-10 grid grid-cols-[100px_1fr_110px_130px_120px_90px_1fr] gap-px bg-[#0d1520] border-b border-[#1e3048] text-[9px] font-bold text-rmpg-400 uppercase tracking-wider">
              <div className="px-2 py-1.5 bg-[#141e2b]">Event #</div>
              <div className="px-2 py-1.5 bg-[#141e2b]">Defendant</div>
              <div className="px-2 py-1.5 bg-[#141e2b]">Court Date</div>
              <div className="px-2 py-1.5 bg-[#141e2b]">Event Type</div>
              <div className="px-2 py-1.5 bg-[#141e2b]">Judge</div>
              <div className="px-2 py-1.5 bg-[#141e2b]">Status</div>
              <div className="px-2 py-1.5 bg-[#141e2b]">Court / Case #</div>
            </div>

            {/* Table rows */}
            {events.map(ev => {
              const isExpanded = expandedId === ev.id;
              const StatusIcon = STATUS_ICONS[ev.status] || Clock;
              const displayName = ev.defendant_full_name || ev.defendant_name || '--';

              return (
                <React.Fragment key={ev.id}>
                  {/* Row */}
                  <div
                    onClick={() => toggleExpand(ev.id)}
                    className={`grid grid-cols-[100px_1fr_110px_130px_120px_90px_1fr] gap-px cursor-pointer transition-colors border-b border-[#1e3048]/50 ${
                      isExpanded ? 'bg-[#1a2636]' : 'bg-[#141e2b] hover:bg-[#1a2636]/60'
                    }`}
                  >
                    <div className="px-2 py-1.5 text-[10px] font-mono text-brand-blue truncate flex items-center gap-1">
                      <ChevronDown className={`w-3 h-3 text-rmpg-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                      {ev.event_number}
                    </div>
                    <div className="px-2 py-1.5 text-[10px] text-white truncate">{displayName}</div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-300 font-mono whitespace-nowrap">
                      {ev.event_date ? formatDate(ev.event_date) : '--'}
                      {ev.event_time && <span className="text-rmpg-500 ml-1">{ev.event_time}</span>}
                    </div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-300 truncate">{eventTypeLabel(ev.event_type)}</div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-300 truncate">{ev.judge_name || '--'}</div>
                    <div className="px-2 py-1.5 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold border ${STATUS_COLORS[ev.status] || 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'}`}>
                        <StatusIcon className="w-2.5 h-2.5" />
                        {ev.status?.toUpperCase()}
                      </span>
                    </div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-400 truncate">
                      {ev.court_name || '--'}
                      {ev.court_case_number && <span className="text-rmpg-500 ml-1">({ev.court_case_number})</span>}
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="bg-[#0d1520] border-b border-[#1e3048] px-4 py-3 animate-fadeIn">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Column 1: Event Details */}
                        <div className="space-y-2">
                          <h4 className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> Event Details
                          </h4>
                          <div className="space-y-1 text-[10px]">
                            <DetailRow label="Event #" value={ev.event_number} mono />
                            <DetailRow label="Type" value={eventTypeLabel(ev.event_type)} />
                            <DetailRow label="Date" value={ev.event_date ? formatDate(ev.event_date) : null} />
                            <DetailRow label="Time" value={ev.event_time} />
                            <DetailRow label="Court" value={ev.court_name} />
                            <DetailRow label="Courtroom" value={ev.courtroom} />
                            <DetailRow label="Judge" value={ev.judge_name} />
                            <DetailRow label="Case #" value={ev.court_case_number} mono />
                            <DetailRow label="Status" value={ev.status?.toUpperCase()} />
                          </div>
                        </div>

                        {/* Column 2: Parties & References */}
                        <div className="space-y-2">
                          <h4 className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1">
                            <User className="w-3 h-3" /> Parties & References
                          </h4>
                          <div className="space-y-1 text-[10px]">
                            <DetailRow label="Defendant" value={displayName} />
                            <DetailRow label="Prosecutor" value={ev.prosecutor} />
                            <DetailRow label="Defense Atty" value={ev.defense_attorney} />
                            {ev.incident_id && <DetailRow label="Incident ID" value={`#${ev.incident_id}`} mono />}
                            {ev.case_id && <DetailRow label="Case ID" value={`#${ev.case_id}`} mono />}
                            {ev.citation_id && <DetailRow label="Citation ID" value={`#${ev.citation_id}`} mono />}
                          </div>

                          {/* Outcome section */}
                          {ev.outcome && (
                            <div className="mt-3 pt-2 border-t border-[#1e3048]">
                              <h4 className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1 mb-1">
                                <Scale className="w-3 h-3" /> Outcome
                              </h4>
                              <div className="space-y-1 text-[10px]">
                                <DetailRow label="Outcome" value={ev.outcome?.replace(/_/g, ' ').toUpperCase()} />
                                <DetailRow label="Sentence" value={ev.sentence} />
                                {ev.fine_amount != null && (
                                  <DetailRow label="Fine" value={`$${Number(ev.fine_amount).toFixed(2)}`} mono />
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Column 3: Notes & Actions */}
                        <div className="space-y-2">
                          <h4 className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1">
                            <FileText className="w-3 h-3" /> Notes
                          </h4>
                          {ev.notes ? (
                            <p className="text-[10px] text-rmpg-300 bg-[#141e2b] border border-[#1e3048] p-2 whitespace-pre-wrap max-h-32 overflow-auto">
                              {ev.notes}
                            </p>
                          ) : (
                            <p className="text-[10px] text-rmpg-500 italic">No notes recorded</p>
                          )}

                          <div className="text-[9px] text-rmpg-500 space-y-0.5 mt-2">
                            <div>Created: {formatDateTime(ev.created_at)}</div>
                            <div>Updated: {formatDateTime(ev.updated_at)}</div>
                          </div>

                          {/* Action buttons */}
                          {ev.status === 'scheduled' && !ev.outcome && (
                            <button type="button"
                              onClick={e => { e.stopPropagation(); setOutcomeData({ outcome: '', sentence: '', fine_amount: '', notes: ev.notes || '' }); setShowOutcomeModal(ev.id); }}
                              className="toolbar-btn toolbar-btn-primary text-[9px] mt-2"
                            >
                              <Scale className="w-3 h-3" /> Record Outcome
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      {/* ── Pagination ── */}
      {pagination.totalPages > 1 && (
        <div className="mx-2 mb-2 card-glass px-3 py-1.5 flex items-center justify-between">
          <button type="button"
            onClick={() => fetchEvents(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="toolbar-btn text-[9px] disabled:opacity-30"
          >
            <ChevronLeft className="w-3 h-3" /> Previous
          </button>
          <span className="text-[9px] text-rmpg-400 font-mono">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <button type="button"
            onClick={() => fetchEvents(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="toolbar-btn text-[9px] disabled:opacity-30"
          >
            Next <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Create Court Event Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setShowCreateModal(false)} onKeyDown={e => e.key === 'Escape' && setShowCreateModal(false)}>
          <div
            className="bg-surface-raised border border-[#1e3048] w-full max-w-lg mx-4 shadow-2xl animate-fadeIn"
            onClick={e => e.stopPropagation()}
          >
            <PanelTitleBar title="NEW COURT EVENT" icon={Plus}>
              <button type="button" onClick={() => setShowCreateModal(false)} className="toolbar-btn text-[10px]">
                <X className="w-3 h-3" />
              </button>
            </PanelTitleBar>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-auto">
              {/* Event type + date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Event Type *</label>
                  <select
                    value={formData.event_type}
                    onChange={e => setFormData(p => ({ ...p, event_type: e.target.value }))}
                    className="input-dark text-[10px] w-full"
                  >
                    <option value="">Select type...</option>
                    {EVENT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Event Date *</label>
                  <input
                    type="date"
                    value={formData.event_date}
                    onChange={e => setFormData(p => ({ ...p, event_date: e.target.value }))}
                    className="input-dark text-[10px] w-full"
                  />
                </div>
              </div>

              {/* Time + courtroom */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Event Time</label>
                  <input
                    type="time"
                    value={formData.event_time}
                    onChange={e => setFormData(p => ({ ...p, event_time: e.target.value }))}
                    className="input-dark text-[10px] w-full"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Courtroom</label>
                  <input
                    type="text"
                    value={formData.courtroom}
                    onChange={e => setFormData(p => ({ ...p, courtroom: e.target.value }))}
                    placeholder="e.g., Room 304"
                    className="input-dark text-[10px] w-full"
                  />
                </div>
              </div>

              {/* Court name + judge */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Court Name</label>
                  <input
                    type="text"
                    value={formData.court_name}
                    onChange={e => setFormData(p => ({ ...p, court_name: e.target.value }))}
                    placeholder="e.g., 3rd District Court"
                    className="input-dark text-[10px] w-full"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Judge</label>
                  <input
                    type="text"
                    value={formData.judge_name}
                    onChange={e => setFormData(p => ({ ...p, judge_name: e.target.value }))}
                    placeholder="Judge name"
                    className="input-dark text-[10px] w-full"
                  />
                </div>
              </div>

              {/* Case # + defendant */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Court Case #</label>
                  <input
                    type="text"
                    value={formData.court_case_number}
                    onChange={e => setFormData(p => ({ ...p, court_case_number: e.target.value }))}
                    placeholder="Case number"
                    className="input-dark text-[10px] w-full"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Defendant Name</label>
                  <input
                    type="text"
                    value={formData.defendant_name}
                    onChange={e => setFormData(p => ({ ...p, defendant_name: e.target.value }))}
                    placeholder="Defendant name"
                    className="input-dark text-[10px] w-full"
                  />
                </div>
              </div>

              {/* Prosecutor + defense attorney */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Prosecutor</label>
                  <input
                    type="text"
                    value={formData.prosecutor}
                    onChange={e => setFormData(p => ({ ...p, prosecutor: e.target.value }))}
                    placeholder="Prosecutor name"
                    className="input-dark text-[10px] w-full"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Defense Attorney</label>
                  <input
                    type="text"
                    value={formData.defense_attorney}
                    onChange={e => setFormData(p => ({ ...p, defense_attorney: e.target.value }))}
                    placeholder="Defense attorney name"
                    className="input-dark text-[10px] w-full"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  placeholder="Additional notes..."
                  className="input-dark text-[10px] w-full resize-y"
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e3048]">
                <button type="button" onClick={() => setShowCreateModal(false)} className="toolbar-btn text-[10px]">Cancel</button>
                <button type="button"
                  onClick={handleCreate}
                  disabled={!formData.event_type || !formData.event_date || saving}
                  className="toolbar-btn toolbar-btn-primary text-[10px] disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Plus className="w-3 h-3" />}
                  Create Event
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Outcome Modal ── */}
      {showOutcomeModal !== null && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setShowOutcomeModal(null)} onKeyDown={e => e.key === 'Escape' && setShowOutcomeModal(null)}>
          <div
            className="bg-surface-raised border border-[#1e3048] w-full max-w-md mx-4 shadow-2xl animate-fadeIn"
            onClick={e => e.stopPropagation()}
          >
            <PanelTitleBar title="RECORD OUTCOME" icon={Scale}>
              <button type="button" onClick={() => setShowOutcomeModal(null)} className="toolbar-btn text-[10px]">
                <X className="w-3 h-3" />
              </button>
            </PanelTitleBar>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Outcome *</label>
                <select
                  value={outcomeData.outcome}
                  onChange={e => setOutcomeData(p => ({ ...p, outcome: e.target.value }))}
                  className="input-dark text-[10px] w-full"
                >
                  <option value="">Select outcome...</option>
                  {OUTCOMES.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Sentence</label>
                <input
                  type="text"
                  value={outcomeData.sentence}
                  onChange={e => setOutcomeData(p => ({ ...p, sentence: e.target.value }))}
                  placeholder="e.g., 30 days jail, 1 year probation"
                  className="input-dark text-[10px] w-full"
                />
              </div>

              <div>
                <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Fine Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={outcomeData.fine_amount}
                  onChange={e => setOutcomeData(p => ({ ...p, fine_amount: e.target.value }))}
                  placeholder="0.00"
                  className="input-dark text-[10px] w-full"
                />
              </div>

              <div>
                <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Notes</label>
                <textarea
                  value={outcomeData.notes}
                  onChange={e => setOutcomeData(p => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  placeholder="Additional outcome notes..."
                  className="input-dark text-[10px] w-full resize-y"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e3048]">
                <button type="button" onClick={() => setShowOutcomeModal(null)} className="toolbar-btn text-[10px]">Cancel</button>
                <button type="button"
                  onClick={handleOutcome}
                  disabled={!outcomeData.outcome || saving}
                  className="toolbar-btn toolbar-btn-primary text-[10px] disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <CheckCircle className="w-3 h-3" />}
                  Save Outcome
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Verdict Modal ── */}
      {showVerdictModal !== null && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="card-glass w-full max-w-md p-4 space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Record Verdict</h3>
              <button type="button" onClick={() => setShowVerdictModal(null)} className="text-rmpg-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Verdict *</label>
              <select value={verdictForm.verdict} onChange={e => setVerdictForm(f => ({ ...f, verdict: e.target.value }))} className="input-dark text-[10px] w-full">
                <option value="">Select verdict...</option>
                <option value="guilty">Guilty</option>
                <option value="not_guilty">Not Guilty</option>
                <option value="dismissed">Dismissed</option>
                <option value="plea_deal">Plea Deal</option>
                <option value="nolle_prosequi">Nolle Prosequi</option>
                <option value="deferred_adjudication">Deferred Adjudication</option>
                <option value="mistrial">Mistrial</option>
                <option value="no_contest">No Contest</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Sentence Type</label><input type="text" value={verdictForm.sentence_type} onChange={e => setVerdictForm(f => ({ ...f, sentence_type: e.target.value }))} className="input-dark text-[10px] w-full" placeholder="Incarceration, probation..." /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Fine ($)</label><input type="number" step="0.01" value={verdictForm.fine_amount} onChange={e => setVerdictForm(f => ({ ...f, fine_amount: e.target.value }))} className="input-dark text-[10px] w-full" /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Probation</label><input type="text" value={verdictForm.probation_length} onChange={e => setVerdictForm(f => ({ ...f, probation_length: e.target.value }))} className="input-dark text-[10px] w-full" placeholder="12 months" /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Jail Time</label><input type="text" value={verdictForm.jail_time} onChange={e => setVerdictForm(f => ({ ...f, jail_time: e.target.value }))} className="input-dark text-[10px] w-full" placeholder="30 days" /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Community Service (hrs)</label><input type="number" value={verdictForm.community_service_hours} onChange={e => setVerdictForm(f => ({ ...f, community_service_hours: e.target.value }))} className="input-dark text-[10px] w-full" /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Appeal Deadline</label><input type="date" value={verdictForm.appeal_deadline} onChange={e => setVerdictForm(f => ({ ...f, appeal_deadline: e.target.value }))} className="input-dark text-[10px] w-full" /></div>
            </div>
            <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Sentence Details</label><textarea value={verdictForm.sentence_details} onChange={e => setVerdictForm(f => ({ ...f, sentence_details: e.target.value }))} className="input-dark text-[10px] w-full h-16 resize-none" /></div>
            <button type="button" onClick={handleVerdict} disabled={saving || !verdictForm.verdict} className="btn-primary w-full flex items-center justify-center gap-2 text-xs">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scale className="w-3 h-3" />} Record Verdict
            </button>
          </div>
        </div>
      )}

      {/* ── Subpoena Modal ── */}
      {showSubpoenaModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="card-glass w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Track Subpoena</h3>
              <button type="button" onClick={() => setShowSubpoenaModal(false)} className="text-rmpg-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Officer ID *</label><input type="text" value={subpoenaForm.officer_id} onChange={e => setSubpoenaForm(f => ({ ...f, officer_id: e.target.value }))} className="input-dark text-[10px] w-full" /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Hearing Date *</label><input type="date" value={subpoenaForm.hearing_date} onChange={e => setSubpoenaForm(f => ({ ...f, hearing_date: e.target.value }))} className="input-dark text-[10px] w-full" /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Hearing Time</label><input type="time" value={subpoenaForm.hearing_time} onChange={e => setSubpoenaForm(f => ({ ...f, hearing_time: e.target.value }))} className="input-dark text-[10px] w-full" /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Court Name</label><input type="text" value={subpoenaForm.court_name} onChange={e => setSubpoenaForm(f => ({ ...f, court_name: e.target.value }))} className="input-dark text-[10px] w-full" /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Case Number</label><input type="text" value={subpoenaForm.court_case_number} onChange={e => setSubpoenaForm(f => ({ ...f, court_case_number: e.target.value }))} className="input-dark text-[10px] w-full" /></div>
              <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Served Date</label><input type="date" value={subpoenaForm.served_date} onChange={e => setSubpoenaForm(f => ({ ...f, served_date: e.target.value }))} className="input-dark text-[10px] w-full" /></div>
            </div>
            <div><label className="block text-[9px] text-rmpg-400 uppercase mb-0.5">Service Method</label>
              <select value={subpoenaForm.served_method} onChange={e => setSubpoenaForm(f => ({ ...f, served_method: e.target.value }))} className="input-dark text-[10px] w-full">
                <option value="">Not yet served</option><option value="personal">Personal Service</option><option value="mail">Mail</option><option value="email">Email</option>
              </select>
            </div>
            <button type="button" onClick={handleSubpoena} disabled={saving || !subpoenaForm.officer_id || !subpoenaForm.hearing_date} className="btn-primary w-full flex items-center justify-center gap-2 text-xs">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Briefcase className="w-3 h-3" />} Create Subpoena
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Detail Row Helper
// ============================================================

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-rmpg-500 w-20 flex-shrink-0">{label}:</span>
      <span className={`text-white ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
