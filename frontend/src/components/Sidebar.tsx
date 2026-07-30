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
      const data = await res.json<{ conversations: Conversation[] }>();
      setConversations(data.conversations);
      setError(null);
    } catch (err) {
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
      const data = await res.json<{ conversation: Conversation }>();
      await refresh();
      onSelect(data.conversation.id);
    } catch (err) {
      setError('Failed to parse new conversation data');
    }
  }

  return (
    <nav>
      <button onClick={handleNewChat}>New chat</button>
      {error && <p role="alert">{error}</p>}
      <ul>
        {conversations.map((c) => (
          <li key={c.id}>
            <button aria-current={c.id === activeId} onClick={() => onSelect(c.id)}>
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
