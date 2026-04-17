// Email rule engine — evaluated by the poller on each new inbound message.
//
// Rules live in the `email_rules` table. Each rule has a JSON `conditions` block (AND-matched)
// and a JSON `actions` array (executed in order). Every action gets a 50ms timeout so a single
// slow rule cannot stall the poller's sync loop.
//
// Action `forward` records intent only — the actual send is deferred to Phase 4 when per-user
// mailboxes make "who is sending on behalf of" a solved question.

import type BetterSqlite3 from 'better-sqlite3';
import { localNow } from './timeUtils';

export interface RuleConditions {
  sender_regex?: string;
  subject_regex?: string;
  body_contains?: string;
  has_attachment?: boolean;
  importance?: 'low' | 'normal' | 'high';
}

export interface RuleAction {
  type: 'move' | 'flag' | 'categorize' | 'link' | 'forward';
  folder_id?: string;
  category?: string;
  entity_type?: string;
  entity_id?: string | number;
  forward_to?: string[];
}

export interface Rule {
  id: number;
  name: string;
  priority: number;
  enabled: number;
  conditions_json: string;
  actions_json: string;
}

interface EmailLike {
  from_address: string;
  subject: string;
  body_text: string;
  has_attachments: number;
  importance: string;
}

export function matchesConditions(cond: RuleConditions, email: EmailLike): boolean {
  if (cond.sender_regex) {
    try {
      if (!new RegExp(cond.sender_regex, 'i').test(email.from_address || '')) return false;
    } catch {
      return false;
    }
  }
  if (cond.subject_regex) {
    try {
      if (!new RegExp(cond.subject_regex, 'i').test(email.subject || '')) return false;
    } catch {
      return false;
    }
  }
  if (cond.body_contains) {
    if (!String(email.body_text || '').toLowerCase().includes(cond.body_contains.toLowerCase())) return false;
  }
  if (cond.has_attachment !== undefined) {
    if (Boolean(email.has_attachments) !== cond.has_attachment) return false;
  }
  if (cond.importance) {
    if ((email.importance || 'normal').toLowerCase() !== cond.importance) return false;
  }
  return true;
}

function runAction(db: BetterSqlite3.Database, emailId: number, action: RuleAction): { ok: boolean; detail?: string } {
  try {
    switch (action.type) {
      case 'flag':
        db.prepare('UPDATE email_cache SET is_flagged = 1 WHERE id = ?').run(emailId);
        return { ok: true };
      case 'move':
        if (!action.folder_id) return { ok: false, detail: 'missing folder_id' };
        db.prepare('UPDATE email_cache SET folder_id = ? WHERE id = ?').run(action.folder_id, emailId);
        return { ok: true };
      case 'categorize': {
        if (!action.category) return { ok: false, detail: 'missing category' };
        const row = db.prepare('SELECT categories FROM email_cache WHERE id = ?').get(emailId) as any;
        let cats: string[] = [];
        try { cats = JSON.parse(row?.categories || '[]'); } catch { cats = []; }
        if (!cats.includes(action.category)) cats.push(action.category);
        db.prepare('UPDATE email_cache SET categories = ? WHERE id = ?').run(JSON.stringify(cats), emailId);
        return { ok: true };
      }
      case 'link': {
        if (!action.entity_type || action.entity_id == null) return { ok: false, detail: 'missing entity' };
        const e = db.prepare('SELECT graph_id FROM email_cache WHERE id = ?').get(emailId) as any;
        if (!e?.graph_id) return { ok: false, detail: 'no graph_id' };
        db.prepare('INSERT INTO email_links (email_graph_id, entity_type, entity_id, auto_linked, created_at) VALUES (?,?,?,1,?)')
          .run(e.graph_id, action.entity_type, String(action.entity_id), localNow());
        return { ok: true };
      }
      case 'forward':
        return { ok: true, detail: 'forward queued' };
      default:
        return { ok: false, detail: 'unknown action' };
    }
  } catch (err: any) {
    return { ok: false, detail: err.message || 'action error' };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

export async function evaluateRulesForEmail(db: BetterSqlite3.Database, emailId: number): Promise<void> {
  const email = db.prepare(
    `SELECT ec.id, ec.from_address, ec.subject, ec.has_attachments, ec.importance,
       COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id), '') as body_text
     FROM email_cache ec WHERE ec.id = ?`
  ).get(emailId) as any;
  if (!email) return;

  const rules = db.prepare('SELECT * FROM email_rules WHERE enabled = 1 ORDER BY priority ASC').all() as Rule[];
  for (const rule of rules) {
    let cond: RuleConditions;
    let actions: RuleAction[];
    try {
      cond = JSON.parse(rule.conditions_json);
      actions = JSON.parse(rule.actions_json);
    } catch {
      continue;
    }

    if (!matchesConditions(cond, email)) continue;

    const results: Array<{ action: string; ok: boolean; detail?: string }> = [];
    for (const action of actions) {
      try {
        const r = await withTimeout(Promise.resolve(runAction(db, emailId, action)), 50, `rule:${rule.id}:${action.type}`);
        results.push({ action: action.type, ok: r.ok, detail: r.detail });
      } catch (err: any) {
        results.push({ action: action.type, ok: false, detail: err.message });
      }
    }
    db.prepare('INSERT INTO email_rule_matches (email_cache_id, rule_id, executed_at, action_result) VALUES (?,?,?,?)')
      .run(emailId, rule.id, localNow(), JSON.stringify(results));
  }
}
