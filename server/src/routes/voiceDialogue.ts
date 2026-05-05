/**
 * POST /api/voice/dialogue
 *
 * Natural-language dialogue endpoint. Single entry point for all voice
 * interactions that are NOT hot-path critical actions. Plans a turn via
 * the dispatchDialogueAgent, executes any planned actions through the
 * existing executeCommand switch, and returns a single spoken reply
 * plus voice_mode for the client TTS layer.
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { logger } from '../utils/logger';
import {
  planDialogueTurn,
  tryFastMileageCapture,
  isDialogueOnlyTool,
  type DialogueContext,
  type DialoguePlan,
  type VoiceSource,
  type PendingFollowup,
  type PlannedAction,
} from '../utils/dispatchDialogueAgent';
import { executeCommand, type ParsedCommand } from './voice';

const router = Router();
router.use(authenticateToken);

// ---------------------------------------------------------------------------
// Session memory (SQLite-backed; one row per officer)
// ---------------------------------------------------------------------------

interface SessionRow {
  user_id: number;
  recent_turns_json: string;
  pending_json: string | null;
  refusal_count: number;
  updated_at: string;
}

function loadSession(userId: number): {
  recent_turns: DialogueContext['recent_turns'];
  pending_followup?: PendingFollowup;
  refusal_count: number;
} {
  const db = getDb();
  const row = db.prepare(
    'SELECT recent_turns_json, pending_json, refusal_count FROM voice_dialogue_sessions WHERE user_id = ?'
  ).get(userId) as Pick<SessionRow, 'recent_turns_json' | 'pending_json' | 'refusal_count'> | undefined;

  if (!row) return { recent_turns: [], refusal_count: 0 };

  let turns: DialogueContext['recent_turns'] = [];
  try { turns = JSON.parse(row.recent_turns_json) ?? []; } catch { /* ignore */ }

  let pending: PendingFollowup | undefined;
  if (row.pending_json) {
    try {
      const p = JSON.parse(row.pending_json) as PendingFollowup;
      if (p && p.expires_at > Date.now()) pending = p;
    } catch { /* ignore */ }
  }

  return { recent_turns: turns.slice(-10), pending_followup: pending, refusal_count: row.refusal_count ?? 0 };
}

function saveSession(
  userId: number,
  turns: DialogueContext['recent_turns'],
  pending: PendingFollowup | undefined,
  refusalCount: number,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO voice_dialogue_sessions (user_id, recent_turns_json, pending_json, refusal_count, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      recent_turns_json = excluded.recent_turns_json,
      pending_json = excluded.pending_json,
      refusal_count = excluded.refusal_count,
      updated_at = excluded.updated_at
  `).run(
    userId,
    JSON.stringify(turns.slice(-10)),
    pending ? JSON.stringify(pending) : null,
    refusalCount,
  );
}

// ---------------------------------------------------------------------------
// Context builders — pull live state at request time
// ---------------------------------------------------------------------------

function buildOfficerContext(userId: number, fullName: string): DialogueContext['officer'] {
  const db = getDb();
  const unit = db.prepare(
    `SELECT call_sign, status FROM dispatch_units WHERE officer_user_id = ? AND status != 'off_duty' LIMIT 1`
  ).get(userId) as { call_sign: string; status: string } | undefined;

  const officer: DialogueContext['officer'] = { user_id: userId, name: fullName };
  if (unit) {
    officer.call_sign = unit.call_sign;
    officer.status = unit.status;
    const gps = db.prepare(
      `SELECT latitude, longitude, address FROM gps_locations WHERE call_sign = ? ORDER BY timestamp DESC LIMIT 1`
    ).get(unit.call_sign) as { latitude: number; longitude: number; address?: string } | undefined;
    if (gps) officer.gps = { lat: gps.latitude, lng: gps.longitude, address: gps.address };
  }
  return officer;
}

function buildCurrentCall(userId: number): DialogueContext['current_call'] | undefined {
  const db = getDb();
  const row = db.prepare(`
    SELECT c.call_number, c.incident_type, c.priority, c.location_address
    FROM calls_for_service c
    JOIN dispatch_units u ON u.current_call_id = c.id
    WHERE u.officer_user_id = ? AND c.archived = 0
    LIMIT 1
  `).get(userId) as DialogueContext['current_call'] | undefined;
  return row;
}

// ---------------------------------------------------------------------------
// POST /api/voice/dialogue
// ---------------------------------------------------------------------------

router.post('/dialogue', async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const userId = req.user!.userId;
  const userName = req.user!.fullName || req.user!.username;

  const transcript: string = String(req.body?.transcript ?? '').trim();
  const sourceRaw: string = String(req.body?.source ?? 'speech');
  const source: VoiceSource = sourceRaw === 'announcer' ? 'announcer' : 'speech';

  if (!transcript) {
    return res.status(400).json({ error: 'transcript required' });
  }

  // Load session + live context
  const session = loadSession(userId);
  const ctx: DialogueContext = {
    officer: buildOfficerContext(userId, userName),
    current_call: buildCurrentCall(userId),
    recent_turns: session.recent_turns,
    pending_followup: session.pending_followup,
    refusal_count: session.refusal_count,
  };

  // Hot path 1: bare-number reply while mileage prompt pending
  let plan: DialoguePlan | null = tryFastMileageCapture(transcript, ctx);

  // Hot path 2: LLM planner
  if (!plan) {
    plan = await planDialogueTurn(transcript, ctx, source);
  }

  if (!plan) {
    // LLM unavailable — degrade gracefully with the hallucination-guard phrase
    const fallbackReply = 'Stand by while I check the system.';
    saveSession(
      userId,
      [...ctx.recent_turns, { role: 'officer', text: transcript }, { role: 'dispatch', text: fallbackReply }],
      ctx.pending_followup,
      ctx.refusal_count ?? 0,
    );
    return res.status(503).json({
      reply: fallbackReply,
      voice_mode: source === 'announcer' ? 'spillman_flat' : 'conversational',
      actions: [],
      degraded: true,
    });
  }

  // ── Confirm-action gate ──
  // Risky actions (start_pursuit, dispatching to a Code-3 call) execute only
  // on the *next* turn after the officer affirms. We detect this two ways:
  //   (a) plan declares pending_followup.kind='confirm_action' AND includes
  //       the risky action — we strip the action, store its plan in the
  //       follow-up meta, and ask for confirmation.
  //   (b) prior session pending_followup.kind='confirm_action' AND officer
  //       said yes/affirmative — we replay the stored action.
  const RISKY_ACTIONS = new Set(['start_pursuit']);
  const AFFIRMATIVE = /^\s*(yes|yeah|yep|affirm(ative)?|confirmed?|10-?4|copy|go|do it|send it|execute)\b/i;
  const NEGATIVE = /^\s*(no|negative|cancel|stand ?down|abort|belay|stop)\b/i;

  // Case (b): replay confirmed action
  const priorConfirm = ctx.pending_followup;
  if (priorConfirm?.kind === 'confirm_action' && priorConfirm.expires_at > Date.now()) {
    if (AFFIRMATIVE.test(transcript) && priorConfirm.meta?.deferred_action) {
      plan.actions.unshift(priorConfirm.meta.deferred_action as PlannedAction);
      plan.pending_followup = undefined; // clear the gate
    } else if (NEGATIVE.test(transcript)) {
      plan.pending_followup = undefined;
      plan.reply = plan.reply || 'Standing down.';
    }
    // else fall through — officer said something else; the gate stays open
  }

  // Case (a): strip risky actions until confirmed
  if (plan.pending_followup?.kind === 'confirm_action') {
    const risky = plan.actions.find(a => RISKY_ACTIONS.has(a.tool));
    if (risky) {
      plan.pending_followup.meta = { ...(plan.pending_followup.meta ?? {}), deferred_action: risky };
      plan.actions = plan.actions.filter(a => !RISKY_ACTIONS.has(a.tool));
    }
  }

  // Defensive: if the LLM forgot the confirm gate, add it for risky actions
  for (let i = plan.actions.length - 1; i >= 0; i--) {
    const a = plan.actions[i];
    if (RISKY_ACTIONS.has(a.tool) && !plan.pending_followup) {
      plan.pending_followup = {
        kind: 'confirm_action',
        prompt: `Confirm ${a.tool.replace(/_/g, ' ')}?`,
        expires_at: Date.now() + 30_000,
        meta: { deferred_action: a },
      };
      plan.actions.splice(i, 1);
      plan.reply = (plan.reply ? plan.reply + ' ' : '') + `Confirm ${a.tool.replace(/_/g, ' ')}?`;
    }
  }

  // Execute planned actions
  const executed: Array<{ tool: string; success: boolean; result?: string }> = [];
  for (const action of plan.actions) {
    if (isDialogueOnlyTool(action.tool)) {
      executed.push({ tool: action.tool, success: true });
      // Post-process dialogue-only tools
      if (action.tool === 'mileage_capture') {
        const kind = action.params?.kind === 'ending' ? 'ending' : 'starting';
        const value = Number(action.params?.value);
        if (Number.isFinite(value)) {
          recordMileage(userId, kind, value);
          auditLog(req, 'voice_mileage_logged' as any, 'unit', userId, `${kind} mileage ${value}`);
        }
      }
      continue;
    }

    // Delegate to existing executeCommand switch
    try {
      const cmd: ParsedCommand = { action: action.tool, params: action.params, raw: transcript };
      const out = await executeCommand(cmd, req);
      executed.push({ tool: action.tool, success: out.success, result: out.response });
    } catch (err: any) {
      logger.warn({ err, tool: action.tool }, 'dialogue: tool execution failed');
      executed.push({ tool: action.tool, success: false, result: err?.message });
    }
  }

  // If any action returned data (e.g. run_plate, sitrep), prefer that as the
  // spoken response — it's the freshly-fetched ground truth, not the LLM's
  // pre-tool guess. The LLM's `reply` becomes a lead-in sentence only.
  const dataReply = executed
    .filter(e => e.success && e.result && !isDialogueOnlyTool(e.tool))
    .map(e => e.result!)
    .join(' ');

  const finalReply = dataReply
    ? (plan.reply && /stand by/i.test(plan.reply) ? dataReply : `${plan.reply.replace(/[.!?]\s*$/, '')}. ${dataReply}`).trim()
    : plan.reply;

  // Update session: append turn, update pending follow-up, adjust refusal counter
  const newTurns: DialogueContext['recent_turns'] = [
    ...ctx.recent_turns,
    { role: 'officer', text: transcript },
    { role: 'dispatch', text: finalReply },
  ];

  // Clear mileage follow-up if just captured
  let newPending = plan.pending_followup;
  if (!newPending && ctx.pending_followup) {
    const justCaptured = executed.some(e => e.tool === 'mileage_capture' && e.success);
    if (!justCaptured && ctx.pending_followup.expires_at > Date.now()) {
      newPending = ctx.pending_followup; // preserve unresolved
    }
  }

  let newRefusal = ctx.refusal_count ?? 0;
  if (plan.off_topic) newRefusal += 1;
  else if (!plan.off_topic && newRefusal > 0) newRefusal = 0; // back on-topic, reset

  saveSession(userId, newTurns, newPending, newRefusal);

  res.json({
    reply: finalReply,
    voice_mode: plan.voice_mode,
    source,
    actions: executed,
    pending_followup: newPending ? { kind: newPending.kind, prompt: newPending.prompt } : null,
    off_topic: plan.off_topic ?? false,
    latency_ms: Date.now() - startedAt,
  });
});

// ---------------------------------------------------------------------------
// Mileage persistence — store on dispatch_units.last_*_mileage columns
// ---------------------------------------------------------------------------

function recordMileage(userId: number, kind: 'starting' | 'ending', value: number): void {
  const db = getDb();
  const col = kind === 'starting' ? 'last_starting_mileage' : 'last_ending_mileage';
  try {
    db.prepare(`UPDATE dispatch_units SET ${col} = ?, ${col}_at = datetime('now') WHERE officer_user_id = ?`).run(value, userId);
  } catch (err) {
    logger.warn({ err, kind, value }, 'dialogue: mileage column missing — ensure migration ran');
  }
}

// ---------------------------------------------------------------------------
// GET /api/voice/dialogue/session — debug / status
// ---------------------------------------------------------------------------

router.get('/dialogue/session', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const s = loadSession(userId);
  res.json({
    recent_turns: s.recent_turns,
    pending_followup: s.pending_followup
      ? { kind: s.pending_followup.kind, prompt: s.pending_followup.prompt }
      : null,
    refusal_count: s.refusal_count,
  });
});

// POST /api/voice/dialogue/reset — clear session (for testing or shift change)
router.post('/dialogue/reset', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const db = getDb();
  db.prepare('DELETE FROM voice_dialogue_sessions WHERE user_id = ?').run(userId);
  res.json({ success: true });
});

export default router;
