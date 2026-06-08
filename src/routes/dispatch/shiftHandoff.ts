import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, queryFirst, execute } from '../../utils/db';

const handoff = new Hono<Env>();

handoff.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ text: string; updated_by: number | null; updated_at: string }>(
      db, 'SELECT text, updated_by, updated_at FROM shift_handoff WHERE id = 1',
    );
    return c.json(row ? {
      text: row.text ?? '',
      updated_by: row.updated_by ?? null,
      updated_at: row.updated_at ?? null,
    } : { text: '', updated_by: null, updated_at: null });
  } catch {
    return c.json({ text: '', updated_by: null, updated_at: null });
  }
});

handoff.put('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const body: any = await c.req.json().catch(() => ({}));
    const text = typeof (body as any)?.text === 'string' ? (body as any).text : '';
    await execute(db,
      `INSERT INTO shift_handoff (id, text, updated_by, updated_at) VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      text, userId ?? null,
    );
    const row = await queryFirst<{ text: string; updated_by: number | null; updated_at: string }>(
      db, 'SELECT text, updated_by, updated_at FROM shift_handoff WHERE id = 1',
    );
    return c.json({ success: true, ...row });
  } catch (err) {
    console.error('[shiftHandoff] PUT failed:', err);
    return c.json({ success: false, error: 'Failed to save shift handoff' }, 500);
  }
});

export default handoff;
