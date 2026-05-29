import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseTimestamp } from '../../../utils/dateUtils';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';

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

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMessages = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<any>('/comms/messages?limit=5');
      const rows: MessageRow[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : [];
      setMessages(rows);
    } catch (err: any) {
      setError('Failed to load messages');
    } finally {
      setLoading(false);
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

  if (loading) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">MESSAGES</h2>
        <div className="h-[160px] animate-pulse bg-[#1a1a1a] border border-[#222]" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">MESSAGES</h2>
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
    <section className="bg-[#141414] border border-[#222] p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest">MESSAGES</h2>
        {unreadCount > 0 ? (
          <span className="text-[#d4a017] text-xs font-bold">Inbox · {unreadCount} new</span>
        ) : (
          <span className="text-gray-500 text-xs">Inbox · caught up</span>
        )}
      </div>

      {messages.length === 0 ? (
        <p className="text-gray-500 text-xs italic">No messages.</p>
      ) : (
        <ul>
          {topThree.map((m) => {
            const isUnread = m.read_at == null;
            const bodyText = (m.text || m.body || '').toString();
            const preview = bodyText.length > 60 ? `${bodyText.slice(0, 60)}…` : bodyText;
            const rowClass = [
              'py-2 border-b border-[#1a1a1a] last:border-b-0 text-white text-xs',
              isUnread ? 'border-l-2 border-l-[#d4a017] pl-2' : '',
            ].join(' ');
            return (
              <li key={m.id} className={rowClass}>
                <div className="flex items-baseline">
                  <span className="font-bold">{m.from_name || m.sender_name || 'Unknown'}</span>
                  <span className="text-gray-500 text-[11px] ml-2">
                    {m.created_at ? relativeTime(m.created_at) : ''}
                  </span>
                </div>
                <div className="text-gray-300 text-[11px] mt-0.5 line-clamp-1">{preview}</div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => navigate('/communications?inbox=me')}
        className="mt-2 w-full h-11 bg-[#1a1a1a] border border-[#222] text-[#d4a017] text-xs uppercase tracking-widest"
      >
        Open inbox
      </button>
    </section>
  );
}
