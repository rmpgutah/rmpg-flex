import React, { useState, useEffect, useCallback } from 'react';
import { X, Bell, CheckCheck, AlertTriangle, Info, Shield, Car } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { parseTimestamp } from '../../utils/dateUtils';
import { TASKBAR_HEIGHT_PX } from './DesktopTaskbar';
import { getTaskbarPosition, getTaskbarSize } from '../../utils/taskbarPreferences';

interface Notification {
  id: number;
  type: string;
  priority: string;
  title: string;
  message: string;
  entity_type?: string;
  entity_id?: number;
  is_read: number;
  created_at: string;
}

interface NotifResponse {
  notifications: Notification[];
  total: number;
  unread: number;
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'var(--sev-critical, #ef4444)',
  high: 'var(--sev-high, #f97316)',
  medium: 'var(--sev-medium, #f59e0b)',
  low: 'var(--text-muted, #8da0b3)',
  info: 'var(--accent-silver-400, #c3ccd6)',
};

function notifIcon(type: string) {
  if (type.includes('warrant') || type.includes('alpr') || type.includes('watchlist')) return Shield;
  if (type.includes('vehicle') || type.includes('plate')) return Car;
  if (type.includes('alert') || type.includes('warn')) return AlertTriangle;
  return Info;
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - parseTimestamp(iso).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export interface DesktopNotificationCenterProps {
  onClose: () => void;
}

export default function DesktopNotificationCenter({ onClose }: DesktopNotificationCenterProps) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');

  const taskbarSize = getTaskbarSize();
  const taskbarPos = getTaskbarPosition();
  const barH = TASKBAR_HEIGHT_PX[taskbarSize];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ per_page: '50', ...(filter === 'unread' ? { unread: 'true' } : {}) });
      const res = await apiFetch<NotifResponse>(`/notifications?${params}`);
      setNotifs(res?.notifications ?? []);
      setTotal(res?.total ?? 0);
      setUnread(res?.unread ?? 0);
    } catch { /* silent */ }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const markRead = useCallback(async (id: number) => {
    await apiFetch(`/notifications/${id}/read`, { method: 'PUT' }).catch(() => {});
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
    setUnread(prev => Math.max(0, prev - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await apiFetch('/notifications/mark-all-read', { method: 'POST' }).catch(() => {});
    setNotifs(prev => prev.map(n => ({ ...n, is_read: 1 })));
    setUnread(0);
  }, []);

  // Panel placement: right side, above/below taskbar depending on position
  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    right: 8,
    width: 360,
    maxHeight: `calc(100vh - ${barH + 16}px)`,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--surface-raised, #1a3050)',
    border: '1px solid var(--border-default, rgba(195,204,214,0.15))',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    zIndex: 1050,
    ...(taskbarPos === 'top' ? { top: barH + 8 } : { bottom: barH + 8 }),
  };

  return (
    <div style={panelStyle} role="region" aria-label="Notification center">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 8px', borderBottom: '1px solid var(--border-subtle, rgba(195,204,214,0.1))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell className="w-4 h-4" style={{ color: 'var(--accent-silver-400, #c3ccd6)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #f0f4f9)', letterSpacing: '0.05em' }}>
            Notifications
          </span>
          {unread > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--sev-critical, #ef4444)', color: '#fff', borderRadius: 9, padding: '1px 5px' }}>
              {unread}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              aria-label="Mark all as read"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted, #8da0b3)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}
            >
              <CheckCheck className="w-3.5 h-3.5" />
              All read
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close notification center" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted, #8da0b3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle, rgba(195,204,214,0.1))' }}>
        {(['unread', 'all'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: '6px 0',
              fontSize: 10,
              fontWeight: filter === f ? 600 : 400,
              background: filter === f ? 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.2)' : 'transparent',
              color: filter === f ? 'var(--text-primary, #f0f4f9)' : 'var(--text-muted, #8da0b3)',
              border: 'none',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {f === 'unread' ? `Unread${unread > 0 ? ` (${unread})` : ''}` : `All (${total})`}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted, #8da0b3)' }}>Loading…</div>
        ) : notifs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Bell className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--border-default, rgba(195,204,214,0.2))' }} />
            <div style={{ fontSize: 11, color: 'var(--text-muted, #8da0b3)' }}>
              {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
            </div>
          </div>
        ) : notifs.map(n => {
          const Icon = notifIcon(n.type);
          const prioColor = PRIORITY_COLOR[n.priority] ?? PRIORITY_COLOR.info;
          const isUnread = !n.is_read;
          return (
            <div
              key={n.id}
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border-subtle, rgba(195,204,214,0.06))',
                background: isUnread ? 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.3)' : 'transparent',
                cursor: isUnread ? 'pointer' : 'default',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
              onClick={() => { if (isUnread) markRead(n.id); }}
            >
              <div style={{ marginTop: 1, flexShrink: 0 }}>
                <Icon className="w-3.5 h-3.5" style={{ color: prioColor }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: isUnread ? 600 : 400, color: 'var(--text-primary, #f0f4f9)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {n.title}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary, #adbccc)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {n.message}
                </div>
                <div style={{ marginTop: 4, fontSize: 9, color: 'var(--text-muted, #8da0b3)' }}>
                  {relativeTime(n.created_at)}
                  {' · '}
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: prioColor }}>{n.priority}</span>
                </div>
              </div>
              {isUnread && (
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sev-critical, #ef4444)', flexShrink: 0, marginTop: 4 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
