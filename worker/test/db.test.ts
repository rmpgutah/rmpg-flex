import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createConversation,
  listConversations,
  getConversation,
  getMessages,
  addMessage,
} from '../src/db';

describe('db helpers', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM messages');
    await env.DB.exec('DELETE FROM conversations');
  });

  it('creates a conversation with default title', async () => {
    const convo = await createConversation(env.DB);
    expect(convo.title).toBe('New chat');
    expect(convo.id).toBeTruthy();
  });

  it('lists conversations newest-updated first', async () => {
    const a = await createConversation(env.DB);
    const b = await createConversation(env.DB);
    await addMessage(env.DB, { conversationId: a.id, role: 'user', content: 'hello a' });
    const list = await listConversations(env.DB);
    expect(list[0].id).toBe(a.id);
    expect(list[1].id).toBe(b.id);
  });

  it('getConversation returns null for unknown id', async () => {
    const result = await getConversation(env.DB, 'nonexistent');
    expect(result).toBeNull();
  });

  it('addMessage sets title from first user message', async () => {
    const convo = await createConversation(env.DB);
    await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: 'What is Kimi K3?' });
    const updated = await getConversation(env.DB, convo.id);
    expect(updated?.title).toBe('What is Kimi K3?');
  });

  it('addMessage does not overwrite title on later messages', async () => {
    const convo = await createConversation(env.DB);
    await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: 'first message' });
    await addMessage(env.DB, { conversationId: convo.id, role: 'assistant', content: 'a reply', model: 'test-model' });
    await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: 'second message' });
    const updated = await getConversation(env.DB, convo.id);
    expect(updated?.title).toBe('first message');
  });

  it('getMessages returns messages in chronological order', async () => {
    const convo = await createConversation(env.DB);
    await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: 'one' });
    await addMessage(env.DB, { conversationId: convo.id, role: 'assistant', content: 'two', model: 'test-model' });
    const messages = await getMessages(env.DB, convo.id);
    expect(messages.map((m) => m.content)).toEqual(['one', 'two']);
  });
});
