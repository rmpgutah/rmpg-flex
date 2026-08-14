import { log } from './logger';
import { emitAlert } from './alertHub';
import { recordAuditCore } from './auditLog';
import { haversineM } from './tripTelemetry';
import type { IncomingFix } from './tripTelemetry';
import type { Env } from '../types';

export interface AutomationRule {
  id: number;
  name: string;
  description: string | null;
  scope: 'global' | 'unit' | 'user';
  scope_id: number | null;
  enabled: number;
  trigger_type: string;
  trigger_config: string; // JSON
  action_type: string;
  action_config: string; // JSON
  dedup_window_ms: number;
  evaluate_client: number;
  evaluate_server: number;
}

interface TriggerConfig {
  speed_ms?: number;
  direction?: 'above' | 'below';
  threshold_ms?: number;
  radius_m?: number;
  geofence_id?: number;
  beat_id?: string;
  threshold_m?: number;
}

interface ActionConfig {
  message?: string;
  severity?: 'info' | 'warn' | 'critical';
  status?: string;
  timer_ms?: number;
  category?: string;
  note?: string;
}

function parseCfg<T>(raw: string): T {
  try { return JSON.parse(raw) as T; } catch { return {} as T; }
}

function matchesTrigger(
  rule: AutomationRule,
  fix: IncomingFix,
  prevFix: IncomingFix | null,
  lastMovedTs: number,
): boolean {
  const cfg = parseCfg<TriggerConfig>(rule.trigger_config);
  switch (rule.trigger_type) {
    case 'speed_threshold': {
      if (fix.speed === null || cfg.speed_ms === undefined) return false;
      return cfg.direction === 'above'
        ? fix.speed > cfg.speed_ms
        : fix.speed < cfg.speed_ms;
    }
    case 'no_movement': {
      if (!cfg.threshold_ms) return false;
      return (fix.ts - lastMovedTs) > cfg.threshold_ms;
    }
    case 'low_accuracy': {
      // IncomingFix has no accuracy field — skip client-originated fixes without it
      return false;
    }
    default:
      return false;
  }
}

async function isDuped(
  db: D1Database,
  ruleId: number,
  userId: number,
  dedupMs: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - dedupMs).toISOString();
  const row = await db.prepare(
    `SELECT id FROM automation_rule_firings
     WHERE rule_id = ? AND user_id = ? AND fired_at > ?
     ORDER BY fired_at DESC LIMIT 1`,
  ).bind(ruleId, userId, cutoff).first<{ id: number }>();
  return row !== null;
}

async function insertFiring(
  db: D1Database,
  ruleId: number,
  userId: number,
  unitId: number | null,
  fix: IncomingFix,
  context: Record<string, unknown>,
): Promise<void> {
  await db.prepare(
    `INSERT INTO automation_rule_firings
     (rule_id, user_id, unit_id, trigger_lat, trigger_lng, context, source)
     VALUES (?, ?, ?, ?, ?, ?, 'server')`,
  ).bind(ruleId, userId, unitId ?? null, fix.lat, fix.lng, JSON.stringify(context)).run();
}

async function fireAction(
  db: D1Database,
  env: Env['Bindings'],
  ctx: { waitUntil(p: Promise<unknown>): void },
  rule: AutomationRule,
  fix: IncomingFix,
  userId: number,
  unitId: number | null,
): Promise<void> {
  const cfg = parseCfg<ActionConfig>(rule.action_config);

  switch (rule.action_type) {
    case 'notify_dispatch':
    case 'notify_supervisor':
    case 'notify_officer': {
      ctx.waitUntil(
        emitAlert(env, 'automation_alert', {
          rule_id: rule.id,
          rule_name: rule.name,
          action_type: rule.action_type,
          message: cfg.message ?? rule.name,
          severity: cfg.severity ?? 'info',
          user_id: userId,
          unit_id: unitId,
          lat: fix.lat,
          lng: fix.lng,
        }).catch((err) => log.error('[automation] emitAlert failed', { rule_id: rule.id }, err)),
      );
      break;
    }

    case 'change_unit_status': {
      if (!unitId || !cfg.status) break;
      ctx.waitUntil(
        db.prepare(`UPDATE units SET status = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(cfg.status, unitId)
          .run()
          .catch((err) => log.error('[automation] status update failed', { unitId, status: cfg.status }, err)),
      );
      break;
    }

    case 'trigger_welfare_check': {
      if (!env.WELFARE_WATCH) break;
      const doId = env.WELFARE_WATCH.idFromName(`u-${userId}`);
      const stub = env.WELFARE_WATCH.get(doId);
      ctx.waitUntil(
        stub.fetch('https://do/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, timer_ms: cfg.timer_ms ?? 900000 }),
        }).catch((err) => log.error('[automation] welfare DO failed', { userId }, err)),
      );
      break;
    }

    case 'log_audit_event': {
      ctx.waitUntil(
        recordAuditCore(env, {
          action: cfg.category ?? 'automation_trigger',
          entityType: 'automation_rule',
          entityId: rule.id,
          details: { rule_name: rule.name, note: cfg.note, lat: fix.lat, lng: fix.lng },
          actorId: userId,
        }, ctx).catch((err) => log.error('[automation] audit failed', { rule_id: rule.id }, err)),
      );
      break;
    }

    default:
      log.warn('[automation] unknown action_type', { action_type: rule.action_type, rule_id: rule.id });
  }
}

/**
 * Evaluate server-side automation rules against a batch of incoming GPS fixes.
 * Called from src/routes/dispatch/gps.ts after existing geofence/trip processing.
 * Rules are pre-fetched by the caller to avoid per-fix DB queries.
 */
export async function evaluateServerRules(
  db: D1Database,
  env: Env['Bindings'],
  ctx: { waitUntil(p: Promise<unknown>): void },
  userId: number,
  unitId: number | null,
  fixes: IncomingFix[],
  rules: AutomationRule[],
): Promise<void> {
  if (rules.length === 0 || fixes.length === 0) return;

  const enabledRules = rules.filter((r) => r.enabled === 1 && r.evaluate_server === 1);
  if (enabledRules.length === 0) return;

  // Track movement for no_movement trigger
  let lastMovedTs = fixes[0]?.ts ?? Date.now();
  let prevFix: IncomingFix | null = null;

  for (const fix of fixes) {
    if (prevFix) {
      const dist = haversineM(prevFix.lat, prevFix.lng, fix.lat, fix.lng);
      if (dist > 10) lastMovedTs = fix.ts;
    }

    for (const rule of enabledRules) {
      if (!matchesTrigger(rule, fix, prevFix, lastMovedTs)) continue;
      try {
        const duped = await isDuped(db, rule.id, userId, rule.dedup_window_ms);
        if (duped) continue;
        await insertFiring(db, rule.id, userId, unitId, fix, {
          trigger_type: rule.trigger_type,
          speed: fix.speed,
        });
        await fireAction(db, env, ctx, rule, fix, userId, unitId);
      } catch (err) {
        log.error('[automation] rule evaluation error', { rule_id: rule.id, userId }, err);
      }
    }

    prevFix = fix;
  }
}

/** Fetch applicable rules for a user from D1. One call per GPS POST. */
export async function loadRulesForUser(
  db: D1Database,
  userId: number,
  unitId: number | null,
): Promise<AutomationRule[]> {
  const rows = await db.prepare(
    `SELECT * FROM automation_rules
     WHERE enabled = 1 AND evaluate_server = 1
       AND (scope = 'global'
         OR (scope = 'user' AND scope_id = ?)
         OR (scope = 'unit' AND scope_id = ?))`,
  ).bind(userId, unitId ?? -1).all<AutomationRule>();
  return rows.results ?? [];
}
