import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Copy } from 'lucide-react';
import { parseTimestamp } from '../../../utils/dateUtils';
import { useNavigate } from 'react-router';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';
import { useContextMenu, type ContextMenuItem } from '../../../context/ContextMenuContext';
import { copyToClipboard, separator } from '../../../utils/contextMenuActions';

// See BolosCard for why we build menus inline (useMenuActions throws without
// ToastProvider/Router, which the bare-render tests don't mount).

// Endpoint: GET /api/comms/messages?limit=5
// Response shape: { data: [{ id, from_name, body, channel, created_at, read_at, ... }], unreadCount }
// WS event: 'new_message' (broadcast from comms.ts via broadcastNewMessage)

interface MessageRow {
  id: number;
  from_user_id?: number;
  from_name?: string;
  body?: string;
  text?: string;
  channel?: string;
  created_at?: string;
  read_at?: string | null;
  [k: string]: any;
}

function relativeTime(iso: string): string {
  if (!iso) return '';
  const s = (Date.now() - parseTimestamp(iso).getTime()) / 1000;
  if (isNaN(s)) return '';
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function MessagesCard() {
  const navigate = useNavigate();
  const { subscribe } = useWebSocket();
  const { openMenu } = useContextMenu();

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchMessages = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<any>('/comms/messages?limit=5');
      if (!mountedRef.current) return;
      const rows: MessageRow[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : [];
      setMessages(rows);
    } catch (err) {
      if (!mountedRef.current) return;
      setError('Failed to load messages');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const trigger = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { fetchMessages(); }, 250);
    };
    const unsub = subscribe('new_message', trigger);
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [subscribe, fetchMessages]);

  const unreadCount = useMemo(
    () => messages.filter((m) => m.read_at == null).length,
    [messages],
  );

  const topThree = useMemo(() => {
    const sorted = [...messages].sort((a, b) => {
      const ta = a.created_at ? parseTimestamp(a.created_at).getTime() : 0;
      const tb = b.created_at ? parseTimestamp(b.created_at).getTime() : 0;
      return tb - ta;
    });
    return sorted.slice(0, 3);
  }, [messages]);

  // Right-click menu for a message row. 'Open' reuses the inbox navigation
  // (no per-message route exists); copy items use the standalone clipboard
  // helper (no toast).
  const buildMessageMenu = (m: MessageRow): ContextMenuItem[] => {
    const sender = m.from_name || m.sender_name || 'Unknown';
    const bodyText = (m.text || m.body || '').toString();
    const items: ContextMenuItem[] = [
      {
        label: 'Open inbox',
        icon: <Eye size={12} />,
        onClick: () => navigate('/communications?inbox=me'),
      },
      separator(),
      {
        label: 'Copy sender',
        icon: <Copy size={12} />,
        onClick: () => { void copyToClipboard(sender); },
      },
    ];
    if (bodyText) {
      items.push({
        label: 'Copy message',
        icon: <Copy size={12} />,
        onClick: () => { void copyToClipboard(bodyText); },
      });
    }
    return items;
  };

  if (loading) {
    return (
      <section className="bg-surface-base border border-border-default p-3">
        <h2 className="text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest mb-2">MESSAGES</h2>
        <div className="h-[160px] animate-pulse bg-surface-raised border border-border-default" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-surface-base border border-border-default p-3">
        <h2 className="text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest mb-2">MESSAGES</h2>
        <div className="flex items-center justify-between gap-2">
          <span className="text-amber-400 text-xs">{error}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchMessages(); }}
            className="min-h-[44px] h-11 px-3 bg-amber-900/30 border border-amber-700 text-amber-200 text-xs uppercase tracking-widest"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-surface-base border border-border-default p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest">MESSAGES</h2>
        {unreadCount > 0 ? (
          <span className="text-[color:var(--field-label-color)] text-xs font-bold">Inbox · {unreadCount} new</span>
        ) : (
          <span className="text-rmpg-500 text-xs">Inbox · caught up</span>
        )}
      </div>

      {messages.length === 0 ? (
        <p className="text-rmpg-500 text-xs italic">No messages.</p>
      ) : (
        <ul>
          {topThree.map((m) => {
            const isUnread = m.read_at == null;
            const bodyText = (m.text || m.body || '').toString();
            const preview = bodyText.length > 60 ? `${bodyText.slice(0, 60)}…` : bodyText;
            const rowClass = [
              'py-2 border-b border-border-default last:border-b-0 text-rmpg-100 text-xs',
              isUnread ? 'border-l-2 border-l-accent-silver-400 pl-2' : '',
            ].join(' ');
            return (
              <li key={m.id} className={rowClass} onContextMenu={(e) => openMenu(e, buildMessageMenu(m))}>
                <div className="flex items-baseline">
                  <span className="font-bold">{m.from_name || m.sender_name || 'Unknown'}</span>
                  <span className="text-rmpg-500 text-[11px] ml-2">
                    {m.created_at ? relativeTime(m.created_at) : ''}
                  </span>
                </div>
                <div className="text-rmpg-300 text-[11px] mt-0.5 line-clamp-1">{preview}</div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => navigate('/communications?inbox=me')}
        className="mt-2 w-full h-11 bg-surface-raised border border-border-default text-[color:var(--field-label-color)] text-xs uppercase tracking-widest"
      >
        Open inbox
      </button>
    </section>
  );
}
