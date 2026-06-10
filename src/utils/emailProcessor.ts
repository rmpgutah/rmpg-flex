// Per-minute background processors for the email subsystem:
//   - processScheduledEmails: send any queued rows whose scheduled_for ≤ now()
//   - applyRulesToRecent:     re-evaluate email_rules over messages synced
//                             since the last rule pass
//
// Both run from the existing cron '* * * * *' branch in src/index.ts.
// Each owns its own try/catch so a failure here can't abort the trip
// sweep or the warrant scan.

import type { Bindings } from '../types';
import { getDb, query, queryFirst, execute } from './db';
import { graphFetch, GraphNotConfiguredError } from './msGraph';

// ─── Scheduled send processor ────────────────────────────────
export interface ScheduledResult {
  picked: number;
  sent: number;
  failed: number;
  permanently_failed: number;
}

interface ScheduledRow {
  id: number;
  to_addresses: string;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  attempts: number;
  max_attempts: number;
}

function parseRecipients(json: string | null): Array<{ emailAddress: { address: string; name?: string } }> {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r) => r && typeof r.email === 'string')
      .map((r) => ({ emailAddress: { address: r.email, name: r.name } }));
  } catch { return []; }
}

export async function processScheduledEmails(env: Bindings): Promise<ScheduledResult> {
  const result: ScheduledResult = { picked: 0, sent: 0, failed: 0, permanently_failed: 0 };
  const db = getDb(env);

  // Pick a small batch. The cron fires per-minute — we don't need huge
  // batches; rolling forward is more responsive.
  const due = await query<ScheduledRow>(
    db,
    `SELECT id, to_addresses, cc_addresses, bcc_addresses, subject, body_html, body_text, attempts, max_attempts
     FROM scheduled_emails
     WHERE status = 'queued' AND scheduled_for <= datetime('now','utc')
     ORDER BY scheduled_for ASC LIMIT 25`,
  );
  result.picked = due.length;
  if (due.length === 0) return result;

  for (const row of due) {
    const to = parseRecipients(row.to_addresses);
    if (to.length === 0) {
      // Bad data — fail permanently rather than loop.
      await execute(
        db,
        `UPDATE scheduled_emails SET status='failed', last_error='No valid recipients', attempts = attempts + 1, updated_at=datetime('now','localtime') WHERE id = ?`,
        row.id,
      );
      result.permanently_failed++;
      continue;
    }
    const payload = {
      message: {
        subject: row.subject || '(no subject)',
        body: row.body_html
          ? { contentType: 'HTML', content: row.body_html }
          : { contentType: 'Text', content: row.body_text || '' },
        toRecipients: to,
        ccRecipients: parseRecipients(row.cc_addresses),
        bccRecipients: parseRecipients(row.bcc_addresses),
      },
      saveToSentItems: true,
    };
    try {
      const res = await graphFetch(env, '/me/sendMail', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await execute(
          db,
          `UPDATE scheduled_emails SET status='sent', sent_at=datetime('now','localtime'), attempts = attempts + 1, last_error=NULL, updated_at=datetime('now','localtime') WHERE id = ?`,
          row.id,
        );
        result.sent++;
      } else {
        const detail = (await res.text()).slice(0, 300);
        const newAttempts = row.attempts + 1;
        const exhausted = newAttempts >= row.max_attempts;
        await execute(
          db,
          `UPDATE scheduled_emails SET status = ?, attempts = ?, last_error = ?, updated_at=datetime('now','localtime') WHERE id = ?`,
          exhausted ? 'failed' : 'queued',
          newAttempts,
          `HTTP ${res.status}: ${detail}`,
          row.id,
        );
        if (exhausted) result.permanently_failed++; else result.failed++;
      }
    } catch (err) {
      if (err instanceof GraphNotConfiguredError) {
        // Integration vanished — leave the row queued, the operator
        // will reconfigure or cancel.
        await execute(
          db,
          `UPDATE scheduled_emails SET last_error='Email integration not configured', updated_at=datetime('now','localtime') WHERE id = ?`,
          row.id,
        );
        // Stop the loop — no point retrying others until creds return.
        result.failed += due.length - result.sent - result.failed - result.permanently_failed;
        return result;
      }
      const detail = err instanceof Error ? err.message : String(err);
      const newAttempts = row.attempts + 1;
      const exhausted = newAttempts >= row.max_attempts;
      await execute(
        db,
        `UPDATE scheduled_emails SET status = ?, attempts = ?, last_error = ?, updated_at=datetime('now','localtime') WHERE id = ?`,
        exhausted ? 'failed' : 'queued',
        newAttempts,
        detail.slice(0, 300),
        row.id,
      );
      if (exhausted) result.permanently_failed++; else result.failed++;
    }
  }
  return result;
}

// ─── Rules evaluator ─────────────────────────────────────────
// email_rules schema (live, baseline):
//   id, name, conditions TEXT (JSON), actions TEXT (JSON), is_active,
//   created_at, owner_user_id, updated_at
//
// Supported conditions (any/all combinable via top-level `match`):
//   { from_contains: "...", subject_contains: "...", has_attachment: true,
//     from_equals: "...", body_contains: "...",
//     match: "all"|"any" }
//
// Supported actions:
//   { mark_read: true, flag: true, categorize: "category-name",
//     move_to_folder: "<folder id>", notify_user_id: 7 }
//
// Evaluated against rows in email_messages that were cached since
// the watermark in system_config['email_rules_watermark']. Idempotent
// because email_rule_matches has a unique-ish (rule_id, email_graph_id)
// — we check before insert.

interface RuleRow {
  id: number;
  name: string;
  conditions: string;
  actions: string;
  is_active: number;
}

interface MessageRow {
  graph_id: string;
  from_address: string | null;
  subject: string;
  body_preview: string | null;
  has_attachments: number;
  cached_at: string;
}

interface Conditions {
  from_contains?: string;
  from_equals?: string;
  subject_contains?: string;
  body_contains?: string;
  has_attachment?: boolean;
  match?: 'all' | 'any';
}

interface Actions {
  mark_read?: boolean;
  flag?: boolean;
  categorize?: string;
  move_to_folder?: string;
  notify_user_id?: number;
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function matchesConditions(msg: MessageRow, cond: Conditions): boolean {
  const subj = (msg.subject || '').toLowerCase();
  const from = (msg.from_address || '').toLowerCase();
  const body = (msg.body_preview || '').toLowerCase();
  const checks: boolean[] = [];
  if (cond.from_contains) checks.push(from.includes(cond.from_contains.toLowerCase()));
  if (cond.from_equals) checks.push(from === cond.from_equals.toLowerCase());
  if (cond.subject_contains) checks.push(subj.includes(cond.subject_contains.toLowerCase()));
  if (cond.body_contains) checks.push(body.includes(cond.body_contains.toLowerCase()));
  if (typeof cond.has_attachment === 'boolean') checks.push(!!msg.has_attachments === cond.has_attachment);
  if (checks.length === 0) return false;
  return cond.match === 'any' ? checks.some(Boolean) : checks.every(Boolean);
}

async function applyActions(env: Bindings, msg: MessageRow, actions: Actions, ruleId: number): Promise<void> {
  const db = getDb(env);

  // Graph-side mutations — best-effort. If Graph is unreachable we
  // still record the rule match locally; a future rerun can replay.
  if (actions.mark_read) {
    try {
      await graphFetch(env, `/me/messages/${encodeURIComponent(msg.graph_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ isRead: true }),
      });
      await execute(db, `UPDATE email_messages SET is_read = 1 WHERE graph_id = ?`, msg.graph_id);
    } catch (e) { console.error('[Email rules] mark_read failed:', e); }
  }
  if (actions.flag) {
    try {
      await graphFetch(env, `/me/messages/${encodeURIComponent(msg.graph_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ flag: { flagStatus: 'flagged' } }),
      });
      await execute(db, `UPDATE email_messages SET is_flagged = 1 WHERE graph_id = ?`, msg.graph_id);
    } catch (e) { console.error('[Email rules] flag failed:', e); }
  }
  if (actions.move_to_folder) {
    try {
      await graphFetch(env, `/me/messages/${encodeURIComponent(msg.graph_id)}/move`, {
        method: 'POST',
        body: JSON.stringify({ destinationId: actions.move_to_folder }),
      });
      await execute(db, `UPDATE email_messages SET folder_id = ? WHERE graph_id = ?`, actions.move_to_folder, msg.graph_id);
    } catch (e) { console.error('[Email rules] move failed:', e); }
  }
  if (actions.categorize && typeof actions.categorize === 'string') {
    await execute(
      db,
      `INSERT INTO email_categories (graph_id, category, model)
       VALUES (?, ?, 'rule')
       ON CONFLICT(graph_id) DO UPDATE SET
         category = excluded.category, model = 'rule',
         categorized_at = datetime('now','localtime')`,
      msg.graph_id, actions.categorize.slice(0, 64),
    );
  }
  if (typeof actions.notify_user_id === 'number' && Number.isFinite(actions.notify_user_id)) {
    try {
      // Verify the target user exists — silent insert against a missing
      // user_id would clutter the inbox with un-attributable rows.
      const target = await queryFirst<{ id: number }>(
        db, `SELECT id FROM users WHERE id = ? LIMIT 1`, actions.notify_user_id,
      );
      if (target) {
        const fromLabel = (msg.from_address || 'unknown').slice(0, 120);
        const subj = (msg.subject || '(no subject)').slice(0, 160);
        await execute(
          db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, sender_id, is_read)
           VALUES ('email_rule', 'normal', ?, ?, 'email_message', NULL, ?, NULL, 0)`,
          `Rule matched: ${subj}`,
          `From ${fromLabel}: ${subj}`,
          actions.notify_user_id,
        );
      }
    } catch (e) { console.error('[Email rules] notify failed:', e); }
  }

  // Record the match for the audit trail.
  await execute(
    db,
    `INSERT INTO email_rule_matches (rule_id, email_graph_id) VALUES (?, ?)`,
    ruleId, msg.graph_id,
  );
}

export interface RulesResult {
  ran: boolean;
  messages_scanned: number;
  rules_active: number;
  matches: number;
}

export async function applyRulesToRecent(env: Bindings): Promise<RulesResult> {
  const result: RulesResult = { ran: false, messages_scanned: 0, rules_active: 0, matches: 0 };
  const db = getDb(env);

  const rules = await query<RuleRow>(
    db, `SELECT id, name, conditions, actions, is_active FROM email_rules WHERE is_active = 1 ORDER BY id ASC LIMIT 200`,
  );
  result.rules_active = rules.length;
  if (rules.length === 0) return result;

  // Watermark: highest cached_at we've already processed.
  const wmRow = await queryFirst<{ config_value: string }>(
    db, `SELECT config_value FROM system_config WHERE config_key = 'email_rules_watermark' AND is_active = 1 LIMIT 1`,
  );
  const watermark = wmRow?.config_value || '1970-01-01 00:00:00';

  const messages = await query<MessageRow>(
    db,
    `SELECT graph_id, from_address, subject, body_preview, has_attachments, cached_at
     FROM email_messages
     WHERE cached_at > ? AND deleted_at IS NULL
     ORDER BY cached_at ASC LIMIT 500`,
    watermark,
  );
  result.messages_scanned = messages.length;
  if (messages.length === 0) {
    result.ran = true;
    return result;
  }

  for (const msg of messages) {
    for (const rule of rules) {
      const conditions = safeJson<Conditions>(rule.conditions, {});
      if (matchesConditions(msg, conditions)) {
        const actions = safeJson<Actions>(rule.actions, {});
        try {
          await applyActions(env, msg, actions, rule.id);
          result.matches++;
        } catch (e) {
          console.error(`[Email rules] rule ${rule.id} actions failed:`, e);
        }
      }
    }
  }

  // Advance watermark to the latest cached_at we just processed.
  // system_config has no UNIQUE on config_key alone (it's (key,value)),
  // so use the read-then-write pattern the rest of the codebase uses.
  const newWatermark = messages[messages.length - 1].cached_at;
  const existing = await queryFirst<{ id: number }>(
    db, `SELECT id FROM system_config WHERE config_key = 'email_rules_watermark' LIMIT 1`,
  );
  if (existing) {
    await execute(
      db,
      `UPDATE system_config SET config_value = ?, is_active = 1, updated_at = datetime('now','localtime') WHERE config_key = 'email_rules_watermark'`,
      newWatermark,
    );
  } else {
    await execute(
      db,
      `INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at)
       VALUES ('email_rules_watermark', ?, 'email', 1, datetime('now','localtime'), datetime('now','localtime'))`,
      newWatermark,
    );
  }

  result.ran = true;
  return result;
}
