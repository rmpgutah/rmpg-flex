// ============================================================
// Community Engagement — Page 71 of the full-app frontend audit
//
// URL deep-link contract:
//   ?event_id=N   — auto-open the edit form for that event
//                   (consumed once, stripped so refresh doesn't re-open)
//
// Sections: Events (full CRUD) | Tips (read-only list) |
//           Watch Groups (read-only list) | Alerts (read-only list)
//
// Key fixes vs the original:
//   • showForm was `editingRecord !== null` — "New Event" set editingRecord
//     to null so the form never opened. Now tracked by a separate boolean.
//   • Raw inline delete `div` → ConfirmDialog.
//   • Esc cascade: deleteTarget → form, each branch stopPropagation.
//   • `N` keyboard shortcut opens "New Event" and focuses event name input.
//   • Role-guard: Write buttons hidden for officer/dispatcher/client_viewer.
//   • Tab navigation exposes tips, watch-groups, alerts (stats + list).
//   • Error banner lives OUTSIDE PanelTitleBar children.
//   • deepLinkRef guard prevents double-consume on re-render.
//   • 3-state empty: loading / no-data / no-results per tab.
// ============================================================

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import {
  communityEventsToCsv, communityTipsSafeToCsv, communityAlertsToCsv, watchGroupsToCsv, downloadTextFile,
} from '../utils/rmsListExport';
import {
  Users, Calendar, MessageSquare, Bell, Plus, Pencil, Trash2,
  AlertCircle, Eye, RefreshCw,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

type Tab = 'events' | 'tips' | 'watch-groups' | 'alerts';

interface CommunityEvent {
  id: number;
  event_name: string;
  event_type: string;
  description?: string;
  location?: string;
  start_date: string;
  end_date?: string;
  status: string;
  notes?: string;
  attendees_count?: number;
}

interface PublicTip {
  id: number;
  tip_number: string;
  submitter_name?: string;
  is_anonymous: number;
  tip_text: string;
  category?: string;
  location?: string;
  status: string;
  priority: string;
  created_at: string;
}

interface WatchGroup {
  id: number;
  group_name: string;
  neighborhood?: string;
  coordinator_name?: string;
  coordinator_contact?: string;
  member_count: number;
  last_meeting?: string;
  next_meeting?: string;
}

interface CommunityAlert {
  id: number;
  alert_title: string;
  alert_text: string;
  alert_type: string;
  severity: string;
  target_area?: string;
  created_at: string;
  created_by_name?: string;
}

interface Stats {
  events: number;
  tips: number;
  watch_groups: number;
  alerts: number;
}

const WRITE_ROLES = new Set(['admin', 'manager', 'supervisor']);

const EVENT_TYPES = ['outreach', 'training', 'meeting', 'fundraiser', 'patrol_ride_along', 'other'];
const EVENT_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'];

const EMPTY_FORM = {
  event_name: '',
  event_type: 'outreach',
  description: '',
  location: '',
  start_date: '',
  end_date: '',
  status: 'planned',
  notes: '',
};

// ── Component ────────────────────────────────────────────────

export default function CommunityPage() {
  const m = useMenuActions();
  const { addToast } = useToast();
  const { user } = useAuth();
  const canWrite = WRITE_ROLES.has(user?.role ?? '');

  const [searchParams, setSearchParams] = useSearchParams();

  // ── Tab ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('events');

  // ── Events ──────────────────────────────────────────────
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  // ── Tips ────────────────────────────────────────────────
  const [tips, setTips] = useState<PublicTip[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);
  const tipsLoaded = useRef(false);

  // ── Watch Groups ─────────────────────────────────────────
  const [watchGroups, setWatchGroups] = useState<WatchGroup[]>([]);
  const [watchLoading, setWatchLoading] = useState(false);
  const watchLoaded = useRef(false);

  // ── Alerts ──────────────────────────────────────────────
  const [alerts, setAlerts] = useState<CommunityAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const alertsLoaded = useRef(false);

  // ── Stats ────────────────────────────────────────────────
  const [stats, setStats] = useState<Stats>({ events: 0, tips: 0, watch_groups: 0, alerts: 0 });

  // ── Refs ─────────────────────────────────────────────────
  const nameInputRef = useRef<HTMLInputElement>(null);
  const deepLinkRef = useRef(false);

  // ── Form / UI state ──────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CommunityEvent | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CommunityEvent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Data fetchers ────────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    try {
      setError(null);
      const r = await apiFetch<{ data: CommunityEvent[] }>('/community/events');
      setEvents(r.data ?? []);
    } catch {
      setError('Failed to load community events');
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const s = await apiFetch<Stats>('/community/stats');
      setStats(s);
    } catch { /* stats are non-critical */ }
  }, []);

  const fetchTips = useCallback(async () => {
    if (tipsLoaded.current) return;
    setTipsLoading(true);
    try {
      const r = await apiFetch<{ data: PublicTip[] }>('/community/tips');
      setTips(r.data ?? []);
      tipsLoaded.current = true;
    } catch {
      addToast('Failed to load tips', 'error');
    } finally {
      setTipsLoading(false);
    }
  }, [addToast]);

  const fetchWatchGroups = useCallback(async () => {
    if (watchLoaded.current) return;
    setWatchLoading(true);
    try {
      const r = await apiFetch<{ data: WatchGroup[] }>('/community/watch-groups');
      setWatchGroups(r.data ?? []);
      watchLoaded.current = true;
    } catch {
      addToast('Failed to load watch groups', 'error');
    } finally {
      setWatchLoading(false);
    }
  }, [addToast]);

  const fetchAlerts = useCallback(async () => {
    if (alertsLoaded.current) return;
    setAlertsLoading(true);
    try {
      const r = await apiFetch<{ data: CommunityAlert[] }>('/community/alerts');
      setAlerts(r.data ?? []);
      alertsLoaded.current = true;
    } catch {
      addToast('Failed to load alerts', 'error');
    } finally {
      setAlertsLoading(false);
    }
  }, [addToast]);

  // ── Initial load ─────────────────────────────────────────

  useEffect(() => {
    fetchEvents();
    fetchStats();
  }, [fetchEvents, fetchStats]);

  // ── Form helpers ─────────────────────────────────────────

  const openNew = useCallback(() => {
    setEditingEvent(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
  }, []);

  const openEdit = useCallback((ev: CommunityEvent) => {
    setEditingEvent(ev);
    setFormData({
      event_name: ev.event_name ?? '',
      event_type: ev.event_type ?? 'other',
      description: ev.description ?? '',
      location: ev.location ?? '',
      start_date: ev.start_date ?? '',
      end_date: ev.end_date ?? '',
      status: ev.status ?? 'planned',
      notes: ev.notes ?? '',
    });
    setShowForm(true);
  }, []);

  // ── URL deep-link: ?event_id=N ───────────────────────────
  useEffect(() => {
    const rawId = searchParams.get('event_id');
    if (!rawId || deepLinkRef.current) return;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) { setSearchParams((p) => { p.delete('event_id'); return p; }, { replace: true }); return; }
    if (eventsLoading) return;
    deepLinkRef.current = true;
    const found = events.find((e) => e.id === id);
    if (found) {
      openEdit(found);
    } else {
      addToast(`Event #${id} not found`, 'warning');
    }
    setSearchParams((p) => { p.delete('event_id'); return p; }, { replace: true });
  }, [eventsLoading, events, searchParams, openEdit, addToast, setSearchParams]);

  // ── Tab lazy-load ────────────────────────────────────────

  useEffect(() => {
    if (activeTab === 'tips') fetchTips();
    else if (activeTab === 'watch-groups') fetchWatchGroups();
    else if (activeTab === 'alerts') fetchAlerts();
  }, [activeTab, fetchTips, fetchWatchGroups, fetchAlerts]);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditingEvent(null);
  }, []);

  const handleSave = async () => {
    if (!formData.event_name.trim()) { addToast('Event name is required', 'error'); return; }
    if (!formData.start_date) { addToast('Date is required', 'error'); return; }
    setSubmitting(true);
    try {
      if (editingEvent) {
        await apiFetch(`/community/events/${editingEvent.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Event updated', 'success');
      } else {
        await apiFetch('/community/events', { method: 'POST', body: JSON.stringify(formData) });
        addToast('Event created', 'success');
      }
      closeForm();
      fetchEvents();
      fetchStats();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/community/events/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      addToast('Event deleted', 'success');
      fetchEvents();
      fetchStats();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ── Esc cascade + N shortcut ─────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.closest('input,textarea,select') !== null;

      if (e.key === 'Escape') {
        if (deleteTarget) { e.stopPropagation(); setDeleteTarget(null); return; }
        if (showForm) { e.stopPropagation(); closeForm(); return; }
        if (search.trim()) { e.stopPropagation(); setSearch(''); return; }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!inInput && e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if ((e.key === 'n' || e.key === 'N') && !inInput && !showForm && !deleteTarget && canWrite) {
        e.preventDefault();
        if (activeTab === 'events') {
          openNew();
          // Focus the primary input after state flush
          requestAnimationFrame(() => nameInputRef.current?.focus());
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteTarget, showForm, canWrite, activeTab, openNew, closeForm, search]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => `${e.event_name} ${e.event_type} ${e.location ?? ''} ${e.status}`.toLowerCase().includes(q));
  }, [events, search]);
  const filteredTips = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tips;
    return tips.filter((t) => `${t.tip_number} ${t.category ?? ''} ${t.location ?? ''} ${t.status}`.toLowerCase().includes(q));
  }, [tips, search]);
  const filteredWatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return watchGroups;
    return watchGroups.filter((g) => `${g.group_name} ${g.neighborhood ?? ''}`.toLowerCase().includes(q));
  }, [watchGroups, search]);
  const filteredAlerts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return alerts;
    return alerts.filter((a) => `${a.alert_title} ${a.alert_type} ${a.severity} ${a.target_area ?? ''}`.toLowerCase().includes(q));
  }, [alerts, search]);

  const exportCurrentTab = () => {
    if (activeTab === 'events') downloadTextFile('community-events.csv', communityEventsToCsv(filteredEvents));
    else if (activeTab === 'tips') downloadTextFile('community-tips.csv', communityTipsSafeToCsv(filteredTips));
    else if (activeTab === 'watch-groups') downloadTextFile('community-watch-groups.csv', watchGroupsToCsv(filteredWatch));
    else downloadTextFile('community-alerts.csv', communityAlertsToCsv(filteredAlerts));
  };

  // ── Column defs ──────────────────────────────────────────

  const eventColumns = [
    { key: 'event_name', label: 'Event' },
    { key: 'event_type', label: 'Type', render: (row: CommunityEvent) => (
      <span className="capitalize">{toDisplayLabel(row.event_type)}</span>
    )},
    { key: 'location', label: 'Location' },
    { key: 'start_date', label: 'Date' },
    { key: 'status', label: 'Status', render: (row: CommunityEvent) => (
      <span className={`capitalize ${row.status === 'completed' ? 'text-green-400' : row.status === 'cancelled' ? 'text-red-400' : row.status === 'in_progress' ? 'text-amber-400' : 'text-rmpg-300'}`}>
        {toDisplayLabel(row.status)}
      </span>
    )},
    ...(canWrite ? [{
      key: 'actions',
      label: '',
      width: '72px',
      render: (row: CommunityEvent) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
            className="text-rmpg-400 hover:text-rmpg-100"
            aria-label="Edit event"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
            className="text-red-500 hover:text-red-300"
            aria-label="Delete event"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ),
    }] : []),
  ];

  const tipColumns = [
    { key: 'tip_number', label: 'Tip #' },
    { key: 'submitter_name', label: 'Submitter', render: (row: PublicTip) => (
      <span>{row.is_anonymous ? 'Anonymous' : (row.submitter_name || '—')}</span>
    )},
    { key: 'category', label: 'Category' },
    { key: 'tip_text', label: 'Tip', render: (row: PublicTip) => (
      <span className="truncate max-w-[300px] block">{row.tip_text}</span>
    )},
    { key: 'priority', label: 'Priority', render: (row: PublicTip) => (
      <span className={`capitalize ${row.priority === 'urgent' ? 'text-red-400' : row.priority === 'high' ? 'text-amber-400' : 'text-rmpg-300'}`}>
        {formatEnumValue(row.priority)}
      </span>
    )},
    { key: 'status', label: 'Status', render: (row: PublicTip) => (
      <span className="capitalize">{toDisplayLabel(row.status)}</span>
    )},
  ];

  const watchColumns = [
    { key: 'group_name', label: 'Group Name' },
    { key: 'neighborhood', label: 'Neighborhood' },
    { key: 'coordinator_name', label: 'Coordinator' },
    { key: 'member_count', label: 'Members' },
    { key: 'last_meeting', label: 'Last Meeting' },
    { key: 'next_meeting', label: 'Next Meeting' },
  ];

  const alertColumns = [
    { key: 'alert_title', label: 'Title' },
    { key: 'alert_type', label: 'Type', render: (row: CommunityAlert) => (
      <span className="capitalize">{toDisplayLabel(row.alert_type)}</span>
    )},
    { key: 'severity', label: 'Severity', render: (row: CommunityAlert) => (
      <span className={`capitalize ${row.severity === 'critical' ? 'text-red-400' : row.severity === 'warning' ? 'text-amber-400' : 'text-rmpg-300'}`}>
        {formatEnumValue(row.severity)}
      </span>
    )},
    { key: 'target_area', label: 'Target Area' },
    { key: 'created_by_name', label: 'Created By' },
    { key: 'created_at', label: 'Sent' },
  ];

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="COMMUNITY ENGAGEMENT" icon={Users}>
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter list… (/)"
          className="input-dark text-xs h-7 w-44"
          aria-label="Filter community list"
        />
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          onClick={exportCurrentTab}
        >CSV</button>
        {canWrite && activeTab === 'events' && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New Event (N)"
          >
            <Plus size={13} /> New Event
          </button>
        )}
      </PanelTitleBar>

      {error && (
        <div className="border border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-2 flex items-center gap-2" role="alert">
          <AlertCircle size={12} className="shrink-0" />
          {error}
          <button onClick={fetchEvents} className="ml-auto text-rmpg-400 hover:text-rmpg-100">
            <RefreshCw size={12} />
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard icon={Calendar} label="Events" value={stats.events} />
        <StatsCard icon={MessageSquare} label="Public Tips" value={stats.tips} />
        <StatsCard icon={Users} label="Watch Groups" value={stats.watch_groups} />
        <StatsCard icon={Bell} label="Alerts Sent" value={stats.alerts} />
      </div>

      {/* Tab strip */}
      <div className="flex border-b border-rmpg-700 gap-0">
        {([
          { id: 'events', label: 'Events', icon: Calendar },
          { id: 'tips', label: 'Public Tips', icon: MessageSquare },
          { id: 'watch-groups', label: 'Watch Groups', icon: Eye },
          { id: 'alerts', label: 'Alerts', icon: Bell },
        ] as { id: Tab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              activeTab === id
                ? 'border-brand-400 text-brand-400'
                : 'border-transparent text-rmpg-400 hover:text-rmpg-200'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Events tab */}
      {activeTab === 'events' && (
        <DataTable
          columns={eventColumns}
          data={filteredEvents}
          loading={eventsLoading}
          emptyMessage={
            search.trim() && events.length > 0
              ? `No events match "${search}"`
              : canWrite
              ? 'No community events found. Press N or click "New Event" to create one.'
              : 'No community events found.'
          }
          emptyDescription={eventsLoading ? undefined : 'Events will appear here once added.'}
          onRowClick={(row) => openEdit(row as CommunityEvent)}
          rowContextMenu={(row) => [
            m.action('Open / Edit', () => openEdit(row as CommunityEvent), { icon: <Pencil size={12} /> }),
            m.separator(),
            m.copyId((row as CommunityEvent).id),
            ...(canWrite ? [
              m.action('Delete', () => setDeleteTarget(row as CommunityEvent), { danger: true, icon: <Trash2 size={12} /> }),
            ] : []),
          ]}
        />
      )}

      {/* Tips tab */}
      {activeTab === 'tips' && (
        <DataTable
          columns={tipColumns}
          data={filteredTips}
          loading={tipsLoading}
          emptyMessage={tipsLoading ? 'Loading tips…' : (search.trim() && tips.length > 0 ? `No tips match "${search}"` : 'No public tips have been submitted yet.')}
          emptyDescription={tipsLoading ? undefined : 'Anonymous and named tips appear here when submitted.'}
        />
      )}

      {/* Watch Groups tab */}
      {activeTab === 'watch-groups' && (
        <DataTable
          columns={watchColumns}
          data={filteredWatch}
          loading={watchLoading}
          emptyMessage={watchLoading ? 'Loading watch groups…' : (search.trim() && watchGroups.length > 0 ? `No groups match "${search}"` : 'No neighborhood watch groups registered.')}
          emptyDescription={watchLoading ? undefined : 'Watch groups appear here once registered.'}
        />
      )}

      {/* Alerts tab */}
      {activeTab === 'alerts' && (
        <DataTable
          columns={alertColumns}
          data={filteredAlerts}
          loading={alertsLoading}
          emptyMessage={alertsLoading ? 'Loading alerts…' : (search.trim() && alerts.length > 0 ? `No alerts match "${search}"` : 'No community alerts have been sent.')}
          emptyDescription={alertsLoading ? undefined : 'Broadcast alerts appear here once created.'}
        />
      )}

      {/* Event form modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4"
          onClick={closeForm}
          role="presentation"
        >
          <div
            className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={editingEvent ? 'Edit Event' : 'New Event'}
          >
            <h3 className="text-sm font-bold text-rmpg-100 mb-4 uppercase tracking-wider">
              {editingEvent ? 'Edit Event' : 'New Event'}
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="ce-event-name" className="text-[10px] text-rmpg-400 uppercase font-semibold">
                  Event Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="ce-event-name"
                  ref={nameInputRef}
                  className="input-dark mt-1"
                  value={formData.event_name}
                  onChange={(e) => setFormData({ ...formData, event_name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ce-event-type" className="text-[10px] text-rmpg-400 uppercase font-semibold">Type</label>
                  <select
                    id="ce-event-type"
                    className="select-dark mt-1"
                    value={formData.event_type}
                    onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>{toDisplayLabel(t)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ce-start-date" className="text-[10px] text-rmpg-400 uppercase font-semibold">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ce-start-date"
                    type="date"
                    className="input-dark mt-1"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ce-location" className="text-[10px] text-rmpg-400 uppercase font-semibold">Location</label>
                  <input
                    id="ce-location"
                    className="input-dark mt-1"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="ce-status" className="text-[10px] text-rmpg-400 uppercase font-semibold">Status</label>
                  <select
                    id="ce-status"
                    className="select-dark mt-1"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    {EVENT_STATUSES.map((s) => (
                      <option key={s} value={s}>{toDisplayLabel(s)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="ce-notes" className="text-[10px] text-rmpg-400 uppercase font-semibold">Notes</label>
                <textarea
                  id="ce-notes"
                  className="input-dark mt-1 resize-none"
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={closeForm}
                className="toolbar-btn px-4"
                style={{ height: 28 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={submitting}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {submitting ? 'Saving...' : editingEvent ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation — ConfirmDialog */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Event"
        message="This permanently removes the event record."
        details={deleteTarget ? (
          <span>{deleteTarget.event_name}</span>
        ) : undefined}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
