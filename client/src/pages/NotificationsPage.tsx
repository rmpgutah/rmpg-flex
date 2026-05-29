import { useState, useEffect, useCallback } from 'react';
import {
  Bell, BellOff, Check, CheckCheck, Clock, Settings, Trash2, AlertTriangle, X,
  Loader2, RefreshCw, ArrowUpRight,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { formatDateTime, parseTimestamp } from '../utils/dateUtils';

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
  const { user } = useAuth();
  const { addToast } = useToast();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [filterType, setFilterType] = useState<string>('');
  const [filterRead, setFilterRead] = useState<string>('');
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [categories, setCategories] = useState<{ category: string; total: number; unread: number }[]>([]);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Fetch notifications
  const fetchNotifications = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '25' });
      if (filterType) params.set('type', filterType);
      if (filterRead) params.set('is_read', filterRead);

      const res = await apiFetch<{ data: Notification[]; pagination: any }>(`/notifications?${params}`);
      setNotifications(res?.data || []);
      setPagination(res?.pagination || { page: 1, total: 0, totalPages: 0 });
    } catch {
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

  const deleteReadNotifications = async () => {
    try {
      const res = await apiFetch<{ deleted: number }>('/notifications/delete-read', { method: 'POST' });
      addToast(`Deleted ${res?.deleted || 0} read notifications`, 'success');
      fetchNotifications(1);
      fetchStats();
    } catch { addToast('Failed', 'error'); }
  };

  const cleanupOld = async () => {
    try {
      const res = await apiFetch<{ deleted: number }>('/notifications/cleanup', {
        method: 'POST', body: JSON.stringify({ days_old: 30 }),
      });
      addToast(`Cleaned up ${res?.deleted || 0} old notifications`, 'success');
      fetchNotifications(1);
      fetchStats();
    } catch { addToast('Cleanup failed', 'error'); }
  };

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
    if (type === 'dispatch') return <Bell className="w-4 h-4 text-gray-400" />;
    return <Bell className="w-4 h-4 text-rmpg-400" />;
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PanelTitleBar title="NOTIFICATIONS" icon={Bell}>
        <button type="button" onClick={markAllRead} className="toolbar-btn" title="Mark all as read">
          <CheckCheck className="w-3.5 h-3.5" /> Mark All Read
        </button>
        <button type="button" onClick={deleteReadNotifications} className="toolbar-btn" title="Delete all read">
          <Trash2 className="w-3.5 h-3.5" /> Clear Read
        </button>
        <button type="button" onClick={cleanupOld} className="toolbar-btn" title="Cleanup old notifications">
          <RefreshCw className="w-3.5 h-3.5" /> Cleanup 30d+
        </button>
        <button type="button" onClick={() => setShowPrefs(!showPrefs)} className={`toolbar-btn ${showPrefs ? 'toolbar-btn-primary' : ''}`}>
          <Settings className="w-3.5 h-3.5" /> Preferences
        </button>
      </PanelTitleBar>

      {/* Stats Bar */}
      {stats && (
        <div className="px-4 py-1.5 border-b border-rmpg-700/50 flex items-center gap-4 text-[10px] font-mono bg-surface-sunken flex-shrink-0">
          <span className="text-rmpg-400">Unread: <strong className="text-red-400">{stats.totalUnread}</strong></span>
          <span className="text-rmpg-400">Snoozed: <strong className="text-amber-400">{stats.totalSnoozed}</strong></span>
          {stats.byPriority.map(p => (
            <span key={p.priority} className={`${p.priority === 'critical' ? 'text-red-400' : p.priority === 'high' ? 'text-amber-400' : 'text-rmpg-400'}`}>
              {(p.priority || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}: {p.unread}/{p.total}
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
              className={`w-full text-left px-2 py-1.5 text-xs transition-colors mb-0.5 ${!filterType ? 'bg-brand-blue/20 text-white' : 'text-rmpg-300 hover:bg-surface-raised'}`}
            >
              All ({pagination.total})
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
                className={`w-full text-left px-2 py-1.5 text-xs transition-colors mb-0.5 ${filterType === cat.category ? 'bg-brand-blue/20 text-white' : 'text-rmpg-300 hover:bg-surface-raised'}`}
              >
                {cat.category} <span className="text-rmpg-500">({cat.unread}/{cat.total})</span>
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
        <div className="flex-1 overflow-y-auto">
          {showPrefs && prefs ? (
            <div className="p-4 max-w-xl">
              <h2 className="text-sm font-bold text-white mb-4">Notification Preferences</h2>
              <div className="space-y-3">
                {Object.entries(prefs).filter(([k]) => typeof (prefs as any)[k] === 'boolean').map(([key, value]) => (
                  <label key={key} className="flex items-center gap-3 text-xs text-rmpg-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={value as boolean}
                      onChange={(e) => setPrefs(prev => prev ? { ...prev, [key]: e.target.checked } : prev)}
                      className="accent-brand-blue"
                    />
                    {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </label>
                ))}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Quiet Hours Start</label>
                    <input
                      type="time"
                      value={prefs.quiet_hours_start || ''}
                      onChange={(e) => setPrefs(prev => prev ? { ...prev, quiet_hours_start: e.target.value || null } : prev)}
                      className="input-dark"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Quiet Hours End</label>
                    <input
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
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-rmpg-400">
              <BellOff className="w-8 h-8 mb-2" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-rmpg-700/30">
              {notifications.map(n => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                    n.is_read ? 'opacity-60 hover:opacity-80' : 'hover:bg-surface-raised'
                  } ${priorityColor(n.priority)} border-l-2`}
                >
                  {typeIcon(n.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${n.is_read ? 'text-rmpg-300' : 'text-white'}`}>{n.title}</span>
                      {n.priority === 'critical' && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-red-700/50 text-red-300 font-bold uppercase tracking-wider">Critical</span>
                      )}
                      {n.priority === 'high' && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-amber-700/40 text-amber-300 font-bold uppercase tracking-wider">High</span>
                      )}
                    </div>
                    {n.body && <p className="text-[11px] text-rmpg-400 mt-0.5 line-clamp-2">{n.body}</p>}
                    <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                      <span>{(n.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
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
                    <button type="button" onClick={() => deleteNotification(n.id)} className="p-1 text-rmpg-400 hover:text-red-400" title="Delete">
                      <X className="w-3.5 h-3.5" />
                    </button>
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
    </div>
  );
}
