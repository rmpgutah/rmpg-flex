// ============================================================
// RMPG Flex — Notification Rule Engine
// ============================================================
// Backs the Admin → Alert Rules tab. Rules live in the
// notification_rules table (migration 0070). The engine is invoked
// from real event points in the dispatcher (e.g. POST /dispatch/calls
// emits 'call_created_p1' / 'call_created_p2') and fans matching
// rules out into per-user rows in the `notifications` table, which
// the NotificationsPage / unread-count poller already consume.
//
// Design notes:
//   - Best-effort: evaluateNotificationRules NEVER throws into the
//     triggering request. A broken rule must not 500 a 911 call entry.
//   - conditions is a flat JSON object {field: expected}. Empty {}
//     means "always fire". Matching is stringified equality so the
//     admin UI can stay schema-light.
//   - target_roles + target_user_ids are unioned; roles expand to all
//     active users with that role.
// ============================================================

import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import { query, execute } from '../utils/db';
import { emitAlert } from '../utils/alertHub';

// The complete set of valid role strings in this system. Used to allowlist
// roles parsed from target_roles JSON so an oversized or malicious JSON blob
// can never exceed D1's 100-parameter cap on a single query.
const KNOWN_ROLES = new Set([
  'admin', 'manager', 'supervisor', 'officer',
  'dispatcher', 'contract_manager', 'client_viewer', 'human_resources',
]);

export interface NotifyContext {
  title?: string;
  message?: string;
  priority?: string;
  entity_type?: string;
  entity_id?: number;
  [key: string]: unknown;
}

export interface NotificationRuleRow {
  id: number;
  name: string;
  description: string | null;
  trigger_event: string;
  conditions: string;
  target_roles: string;
  target_user_ids: string;
  notification_type: string;
  is_active: number;
}

/**
 * Evaluate every active rule for `triggerEvent` and notify matching
 * targets. Returns counts for logging/observability. Never throws.
 */
export async function evaluateNotificationRules(
  db: D1Database,
  triggerEvent: string,
  context: NotifyContext = {},
  // Pass c.env so matched notifications fan out LIVE via AlertHubDO (the shared
  // cross-worker bus). Optional so existing/test callers still work — they just
  // skip the live push and the row still lands (poll/reload picks it up).
  env?: { ALERT_HUB?: DurableObjectNamespace },
  // Per-event recipients that aren't expressible as a rule's static
  // target_roles/target_user_ids — e.g. "the person who requested this
  // specific swap." Unioned with the rule's statically-resolved targets in
  // fireRule. Added for shift-plan swap approve/deny notifications; any
  // future event with a per-instance recipient can reuse this instead of
  // bypassing the rule engine.
  dynamicUserIds?: number[],
): Promise<{ rulesMatched: number; notified: number }> {
  let rulesMatched = 0;
  let notified = 0;
  try {
    const rules = await query<NotificationRuleRow>(
      db,
      `SELECT * FROM notification_rules WHERE trigger_event = ? AND is_active = 1`,
      triggerEvent,
    );
    for (const rule of rules) {
      if (!matchesConditions(rule.conditions, context)) continue;
      rulesMatched++;
      notified += await fireRule(db, rule, context, {}, env, dynamicUserIds);
    }
  } catch {
    // Swallow — the engine must never break the event that triggered it.
  }
  return { rulesMatched, notified };
}

/**
 * Insert notifications for a single rule's resolved targets. Used by
 * both the live engine and the admin "Test" button (testPrefix tags
 * the title so recipients know it was a drill). Bumps fire_count.
 */
export async function fireRule(
  db: D1Database,
  rule: NotificationRuleRow,
  context: NotifyContext = {},
  opts: { testPrefix?: boolean } = {},
  env?: { ALERT_HUB?: DurableObjectNamespace },
  dynamicUserIds?: number[],
): Promise<number> {
  const staticTargets = await resolveTargets(db, rule.target_roles, rule.target_user_ids);
  const userIds = [...new Set([...staticTargets, ...(dynamicUserIds ?? [])])];
  if (userIds.length === 0) return 0;

  const prefix = opts.testPrefix ? '[TEST] ' : '';
  const title = prefix + (context.title || rule.name);
  const message = context.message || rule.description || `Triggered by ${rule.trigger_event}`;
  const priority = context.priority || 'normal';

  for (const uid of userIds) {
    await execute(
      db,
      `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
      'alert', priority, title, message,
      context.entity_type ?? 'notification_rule', context.entity_id ?? rule.id, uid,
    );
  }
  await execute(
    db,
    `UPDATE notification_rules SET last_fired_at = datetime('now'), fire_count = fire_count + 1 WHERE id = ?`,
    rule.id,
  );

  // LIVE delivery — nudge every targeted user's notification bell over the
  // shared AlertHubDO bus. broadcastAll() is per-isolate-dead here (the client's
  // main socket is on the legacy worker), so without this a rule notification
  // only surfaced on a full page reload. The frame carries the target ids; the
  // client refetches its own user-scoped unread count, so a frame meant for
  // someone else is a harmless no-op. Best-effort — never break the trigger.
  if (env?.ALERT_HUB) {
    try {
      await emitAlert(env, 'notification', { action: 'notification_created', user_ids: userIds });
    } catch { /* fan-out failure must not break the triggering event */ }
  }
  return userIds.length;
}

function matchesConditions(conditionsJson: string, ctx: NotifyContext): boolean {
  let conds: Record<string, unknown>;
  try { conds = JSON.parse(conditionsJson || '{}'); } catch { return true; }
  const keys = Object.keys(conds);
  if (keys.length === 0) return true;
  return keys.every((k) => {
    const want = conds[k];
    if (want === undefined || want === null || want === '') return true;
    return String(ctx[k]) === String(want);
  });
}

async function resolveTargets(
  db: D1Database,
  rolesJson: string,
  userIdsJson: string,
): Promise<number[]> {
  const set = new Set<number>();
  let roles: string[] = [];
  let ids: unknown[] = [];
  try { roles = JSON.parse(rolesJson || '[]'); } catch { /* ignore */ }
  try { ids = JSON.parse(userIdsJson || '[]'); } catch { /* ignore */ }

  if (Array.isArray(roles) && roles.length > 0) {
    // Allowlist against known roles — prevents a crafted target_roles JSON blob
    // from injecting more than 8 parameters and hitting D1's 100-param cap.
    const safeRoles = roles.filter((r) => typeof r === 'string' && KNOWN_ROLES.has(r));
    if (safeRoles.length > 0) {
      const placeholders = safeRoles.map(() => '?').join(',');
      const rows = await query<{ id: number }>(
        db,
        `SELECT id FROM users WHERE status = 'active' AND role IN (${placeholders})`,
        ...safeRoles,
      );
      rows.forEach((r) => set.add(Number(r.id)));
    }
  }
  if (Array.isArray(ids)) {
    for (const id of ids) {
      const n = Number(id);
      if (Number.isFinite(n)) set.add(n);
    }
  }
  return [...set];
}
