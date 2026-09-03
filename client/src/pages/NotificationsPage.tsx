import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Bell, BellOff, Check, CheckCheck, Clock, Settings, Trash2, AlertTriangle, X,
  Loader2, RefreshCw, ArrowUpRight, ExternalLink, Filter as FilterIcon,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { formatDateTime, parseTimestamp } from '../utils/dateUtils';
import { routeForEntity } from '../utils/notificationRouting';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';
import { inboxNotificationsToCsv, downloadTextFile } from '../utils/rmsListExport';

const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: number | null;
  priority: 'normal' | 'high' | 'critical';
  is_read: number;
  snoozed_until?: string | null;
  created_at: string;
}

interface NotificationPrefs {
  dispatch_updates: boolean;
  incident_updates: boolean;
  bolo_alerts: boolean;
  system_alerts: boolean;
  message_notifications: boolean;
  shift_reminders: boolean;
  report_notifications: boolean;
  email_digest: boolean;
  sound_enabled: boolean;
  desktop_notifications: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

interface NotificationStats {
  byType: { type: string; total: number; unread: number }[];
  byPriority: { priority: string; total: number; unread: number }[];
  recent7Days: { date: string; count: number }[];
  totalUnread: number;
  totalSnoozed: number;
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const { user } = useAuth();

  // Role gate: bulk destructive sweeps (Clear Read, Cleanup 30d+) are
  // admin/manager/supervisor only — officers and dispatchers can still
  // delete individual notifications via the per-row button or context menu.
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  // ── URL deep-link contract ──
  // Accepts (all optional, all stripped after consumption so a refresh
  // doesn't re-pin the operator to a stale link):
  //   ?notification_id=<id>  — highlight + scroll to that row; if it's
  //                            not in the current view (filter/page
  //                            mismatch), surface a toast + reset
  //                            filters so the operator can find it.
  //   ?category=<type>       — preselect a category filter.
  //   ?unread=1              — preselect the "Unread" filter.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategoryParam = searchParams.get('category');
  const initialUnreadParam = searchParams.get('unread') === '1';
  const pendingNotificationIdRef = useRef<string | null>(searchParams.get('notification_id'));

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [filterType, setFilterType] = useState<string>(initialCategoryParam ?? '');
  const [filterRead, setFilterRead] = useState<string>(initialUnreadParam ? '0' : '');
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [categories, setCategories] = useState<{ category: string; total: number; unread: number }[]>([]);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ConfirmDialog targets for destructive operator-wide sweeps.
  // These were unconfirmed buttons in the toolbar — "Clear Read" silently
  // erased every read notification, "Cleanup 30d+" silently erased
  // anything older than 30 days. Both flow through the same in-page
  // ConfirmDialog the rest of the app uses (pre-focuses Cancel, body-
  // scroll-locks, no global-Enter destructive action).
  const [confirmClearRead, setConfirmClearRead] = useState(false);
  const [confirmCleanupOld, setConfirmCleanupOld] = useState(false);
  const [sweepBusy, setSweepBusy] = useState(false);
  // Per-row delete confirmation — gated to admin/manager/supervisor only.
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch notifications
  const fetchNotifications = useCallback(async (page = 1) => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '25' });
      if (filterType) params.set('type', filterType);
      if (filterRead) params.set('is_read', filterRead);

      const res = await apiFetch<{ data: Notification[]; pagination: { page: number; totalPages: number; total: number } }>(`/notifications?${params}`);
      setNotifications(res?.data || []);
      setPagination(res?.pagination || { page: 1, total: 0, totalPages: 0 });
    } catch {
      setLoadError(true);
      addToast('Failed to load notifications', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterType, filterRead, addToast]);

  // Fetch stats and categories
  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, catsRes] = await Promise.all([
        apiFetch<NotificationStats>('/notifications/stats'),
        apiFetch<{ data: typeof categories }>('/notifications/categories'),
      ]);
      if (statsRes) setStats(statsRes);
      if (catsRes?.data) setCategories(catsRes.data);
    } catch { /* optional */ }
  }, []);

  // Fetch preferences
  const fetchPrefs = useCallback(async () => {
    try {
      const res = await apiFetch<NotificationPrefs>('/notifications/preferences');
      if (res) setPrefs(res);
    } catch { /* optional */ }
  }, []);

  // Check snoozed notifications
  const checkSnoozed = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: Notification[]; count: number }>('/notifications/snoozed-due');
      if (res?.count && res.count > 0) {
        addToast(`${res.count} snoozed notification(s) now due`, 'info');
        fetchNotifications(pagination.page);
      }
    } catch { /* optional */ }
  }, [addToast, fetchNotifications, pagination.page]);

  useEffect(() => {
    fetchNotifications();
    fetchStats();
    fetchPrefs();
    // Check snoozed every 60 seconds
    const interval = setInterval(checkSnoozed, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications, fetchStats, fetchPrefs, checkSnoozed]);

  useEffect(() => {
    document.title = 'Notifications \u2014 RMPG Flex';
  }, []);

  // \u2500\u2500 Esc smart-cascade \u2500\u2500
  // Order = smallest open thing first, so a single tap doesn't punch
  // through every overlay:
  //   confirm dialog \u2192 preferences panel \u2192 category filter \u2192
  //   unread filter. Falls through (no preventDefault, no stopPropagation)
  //   when nothing is open so the browser's default Esc is unaffected.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // ConfirmDialog owns its own Esc (cancels the confirm) \u2014 short-circuit
      // before the cascade so we don't double-close it.
      if (confirmDeleteId !== null) return;
      if (confirmClearRead) return;
      if (confirmCleanupOld) return;
      if (showPrefs) {
        if (isTypingInField(e.target)) return; // let inline Esc on an input clear it first
        setShowPrefs(false);
        return;
      }
      if (filterType) {
        setFilterType('');
        fetchNotifications(1);
        return;
      }
      if (filterRead) {
        setFilterRead('');
        fetchNotifications(1);
        return;
      }
      if (search.trim()) {
        setSearch('');
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [confirmDeleteId, confirmClearRead, confirmCleanupOld, showPrefs, filterType, filterRead, fetchNotifications, search]);

  // \u2500\u2500 Deep-link resolver \u2500\u2500
  // Runs once notifications hydrate. If the target id is in the current
  // page, highlight + scroll-into-view; otherwise drop the filter (so
  // the operator can find it on a refetch) and surface a hint toast.
  // Either way, strip ?notification_id= from the URL so a refresh
  // doesn't re-pin to a stale target.
  useEffect(() => {
    const target = pendingNotificationIdRef.current;
    if (!target) return;
    if (loading) return;
    pendingNotificationIdRef.current = null;
    const hit = notifications.find(n => String(n.id) === String(target));
    if (hit) {
      setHighlightId(hit.id);
      // Wait one paint so the ref is populated.
      requestAnimationFrame(() => {
        rowRefs.current.get(hit.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      // Clear highlight after 3s so it doesn't stick forever.
      const t = window.setTimeout(() => setHighlightId(null), 3000);
      return () => window.clearTimeout(t);
    }
    addToast(`Notification ${target} not in the current view \u2014 clearing filters`, 'warning');
    // If the operator deep-linked to a notification that's hidden by their
    // current filter, drop the filter so the next fetchNotifications brings
    // it into view. (Operator can still re-filter manually after.)
    if (filterType || filterRead) {
      setFilterType('');
      setFilterRead('');
      fetchNotifications(1);
    }
  }, [notifications, loading, addToast, filterType, filterRead, fetchNotifications]);

  // Strip ?category / ?unread once consumed on mount so a manual
  // refresh doesn't re-pin the operator to a stale filter.
  const consumedInitialParamsRef = useRef(false);
  useEffect(() => {
    if (consumedInitialParamsRef.current) return;
    consumedInitialParamsRef.current = true;
    if (!initialCategoryParam && !initialUnreadParam && !pendingNotificationIdRef.current) return;
    const next = new URLSearchParams(searchParams);
    next.delete('category');
    next.delete('unread');
    next.delete('notification_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actions
  const markRead = async (id: number) => {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'PUT' });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      fetchStats();
    } catch { addToast('Failed to mark as read', 'error'); }
  };

  const markAllRead = async () => {
    try {
      await apiFetch('/notifications/mark-all-read', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      addToast('All marked as read', 'success');
      fetchStats();
    } catch { addToast('Failed', 'error'); }
  };

  // ── `N` shortcut: mark all notifications as read ──
  // Operators receive notifications, not create them, so the most useful
  // primary-action shortcut is bulk mark-as-read (mirrors dispatch N = new call
  // in spirit: "act on the inbox with one key"). Suppressed when a dialog is
  // open, focus is in a form field, or the inbox is already fully read.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key !== 'n' && e.key !== 'N') return;
      if (confirmClearRead || confirmCleanupOld || showPrefs) return;
      if (!stats || stats.totalUnread === 0) return;
      e.preventDefault();
      void markAllRead();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmClearRead, confirmCleanupOld, showPrefs, stats]);

  const deleteNotification = async (id: number) => {
    try {
      await apiFetch(`/notifications/${id}`, { method: 'DELETE' });
      setNotifications(prev => prev.filter(n => n.id !== id));
      addToast('Deleted', 'success');
      fetchStats();
    } catch { addToast('Failed to delete', 'error'); }
  };

  const snoozeNotification = async (id: number, minutes: number) => {
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    try {
      await apiFetch(`/notifications/${id}/snooze`, { method: 'PUT', body: JSON.stringify({ snooze_until: until }) });
      setNotifications(prev => prev.filter(n => n.id !== id));
      addToast(`Snoozed for ${minutes} minutes`, 'success');
      fetchStats();
    } catch { addToast('Failed to snooze', 'error'); }
  };

  const escalateNotification = async (id: number) => {
    try {
      const res = await apiFetch<{ recipients: number }>('/notifications/escalate', {
        method: 'POST',
        body: JSON.stringify({ notification_id: id }),
      });
      addToast(`Escalated to ${res?.recipients || 0} supervisors`, 'success');
    } catch { addToast('Failed to escalate', 'error'); }
  };

  // Confirmed destructive sweeps — both go through ConfirmDialog now
  // because either is an irreversible bulk delete and the toolbar's
  // bare-click behavior was a foot-gun (no preview of the delete count,
  // no body-scroll-lock, no keyboard-trap, raw window.confirm-less
  // muscle-memory bypass).
  const deleteReadNotifications = useCallback(async () => {
    setSweepBusy(true);
    try {
      const res = await apiFetch<{ deleted: number }>('/notifications/delete-read', { method: 'POST' });
      addToast(`Deleted ${res?.deleted || 0} read notifications`, 'success');
      fetchNotifications(1);
      fetchStats();
    } catch { addToast('Failed', 'error'); }
    finally { setSweepBusy(false); setConfirmClearRead(false); }
  }, [addToast, fetchNotifications, fetchStats]);

  const cleanupOld = useCallback(async () => {
    setSweepBusy(true);
    try {
      const res = await apiFetch<{ deleted: number }>('/notifications/cleanup', {
        method: 'POST', body: JSON.stringify({ days_old: 30 }),
      });
      addToast(`Cleaned up ${res?.deleted || 0} old notifications`, 'success');
      fetchNotifications(1);
      fetchStats();
    } catch { addToast('Cleanup failed', 'error'); }
    finally { setSweepBusy(false); setConfirmCleanupOld(false); }
  }, [addToast, fetchNotifications, fetchStats]);

  // ── Notification → deep-link navigation ──
  // Marks the notification read first (so a click that takes the operator
  // away from this page leaves the badge in the correct state), then
  // navigates to the entity's page using its documented `?<entity>_id=`
  // deep-link param when entity_type + entity_id are both present.
  // Falls back to the type-default route when only `type` is known.
  const openNotification = useCallback((n: Notification) => {
    if (!n.is_read) {
      // Optimistic mark-read — the navigate that follows fires async
      // requests on the next page; we don't await the mark-read RPC.
      apiFetch(`/notifications/${n.id}/read`, { method: 'PUT' }).catch(() => { /* leave it; backend will resync */ });
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: 1 } : x));
    }
    const dest = routeForEntity(n);
    if (dest) navigate(dest);
    else addToast('No deep-link for this notification type yet', 'info');
  }, [navigate, addToast]);

  const savePrefs = async () => {
    if (!prefs) return;
    setSavingPrefs(true);
    try {
      await apiFetch('/notifications/preferences', { method: 'PUT', body: JSON.stringify(prefs) });
      addToast('Preferences saved', 'success');
    } catch { addToast('Failed to save preferences', 'error'); }
    finally { setSavingPrefs(false); }
  };

  const priorityColor = (p: string) => {
    if (p === 'critical') return 'text-red-400 bg-red-900/30 border-red-700/50';
    if (p === 'high') return 'text-amber-400 bg-amber-900/20 border-amber-700/40';
    return 'text-rmpg-300 bg-surface-base border-rmpg-700/50';
  };

  const typeIcon = (type: string) => {
    if (type === 'escalation') return <AlertTriangle className="w-4 h-4 text-red-400" />;
    if (type === 'dispatch') return <Bell className="w-4 h-4 text-rmpg-400" />;
    return <Bell className="w-4 h-4 text-rmpg-400" />;
  };

  // ── Right-click context menu ──
  const buildNotificationMenu = (n: Notification): ContextMenuItem[] => [
    ...(routeForEntity(n) ? [m.action('Open linked record', () => openNotification(n), { icon: <ExternalLink size={12} /> })] : []),
    ...(!n.is_read ? [m.action('Mark read', () => markRead(n.id), { icon: <Check size={12} /> })] : []),
    m.action('Snooze 30 min', () => snoozeNotification(n.id, 30), { icon: <Clock size={12} /> }),
    ...(n.priority !== 'normal' ? [m.action('Escalate', () => escalateNotification(n.id), { icon: <ArrowUpRight size={12} /> })] : []),
    m.separator(),
    m.copy('Copy title', n.title),
    m.copyId(n.id),
    ...(canManage ? [
      m.separator(),
      m.action('Delete', () => setConfirmDeleteId(n.id), { icon: <Trash2 size={12} />, danger: true }),
    ] : []),
  ];

  // The total count for the "All" sidebar entry should reflect what the
  // category breakdown adds up to, NOT just the current page's total
  // (pagination.total flips to the *filtered* total when a category is
  // selected, so the "All (N)" label was lying about the inbox size).
  const allCategoriesTotal = useMemo(
    () => categories.reduce((sum, c) => sum + (c.total || 0), 0) || pagination.total,
    [categories, pagination.total]
  );

  const visibleNotifications = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notifications;
    return notifications.filter((n) => `${n.title} ${n.type} ${n.priority}`.toLowerCase().includes(q));
  }, [notifications, search]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PanelTitleBar title="NOTIFICATIONS" icon={Bell}>
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter titles… (/)"
          className="input-dark text-xs h-7 w-44"
          aria-label="Filter notifications"
        />
        <button
          type="button"
          className="toolbar-btn"
          disabled={visibleNotifications.length === 0}
          onClick={() => downloadTextFile('notifications.csv', inboxNotificationsToCsv(visibleNotifications))}
          title="CSV of type, title, priority — no message body"
        >CSV</button>
        <button type="button" onClick={markAllRead} className="toolbar-btn" title="Mark all as read (N)">
          <CheckCheck className="w-3.5 h-3.5" /> Mark All Read
        </button>
        {canManage && (
          <button type="button" onClick={() => setConfirmClearRead(true)} className="toolbar-btn" title="Delete all read (admin/manager/supervisor only)">
            <Trash2 className="w-3.5 h-3.5" /> Clear Read
          </button>
        )}
        {canManage && (
          <button type="button" onClick={() => setConfirmCleanupOld(true)} className="toolbar-btn" title="Cleanup old notifications (admin/manager/supervisor only)">
            <RefreshCw className="w-3.5 h-3.5" /> Cleanup 30d+
          </button>
        )}
        <button type="button" onClick={() => setShowPrefs(!showPrefs)} className={`toolbar-btn ${showPrefs ? 'toolbar-btn-primary' : ''}`}>
          <Settings className="w-3.5 h-3.5" /> Preferences
        </button>
      </PanelTitleBar>

      {loadError && (
        <div className="px-4 py-2 text-xs text-red-400 flex items-center justify-between border-b border-red-700/40">
          <span>Failed to load notifications.</span>
          <button type="button" className="toolbar-btn" onClick={() => void fetchNotifications(pagination.page)}>Retry</button>
        </div>
      )}

      {/* Stats Bar */}
      {stats && (
        <div className="px-4 py-1.5 border-b border-rmpg-700/50 flex items-center gap-4 text-[10px] font-mono bg-surface-sunken flex-shrink-0">
          <span className="text-rmpg-400">Unread: <strong className="text-red-400">{stats.totalUnread}</strong></span>
          <span className="text-rmpg-400">Snoozed: <strong className="text-amber-400">{stats.totalSnoozed}</strong></span>
          {stats.byPriority.map(p => (
            <span key={p.priority} className={`${p.priority === 'critical' ? 'text-red-400' : p.priority === 'high' ? 'text-amber-400' : 'text-rmpg-400'}`}>
              {toDisplayLabel(p.priority)}: {p.unread}/{p.total}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Left sidebar: Categories */}
        <div className="w-48 border-r border-rmpg-700/50 overflow-y-auto bg-surface-sunken flex-shrink-0">
          <div className="p-2">
            <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">Categories</div>
            <button
              type="button"
              onClick={() => { setFilterType(''); fetchNotifications(1); }}
              className={`w-full text-left px-2 py-1.5 text-xs transition-colors mb-0.5 ${!filterType ? 'bg-brand-blue/20 text-rmpg-100' : 'text-rmpg-300 hover:bg-surface-raised'}`}
            >
              All ({allCategoriesTotal})
            </button>
            <button
              type="button"
              onClick={() => { setFilterRead('0'); setFilterType(''); fetchNotifications(1); }}
              className={`w-full text-left px-2 py-1.5 text-xs transition-colors mb-0.5 ${filterRead === '0' ? 'bg-red-900/30 text-red-400' : 'text-rmpg-300 hover:bg-surface-raised'}`}
            >
              Unread ({stats?.totalUnread || 0})
            </button>
            {categories.map(cat => (
              <button
                key={cat.category}
                type="button"
                onClick={() => { setFilterType(cat.category); setFilterRead(''); fetchNotifications(1); }}
                className={`w-full text-left px-2 py-1.5 text-xs transition-colors mb-0.5 ${filterType === cat.category ? 'bg-brand-blue/20 text-rmpg-100' : 'text-rmpg-300 hover:bg-surface-raised'}`}
              >
                {formatEnumValue(cat.category)} <span className="text-rmpg-500">({cat.unread}/{cat.total})</span>
              </button>
            ))}
          </div>

          {/* 7-day mini chart */}
          {stats && stats.recent7Days.length > 0 && (
            <div className="p-2 border-t border-rmpg-700/50">
              <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Last 7 Days</div>
              <div className="flex items-end gap-0.5 h-8">
                {stats.recent7Days.map(d => {
                  const max = Math.max(...stats.recent7Days.map(x => x.count), 1);
                  return (
                    <div
                      key={d.date}
                      className="flex-1 bg-brand-blue/40 min-h-[2px]"
                      style={{ height: `${(d.count / max) * 100}%` }}
                      title={`${d.date}: ${d.count}`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Main notification list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {showPrefs && prefs ? (
            <div className="p-4 max-w-xl">
              <h2 className="text-sm font-bold text-rmpg-100 mb-4">Notification Preferences</h2>
              <div className="space-y-3">
                {Object.entries(prefs).filter(([k]) => typeof (prefs as any)[k] === 'boolean').map(([key, value]) => (
                  <label key={key} htmlFor={`pref-${key}`} className="flex items-center gap-3 text-xs text-rmpg-200 cursor-pointer">
                    <input id={`pref-${key}`}
                      type="checkbox"
                      checked={value as boolean}
                      onChange={(e) => setPrefs(prev => prev ? { ...prev, [key]: e.target.checked } : prev)}
                      className="accent-brand-blue"
                    />
                    {toDisplayLabel(key)}
                  </label>
                ))}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <label htmlFor="ff-notificationspage-1" className="text-[10px] text-rmpg-400 uppercase block mb-1">Quiet Hours Start</label>
                    <input id="ff-notificationspage-1"
                      type="time"
                      value={prefs.quiet_hours_start || ''}
                      onChange={(e) => setPrefs(prev => prev ? { ...prev, quiet_hours_start: e.target.value || null } : prev)}
                      className="input-dark"
                    />
                  </div>
                  <div>
                    <label htmlFor="ff-notificationspage-2" className="text-[10px] text-rmpg-400 uppercase block mb-1">Quiet Hours End</label>
                    <input id="ff-notificationspage-2"
                      type="time"
                      value={prefs.quiet_hours_end || ''}
                      onChange={(e) => setPrefs(prev => prev ? { ...prev, quiet_hours_end: e.target.value || null } : prev)}
                      className="input-dark"
                    />
                  </div>
                </div>
                <button type="button" onClick={savePrefs} disabled={savingPrefs} className="toolbar-btn toolbar-btn-primary mt-4">
                  {savingPrefs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save Preferences
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-rmpg-400" />
            </div>
          ) : visibleNotifications.length === 0 ? (
            (search.trim() && notifications.length > 0) ? (
              <div className="flex flex-col items-center justify-center py-20 text-rmpg-400">
                <FilterIcon className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">No titles match “{search}”</p>
                <button type="button" onClick={() => setSearch('')} className="mt-3 toolbar-btn text-[10px]">Clear search</button>
              </div>
            ) : (filterType || filterRead === '0') ? (
              <div className="flex flex-col items-center justify-center py-20 text-rmpg-400">
                <FilterIcon className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">No notifications match this filter</p>
                <button
                  type="button"
                  onClick={() => { setFilterType(''); setFilterRead(''); fetchNotifications(1); }}
                  className="mt-3 toolbar-btn text-[10px]"
                >
                  Clear filter
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-rmpg-400">
                <BellOff className="w-8 h-8 mb-2" />
                <p className="text-sm">You're all caught up</p>
                <p className="text-[10px] text-rmpg-500 mt-1">New notifications will appear here</p>
              </div>
            )
          ) : (
            <div className="divide-y divide-rmpg-700/30">
              {visibleNotifications.map(n => (
                <div
                  key={n.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(n.id, el);
                    else rowRefs.current.delete(n.id);
                  }}
                  onContextMenu={(e) => openMenu(e, buildNotificationMenu(n))}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                    n.is_read ? 'opacity-60 hover:opacity-80' : 'hover:bg-surface-raised'
                  } ${priorityColor(n.priority)} border-l-2 ${
                    highlightId === n.id ? 'ring-2 ring-brand-400 ring-inset bg-surface-raised' : ''
                  }`}
                >
                  {typeIcon(n.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${n.is_read ? 'text-rmpg-300' : 'text-rmpg-100'}`}>{n.title}</span>
                      {n.priority === 'critical' && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-red-700/50 text-red-300 font-bold uppercase tracking-wider">Critical</span>
                      )}
                      {n.priority === 'high' && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-amber-700/40 text-amber-300 font-bold uppercase tracking-wider">High</span>
                      )}
                    </div>
                    {n.body && <p className="text-[11px] text-rmpg-400 mt-0.5 line-clamp-2">{n.body}</p>}
                    <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                      <span>{toDisplayLabel(n.type)}</span>
                      <span title={formatDateTime(n.created_at)}>{(() => {
                        const ms = Date.now() - parseTimestamp(n.created_at).getTime();
                        const mins = Math.floor(ms / 60000);
                        if (mins < 1) return 'just now';
                        if (mins < 60) return `${mins}m ago`;
                        const hrs = Math.floor(mins / 60);
                        if (hrs < 24) return `${hrs}h ago`;
                        if (hrs < 48) return 'yesterday';
                        return `${Math.floor(hrs / 24)}d ago`;
                      })()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {routeForEntity(n) && (
                      <button
                        type="button"
                        onClick={() => openNotification(n)}
                        className="p-1 text-rmpg-400 hover:text-brand-400"
                        title={`Open linked ${n.entity_type ?? n.type}`}
                        aria-label={`Open linked ${n.entity_type ?? n.type}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {!n.is_read && (
                      <button type="button" onClick={() => markRead(n.id)} className="p-1 text-rmpg-400 hover:text-green-400" title="Mark read">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button type="button" onClick={() => snoozeNotification(n.id, 30)} className="p-1 text-rmpg-400 hover:text-amber-400" title="Snooze 30 min">
                      <Clock className="w-3.5 h-3.5" />
                    </button>
                    {n.priority !== 'normal' && (
                      <button type="button" onClick={() => escalateNotification(n.id)} className="p-1 text-rmpg-400 hover:text-red-400" title="Escalate">
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canManage && (
                      <button type="button" onClick={() => setConfirmDeleteId(n.id)} className="p-1 text-rmpg-400 hover:text-red-400" title="Delete notification (admin/manager/supervisor only)">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-3 border-t border-rmpg-700/50">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => fetchNotifications(pagination.page - 1)}
                className="toolbar-btn text-[10px]"
              >
                Previous
              </button>
              <span className="text-xs text-rmpg-400">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => fetchNotifications(pagination.page + 1)}
                className="toolbar-btn text-[10px]"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Per-row delete confirmation ── */}
      <ConfirmDialog
        isOpen={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId !== null) void deleteNotification(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        title="Delete this notification?"
        message="This permanently removes the notification from your inbox. This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
      />

      {/* ── Destructive bulk-sweep confirmations ──
            "Clear Read" and "Cleanup 30d+" both used to fire DELETE on
            click with zero confirmation. Misclicking either from the
            top-right of a busy CAD layout was a foot-gun. Now both flow
            through the same ConfirmDialog the rest of the app uses. */}
      <ConfirmDialog
        isOpen={confirmClearRead}
        onClose={() => setConfirmClearRead(false)}
        onConfirm={() => { void deleteReadNotifications(); }}
        title="Clear all read notifications?"
        message="This permanently deletes every notification you have already marked as read."
        details={
          <span className="text-rmpg-300">
            Estimated to delete{' '}
            <strong className="text-amber-300">{Math.max(0, (pagination.total ?? 0) - (stats?.totalUnread ?? 0))}</strong>{' '}
            read notification(s). Unread notifications stay.
          </span>
        }
        confirmLabel="Delete read"
        confirmVariant="danger"
        isLoading={sweepBusy}
      />
      <ConfirmDialog
        isOpen={confirmCleanupOld}
        onClose={() => setConfirmCleanupOld(false)}
        onConfirm={() => { void cleanupOld(); }}
        title="Cleanup notifications older than 30 days?"
        message="This permanently deletes every notification with a created_at older than 30 days, regardless of read state."
        details={
          <span className="text-rmpg-300">
            Use this to keep the inbox lean. Notifications already linked to
            audit_log / case timeline rows are NOT affected — those live in
            their own table.
          </span>
        }
        confirmLabel="Delete 30d+"
        confirmVariant="danger"
        isLoading={sweepBusy}
      />
    </div>
  );
}
