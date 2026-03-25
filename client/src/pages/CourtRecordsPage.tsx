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
        <button type="button"
          onClick={() => setShowCreateModal(true)}
          className="toolbar-btn toolbar-btn-primary text-[10px]"
        >
          <Plus className="w-3 h-3" /> New Event
        </button>
      </PanelTitleBar>

      {/* ── Filters Bar ── */}
      <div className="card-glass mx-2 mt-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-[280px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
            <input
              type="text"
              placeholder="Search event #, defendant, court..." aria-label="Search event #, defendant, court..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onBlur={() => setSearchTerm(searchInput)}
              className="w-full pl-7 pr-2 py-1 bg-[#0d1520] border border-[#1e3048] text-[10px] text-white placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
            className="bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
              className="bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
            />
            <span className="text-[9px] text-rmpg-500">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent mx-2 mt-2 mb-2 card-glass">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-rmpg-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading court records...
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
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-300 font-mono">
                      {ev.event_date ? formatDate(ev.event_date) : '--'}
                      {ev.event_time && <span className="text-rmpg-500 ml-1">{ev.event_time}</span>}
                    </div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-300 truncate">{eventTypeLabel(ev.event_type)}</div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-300 truncate">{ev.judge_name || '--'}</div>
                    <div className="px-2 py-1.5">
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
                            <p className="text-[10px] text-rmpg-300 bg-[#141e2b] border border-[#1e3048] p-2 whitespace-pre-wrap max-h-32 overflow-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
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
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setShowCreateModal(false)}>
          <div
            className="bg-[#141e2b] border border-[#1e3048] w-full max-w-lg mx-4 shadow-2xl animate-fadeIn"
            onClick={e => e.stopPropagation()}
          >
            <PanelTitleBar title="NEW COURT EVENT" icon={Plus}>
              <button type="button" onClick={() => setShowCreateModal(false)} className="toolbar-btn text-[10px]">
                <X className="w-3 h-3" />
              </button>
            </PanelTitleBar>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
              {/* Event type + date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Event Type *</label>
                  <select
                    value={formData.event_type}
                    onChange={e => setFormData(p => ({ ...p, event_type: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Courtroom</label>
                  <input
                    type="text"
                    value={formData.courtroom}
                    onChange={e => setFormData(p => ({ ...p, courtroom: e.target.value }))}
                    placeholder="e.g., Room 304"
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Judge</label>
                  <input
                    type="text"
                    value={formData.judge_name}
                    onChange={e => setFormData(p => ({ ...p, judge_name: e.target.value }))}
                    placeholder="Judge name"
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Defendant Name</label>
                  <input
                    type="text"
                    value={formData.defendant_name}
                    onChange={e => setFormData(p => ({ ...p, defendant_name: e.target.value }))}
                    placeholder="Defendant name"
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Defense Attorney</label>
                  <input
                    type="text"
                    value={formData.defense_attorney}
                    onChange={e => setFormData(p => ({ ...p, defense_attorney: e.target.value }))}
                    placeholder="Defense attorney name"
                    className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
                  className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none resize-none"
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
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setShowOutcomeModal(null)}>
          <div
            className="bg-[#141e2b] border border-[#1e3048] w-full max-w-md mx-4 shadow-2xl animate-fadeIn"
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
                  className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
                  className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
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
                  className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Notes</label>
                <textarea
                  value={outcomeData.notes}
                  onChange={e => setOutcomeData(p => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  placeholder="Additional outcome notes..."
                  className="w-full bg-[#0d1520] border border-[#1e3048] text-[10px] text-white px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none resize-none"
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
