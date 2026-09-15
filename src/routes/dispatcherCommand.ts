// ============================================================
// RMPG Flex — Dispatcher Command Engine route  (/api/dispatcher)
// ============================================================
// POST /command            — free-form text (typed or spoken) → plan
// POST /command/:id/result — client reports step outcomes
// GET  /command/recent     — last commands (supervisor+)
//
// Flow: rules.ts (deterministic) → planner.ts (callAi) → catalog validate
//  → resolve.ts (call#/unit → ids) → compile.ts (HTTP steps + console
//  actions) → optional confirmation token (KV) → response. Server-side
//  reads (record checks, call status, unit lists) run here and are folded
//  into `reply`. Writes are executed by the client with its own JWT so the
//  existing routes' RBAC, validation, audit_log and WS broadcasts all fire.
// Design: docs/superpowers/specs/2026-09-14-dispatcher-command-engine-design.md

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { log } from '../utils/logger';
import { toDisplayLabel } from '../utils/displayLabel';
import { ACTIVE_CALL_WHERE } from '../utils/callStatus';
import { runLookup, type LookupType } from '../utils/dispatcherAwareness';
import { matchRules } from '../utils/dispatcherCommand/rules';
import { planWithAi, type AwarenessSnapshot } from '../utils/dispatcherCommand/planner';
import { validateToolCall, describeCatalog, type ValidatedToolCall } from '../utils/dispatcherCommand/catalog';
import { compileToolCall, collectRefs, CompileError } from '../utils/dispatcherCommand/compile';
import { resolveRefs, describeIssue, loadCandidateUnits, pickUnit, loadCandidateCalls, pickCall } from '../utils/dispatcherCommand/resolve';
import type { CommandContext, CommandResponse, PlanStep, PlannerOutput, StepResult } from '../utils/dispatcherCommand/types';

const dispatcher = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const CONFIRM_TTL_SECONDS = 90;
const READ_ONLY_ROLES = new Set(['client_viewer']);

// ─── Schema reconcile (deploy applies 0289 with continue-on-error) ────────
let ensured = false;
async function ensureLogTable(db: D1Database): Promise<void> {
  if (ensured) return;
  try {
    await execute(db, `CREATE TABLE IF NOT EXISTS dispatcher_command_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, source TEXT NOT NULL DEFAULT 'typed',
      input_text TEXT NOT NULL, intent TEXT, planner TEXT, provider TEXT, model TEXT, plan_json TEXT,
      status TEXT NOT NULL DEFAULT 'planned', results_json TEXT, latency_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT)`);
    ensured = true;
  } catch (err) {
    log.warn('dispatcher_command_log ensure failed', { err: err instanceof Error ? err.message : String(err) });
  }
}

async function confirmDestructiveEnabled(db: D1Database): Promise<boolean> {
  const row = await queryFirst<{ config_value: string }>(
    db, `SELECT config_value FROM system_config WHERE config_key = 'dispatcher_command_confirm_destructive' ORDER BY id DESC LIMIT 1`,
  ).catch(() => null);
  return (row?.config_value ?? '1').trim() !== '0';
}

async function loadAwareness(db: D1Database): Promise<AwarenessSnapshot> {
  const [active, units] = await Promise.all([
    query<AwarenessSnapshot['activeCalls'][number]>(
      db,
      `SELECT call_number, incident_type, priority, status, location_address, unit_call_signs
       FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE}
       ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, created_at DESC LIMIT 40`,
    ).catch(() => []),
    query<{ call_sign: string; status: string }>(
      db, `SELECT call_sign, status FROM units WHERE status != 'off_duty' AND call_sign IS NOT NULL ORDER BY call_sign LIMIT 60`,
    ).catch(() => []),
  ]);
  return {
    activeCalls: active,
    pendingCalls: active.filter(c => c.status === 'pending'),
    units,
  };
}

// ─── Server-side reads ────────────────────────────────────────────────────
async function runServerRead(env: Bindings, db: D1Database, call: ValidatedToolCall, ctx: CommandContext): Promise<string> {
  const p = call.params as Record<string, any>;
  const lookup = async (type: LookupType, q: string, speaker?: string | null) => {
    const r = await runLookup(env, db, { type, query: q }, { speaker: speaker ?? ctx.unitCallSign ?? undefined }).catch(() => null);
    return r?.text ?? `${toDisplayLabel(type)} lookup unavailable.`;
  };
  switch (call.tool) {
    case 'lookup_record': return lookup(p.kind as LookupType, String(p.query));
    case 'closest_unit': return lookup('closest_unit', String(p.address));
    case 'call_status': {
      const calls = await loadCandidateCalls(db);
      const { hit, candidates } = pickCall(String(p.call), calls, ctx.selectedCallNumber);
      if (!hit) return candidates.length ? `Which call: ${candidates.map(c => c.call_number).join(', ')}?` : `No call matches "${p.call}".`;
      return lookup('call_status', hit.call_number);
    }
    case 'unit_location': {
      const units = await loadCandidateUnits(db);
      const { hit, candidates } = pickUnit(String(p.unit), units);
      if (!hit) return candidates.length ? `Which unit: ${candidates.map(u => u.call_sign).join(', ')}?` : `No unit matches "${p.unit}".`;
      return lookup('unit_location', '', hit.call_sign);
    }
    case 'list_pending': {
      const rows = await query<{ call_number: string; priority: string | null; incident_type: string | null; location_address: string | null }>(
        db, `SELECT call_number, priority, incident_type, location_address FROM calls_for_service WHERE status = 'pending'
             ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, created_at LIMIT 15`,
      ).catch(() => []);
      if (!rows.length) return 'No pending calls.';
      return `${rows.length} pending: ` + rows.map(r => `${r.call_number} ${r.priority ?? ''} ${toDisplayLabel(r.incident_type ?? 'call')} at ${r.location_address ?? 'unknown'}`).join('; ') + '.';
    }
    case 'list_units': {
      const units = await loadCandidateUnits(db);
      if (p.unit) {
        const { hit, candidates } = pickUnit(String(p.unit), units);
        if (!hit) return candidates.length ? `Which unit: ${candidates.map(u => u.call_sign).join(', ')}?` : `No unit matches "${p.unit}".`;
        return `${hit.call_sign} is ${toDisplayLabel(hit.status ?? 'unknown')}.`;
      }
      const active = units.filter(u => u.status !== 'off_duty');
      if (!active.length) return 'No units on duty.';
      return `${active.length} on duty: ` + active.map(u => `${u.call_sign} ${toDisplayLabel(u.status ?? '')}`).join(', ') + '.';
    }
    default: return '';
  }
}

// ─── Plan assembly ────────────────────────────────────────────────────────
interface Assembled {
  steps: PlanStep[];
  readTexts: string[];
  clarify?: string;
  errors: string[];
  destructive: boolean;
}

async function assemble(env: Bindings, db: D1Database, planned: PlannerOutput, ctx: CommandContext): Promise<Assembled> {
  const validated: ValidatedToolCall[] = [];
  const errors: string[] = [];
  for (const raw of planned.tool_calls) {
    const v = validateToolCall(raw, ctx.role);
    if (v.ok) validated.push(v.call);
    else errors.push(v.error.error);
  }
  const { callRefs, unitRefs } = collectRefs(validated.filter(v => !v.def.serverRead));
  const { refs, issues } = await resolveRefs(db, callRefs, unitRefs, ctx);
  if (issues.length) {
    return { steps: [], readTexts: [], clarify: issues.map(describeIssue).join(' '), errors, destructive: false };
  }
  const steps: PlanStep[] = [];
  const readTexts: string[] = [];
  const author = ctx.userName || 'Dispatch';
  for (const v of validated) {
    if (v.def.serverRead) {
      readTexts.push(await runServerRead(env, db, v, ctx));
      continue;
    }
    try {
      steps.push(...compileToolCall(v, refs, author));
    } catch (err) {
      if (err instanceof CompileError) errors.push(err.message);
      else throw err;
    }
  }
  // Collapse duplicate refreshes to one at the end.
  const httpAndActions = steps.filter(s => !(s.kind === 'client' && s.action === 'refresh'));
  if (steps.some(s => s.kind === 'client' && s.action === 'refresh')) {
    httpAndActions.push({ kind: 'client', action: 'refresh', payload: {}, summary: 'Refresh board' });
  }
  return {
    steps: httpAndActions,
    readTexts,
    errors,
    destructive: httpAndActions.some(s => s.kind === 'http' && s.destructive),
  };
}

function composeReply(planned: PlannerOutput, a: Assembled): string {
  const parts: string[] = [];
  if (planned.reply?.trim()) parts.push(planned.reply.trim());
  else if (a.steps.length) {
    const writes = a.steps.filter(s => s.kind === 'http').map(s => s.summary);
    const actions = a.steps.filter(s => s.kind === 'client' && s.action !== 'refresh').map(s => s.summary);
    if (writes.length) parts.push(writes.join('; ') + '.');
    else if (actions.length) parts.push(actions.join('; ') + '.');
  }
  parts.push(...a.readTexts.filter(Boolean));
  if (a.errors.length) parts.push(`Could not: ${a.errors.join('; ')}.`);
  return parts.join(' ').trim();
}

async function writeLog(db: D1Database, row: {
  userId: number; source: string; input: string; intent: string; planner: string; provider?: string; model?: string;
  plan: unknown; status: string; latency: number;
}): Promise<number | null> {
  await ensureLogTable(db);
  try {
    const r = await db.prepare(
      `INSERT INTO dispatcher_command_log (user_id, source, input_text, intent, planner, provider, model, plan_json, status, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(row.userId, row.source, row.input.slice(0, 2000), row.intent, row.planner, row.provider ?? null, row.model ?? null,
      JSON.stringify(row.plan).slice(0, 20000), row.status, row.latency).run();
    return (r.meta?.last_row_id as number | undefined) ?? null;
  } catch (err) {
    log.warn('dispatcher_command_log insert failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function confirmKey(token: string): string { return `dispatcher_cmd_confirm:${token}`; }

// ─── POST /command ────────────────────────────────────────────────────────
dispatcher.post('/command', async (c) => {
  const start = Date.now();
  const db = getDb(c.env);
  const user = c.get('user');
  if (!user || READ_ONLY_ROLES.has(user.role)) return c.json({ error: 'Insufficient permissions' }, 403);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const source: 'typed' | 'speech' = body.source === 'speech' ? 'speech' : 'typed';
  const context = (body.context ?? {}) as Record<string, unknown>;
  const ctx: CommandContext = {
    userId: user.id,
    role: user.role,
    userName: user.full_name || user.username,
    selectedCallNumber: typeof context.selected_call_number === 'string' ? context.selected_call_number : null,
    unitCallSign: typeof context.unit === 'string' ? context.unit : null,
    source,
  };

  // ── Confirmation round-trip ──
  if (typeof body.confirm_token === 'string' && body.confirm_token) {
    const raw = await c.env.KV.get(confirmKey(body.confirm_token)).catch(() => null);
    if (!raw) {
      return c.json<CommandResponse>({
        ok: false, log_id: null, intent: 'confirm_expired', reply: 'That confirmation expired — say the command again.',
        steps: [], needs_confirmation: false, planner: 'none', latency_ms: Date.now() - start,
      });
    }
    const cached = JSON.parse(raw) as { userId: number; logId: number | null; response: CommandResponse };
    await c.env.KV.delete(confirmKey(body.confirm_token)).catch(() => {});
    if (cached.userId !== user.id) return c.json({ error: 'Confirmation token belongs to another user' }, 403);
    const confirmed = body.confirmed !== false;
    if (cached.logId != null) {
      await execute(db, `UPDATE dispatcher_command_log SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        confirmed ? 'confirmed' : 'cancelled', cached.logId).catch(() => {});
    }
    if (!confirmed) {
      return c.json<CommandResponse>({ ...cached.response, ok: true, reply: 'Cancelled.', steps: [], needs_confirmation: false, confirmed: false, latency_ms: Date.now() - start });
    }
    return c.json<CommandResponse>({ ...cached.response, ok: true, needs_confirmation: false, confirmed: true, latency_ms: Date.now() - start });
  }

  if (!text) {
    return c.json<CommandResponse>({ ok: false, log_id: null, intent: 'empty', reply: '', steps: [], needs_confirmation: false, planner: 'none', latency_ms: 0 });
  }

  // ── 1. Deterministic rules ──
  let planned = matchRules(text);
  let plannerKind: 'rules' | 'ai' | 'none' = planned ? 'rules' : 'none';
  let provider: string | undefined;
  let model: string | undefined;
  let aiError: string | undefined;

  // ── 2. LLM planner ──
  if (!planned) {
    const awareness = await loadAwareness(db);
    const res = await planWithAi(c.env, text, ctx, awareness);
    provider = res.provider; model = res.model; aiError = res.error;
    if (res.output) { planned = res.output; plannerKind = 'ai'; }
  }

  if (!planned) {
    const reply = aiError
      ? 'Command interpreter is offline — use a CAD verb (type HELP), or try simpler wording like "assign 12 to 42".'
      : 'Say again? I could not work out what to do with that.';
    const logId = await writeLog(db, { userId: user.id, source, input: text, intent: 'unclear', planner: 'none', plan: [], status: 'clarify', latency: Date.now() - start });
    if (aiError) log.warn('dispatcher command planner unavailable', { error: aiError });
    return c.json<CommandResponse>({ ok: false, log_id: logId, intent: 'unclear', reply, steps: [], needs_confirmation: false, clarify: reply, planner: 'none', latency_ms: Date.now() - start });
  }

  // Chatter / not-a-command → let the caller fall through to the dialogue persona.
  if (planned.tool_calls.length === 0 && !planned.clarify && (planned.intent === 'chatter' || !planned.reply)) {
    const logId = await writeLog(db, { userId: user.id, source, input: text, intent: planned.intent || 'chatter', planner: plannerKind, provider, model, plan: [], status: 'chatter', latency: Date.now() - start });
    return c.json<CommandResponse>({ ok: false, log_id: logId, intent: planned.intent || 'chatter', reply: planned.reply || '', steps: [], needs_confirmation: false, planner: plannerKind, provider, model, latency_ms: Date.now() - start });
  }

  // Help is answered inline with the role-scoped catalog.
  if (planned.tool_calls.some(t => t.tool === 'help')) {
    const reply = `I can:\n${describeCatalog(user.role)}\n\nSpeak or type naturally, e.g. "assign 12 to 42", "clear 42 unfounded", "new call alarm at 123 Main St", "note on 42: subject left", "run plate ABC123".`;
    const logId = await writeLog(db, { userId: user.id, source, input: text, intent: 'help', planner: plannerKind, plan: [], status: 'executed', latency: Date.now() - start });
    return c.json<CommandResponse>({ ok: true, log_id: logId, intent: 'help', reply, steps: [{ kind: 'client', action: 'show_help', payload: {}, summary: 'Help' }], needs_confirmation: false, planner: plannerKind, latency_ms: Date.now() - start });
  }

  if (planned.clarify && planned.tool_calls.length === 0) {
    const logId = await writeLog(db, { userId: user.id, source, input: text, intent: planned.intent, planner: plannerKind, provider, model, plan: [], status: 'clarify', latency: Date.now() - start });
    return c.json<CommandResponse>({ ok: false, log_id: logId, intent: planned.intent, reply: planned.clarify, steps: [], needs_confirmation: false, clarify: planned.clarify, planner: plannerKind, provider, model, latency_ms: Date.now() - start });
  }

  // ── 3. Validate → resolve → compile → server reads ──
  const assembled = await assemble(c.env, db, planned, ctx);
  if (assembled.clarify) {
    const logId = await writeLog(db, { userId: user.id, source, input: text, intent: planned.intent, planner: plannerKind, provider, model, plan: planned.tool_calls, status: 'clarify', latency: Date.now() - start });
    return c.json<CommandResponse>({ ok: false, log_id: logId, intent: planned.intent, reply: assembled.clarify, steps: [], needs_confirmation: false, clarify: assembled.clarify, planner: plannerKind, provider, model, latency_ms: Date.now() - start });
  }

  const reply = composeReply(planned, assembled);
  const hasWork = assembled.steps.length > 0 || assembled.readTexts.length > 0;
  const needsConfirm = assembled.destructive && await confirmDestructiveEnabled(db);
  const status = !hasWork ? 'failed' : needsConfirm ? 'awaiting_confirmation' : assembled.steps.some(s => s.kind === 'http') ? 'planned' : 'executed';
  const logId = await writeLog(db, {
    userId: user.id, source, input: text, intent: planned.intent, planner: plannerKind, provider, model,
    plan: assembled.steps, status, latency: Date.now() - start,
  });

  const response: CommandResponse = {
    ok: hasWork,
    log_id: logId,
    intent: planned.intent,
    reply: reply || (hasWork ? 'Copy.' : 'Nothing to do.'),
    steps: assembled.steps,
    needs_confirmation: needsConfirm,
    planner: plannerKind,
    provider,
    model,
    latency_ms: Date.now() - start,
  };

  if (needsConfirm) {
    const token = crypto.randomUUID();
    await c.env.KV.put(confirmKey(token), JSON.stringify({ userId: user.id, logId, response }), { expirationTtl: CONFIRM_TTL_SECONDS }).catch((err) => {
      log.warn('confirm token KV put failed', { err: err instanceof Error ? err.message : String(err) });
    });
    const what = assembled.steps.filter(s => s.kind === 'http' && s.destructive).map(s => s.summary).join('; ');
    return c.json<CommandResponse>({ ...response, confirm_token: token, reply: `Confirm: ${what}? (Y/N)` });
  }
  return c.json(response);
});

// ─── POST /command/:id/result ─────────────────────────────────────────────
dispatcher.post('/command/:id/result', async (c) => {
  const db = getDb(c.env);
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
  const body = await c.req.json<{ steps?: StepResult[] }>().catch(() => ({} as { steps?: StepResult[] }));
  const steps = Array.isArray(body.steps) ? body.steps.slice(0, 50) : [];
  const allOk = steps.length > 0 && steps.every(s => s.ok);
  const anyOk = steps.some(s => s.ok);
  const status = steps.length === 0 ? 'executed' : allOk ? 'executed' : anyOk ? 'partial' : 'failed';
  await ensureLogTable(db);
  const r = await execute(db,
    `UPDATE dispatcher_command_log SET status = ?, results_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    status, JSON.stringify(steps).slice(0, 20000), id, user.id,
  ).catch(() => null);
  return c.json({ ok: true, status, updated: r?.meta?.changes ?? 0 });
});

// ─── GET /command/recent ─────────────────────────────────────────────────
dispatcher.get('/command/recent', async (c) => {
  const user = c.get('user');
  if (!['supervisor', 'manager', 'admin'].includes(user.role)) return c.json({ error: 'Insufficient permissions' }, 403);
  const db = getDb(c.env);
  await ensureLogTable(db);
  const rows = await query(db,
    `SELECT l.id, l.user_id, u.full_name AS user_name, l.source, l.input_text, l.intent, l.planner, l.provider, l.model, l.status, l.latency_ms, l.created_at
     FROM dispatcher_command_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 100`,
  ).catch(() => []);
  return c.json(rows);
});

export default dispatcher;
