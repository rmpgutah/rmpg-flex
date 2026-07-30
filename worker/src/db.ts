export type Conversation = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: number;
};

function newId(): string {
  return crypto.randomUUID();
}

export async function createConversation(db: D1Database): Promise<Conversation> {
  const id = newId();
  const now = Date.now();
  await db
    .prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, 'New chat', now, now)
    .run();
  return { id, title: 'New chat', created_at: now, updated_at: now };
}

export async function listConversations(db: D1Database): Promise<Conversation[]> {
  const result = await db
    .prepare('SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC')
    .all<Conversation>();
  return result.results;
}

export async function getConversation(db: D1Database, id: string): Promise<Conversation | null> {
  const row = await db
    .prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?')
    .bind(id)
    .first<Conversation>();
  return row ?? null;
}

export async function getMessages(db: D1Database, conversationId: string): Promise<Message[]> {
  const result = await db
    .prepare('SELECT id, role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .bind(conversationId)
    .all<Message>();
  return result.results;
}

export async function addMessage(
  db: D1Database,
  params: { conversationId: string; role: 'user' | 'assistant'; content: string; model?: string }
): Promise<void> {
  const id = newId();
  const now = Date.now();

  await db
    .prepare('INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, params.conversationId, params.role, params.content, params.model ?? null, now)
    .run();

  const isFirstUserMessage =
    params.role === 'user' &&
    (
      await db
        .prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ? AND role = 'user'")
        .bind(params.conversationId)
        .first<{ count: number }>()
    )?.count === 1;

  if (isFirstUserMessage) {
    const title = params.content.slice(0, 60);
    await db
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .bind(title, now, params.conversationId)
      .run();
  } else {
    await db
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .bind(now, params.conversationId)
      .run();
  }
}
