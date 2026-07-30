import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type Conversation = { id: string; title: string; updated_at: number };

export function Sidebar({
  activeId,
  onSelect,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await apiFetch('/conversations');
    if (!res.ok) {
      setError(`Failed to load conversations: ${res.statusText}`);
      return;
    }
    try {
      const data = (await res.json()) as { conversations: Conversation[] };
      setConversations(data.conversations);
      setError(null);
    } catch {
      setError('Failed to parse conversation data');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleNewChat() {
    const res = await apiFetch('/conversations', { method: 'POST' });
    if (!res.ok) {
      setError(`Failed to create chat: ${res.statusText}`);
      return;
    }
    try {
      const data = (await res.json()) as { conversation: Conversation };
      await refresh();
      onSelect(data.conversation.id);
    } catch {
      setError('Failed to parse new conversation data');
    }
  }

  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__brand-title">
          <span className="glyph">K</span>
          kimi-connect
        </div>
        <div className="sidebar__brand-sub">Private chat</div>
      </div>

      <button className="sidebar__new" onClick={handleNewChat}>
        <span className="plus">+</span>
        New chat
      </button>

      {error && <p className="sidebar__error" role="alert">{error}</p>}

      <ul className="sidebar__list">
        {conversations.length === 0 && !error && <li className="sidebar__empty">No conversations yet</li>}
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              className="sidebar__item"
              aria-current={c.id === activeId}
              onClick={() => onSelect(c.id)}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
