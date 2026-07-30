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

  async function refresh() {
    const res = await apiFetch('/conversations');
    const data = await res.json<{ conversations: Conversation[] }>();
    setConversations(data.conversations);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleNewChat() {
    const res = await apiFetch('/conversations', { method: 'POST' });
    const data = await res.json<{ conversation: Conversation }>();
    await refresh();
    onSelect(data.conversation.id);
  }

  return (
    <nav>
      <button onClick={handleNewChat}>New chat</button>
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
