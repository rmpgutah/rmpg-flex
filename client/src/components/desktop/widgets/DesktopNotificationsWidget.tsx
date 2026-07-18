import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface NotificationRow { id: number; title: string; created_at: string }

export default function DesktopNotificationsWidget() {
  const [items, setItems] = useState<NotificationRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ data: NotificationRow[] }>('/notifications?per_page=5')
      .then(res => { if (!cancelled) setItems(res?.data ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 240 }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--rmpg-400)' }}>Notifications</div>
      {items.length === 0 ? (
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No recent notifications.</div>
      ) : (
        items.map(n => (
          <div key={n.id} className="text-[11px] py-1 truncate" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)' }}>
            {n.title}
          </div>
        ))
      )}
    </div>
  );
}
