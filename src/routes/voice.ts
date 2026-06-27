// ============================================================
// RMPG Flex — Voice Dialogue + Read-Aloud endpoints
// ============================================================
// POST /api/voice/dialogue   — free-form NL dispatcher: writes CAD
//                               data, runs record checks, returns
//                               spoken reply + action results.
// POST /api/voice/read-aloud — announce dispatch details: takes a
//                               call/detail snapshot and returns
//                               spoken text for TTS readout.
// ============================================================

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import {
  decideDispatcherReply,
  phraseLookupReply,
  isAddressedToDispatch,
  fallbackAcknowledgement,
  type DispatcherTurn,
  type DispatcherOptions,
} from '../utils/aiDispatcher';
import {
  gatherAwareness,
  runLookup,
  runAction,
  type RecordRef,
  type LookupRequest,
  type ActionRequest,
} from '../utils/dispatcherAwareness';
import { getRadioSettings, type RadioSettings } from '../utils/radioSettings';

const voice = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ─── POST /api/voice/dialogue ──────────────────────────────────
// Primary natural-language voice endpoint. Turns a transcript into
// a dispatcher reply, optionally running CAD lookups and writes.
// Used by the client voiceChannel.ts text path.
//
// source='speech'     → conversational human voice + P25 chirp
// source='announcer'  → Spillman flat voice + classic chime
voice.post('/dialogue', async (c) => {
  try {
  const start = Date.now();
  const db = getDb(c.env);
  const userId = c.get('userId') as number;

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.transcript !== 'string' || !body.transcript.trim()) {
    return c.json({ reply: '', actions: [], off_topic: false, latency_ms: 0 });
  }

  const transcript = body.transcript.trim();
  const source: 'speech' | 'announcer' = body.source === 'announcer' ? 'announcer' : 'speech';
  const unitCallSign = typeof body.unit === 'string' ? body.unit.trim() : null;
  const channelName = typeof body.channel === 'string' ? body.channel.trim() : null;

  // Resolve the user's unit call-sign if not explicitly provided.
  let speaker = unitCallSign;
  if (!speaker) {
    const unit = await queryFirst<{ call_sign: string }>(
      db, 'SELECT call_sign FROM units WHERE officer_id = ? LIMIT 1', userId,
    ).catch(() => null);
    speaker = unit?.call_sign ?? null;
  }

  // Read live org-wide AI dispatcher settings (persona, temperature, etc.).
  const settings = await getRadioSettings(db).catch(() => null);
  const opts: DispatcherOptions = {
    persona: settings?.ai_persona,
    temperature: settings?.ai_temperature,
    maxReplyChars: settings?.ai_max_reply_chars,
  };

  // Build awareness snapshot — active calls, units, BOLOs, panics.
  const awareness = await gatherAwareness(
    db,
    /* channelId */ 0, // not a real radio channel — pass 0 to skip channel-specific logic
    speaker,
  ).catch(() => 'No active CAD activity on the board.');

  const turn: DispatcherTurn = {
    transcript,
    speaker,
    channelName,
    recent: [],
    awareness,
  };

  // 1. Decide what dispatch says back.
  const decision = await decideDispatcherReply(c.env.AI, turn, opts);
  const addressed = isAddressedToDispatch(transcript);

  let replyText = decision?.reply ?? '';
  const actions: Array<{ type: string; result: string }> = [];
  let recordRef: RecordRef | null = null;
  let offTopic = false;

  // 2. Execute any lookup the model requested.
  if (decision?.lookup) {
    const result = await runLookup(
      c.env as Bindings, db, decision.lookup,
      { speaker: speaker ?? undefined },
    ).catch(() => null);
    if (result) {
      if (decision.lookup.type === 'unit_location' || decision.lookup.type === 'eta') {
        replyText = result.text;
      } else {
        replyText = await phraseLookupReply(c.env.AI, turn, decision.lookup, result.text, opts);
      }
      if (result.record) recordRef = result.record;
      actions.push({ type: `lookup:${decision.lookup.type}`, result: result.text });
    }
  }

  // 3. Execute any CAD write the model requested.
  if (decision?.action) {
    const written = await runAction(
      c.env as Bindings, db, decision.action,
      // The requesting officer is the BOLO issuer (bolos.issued_by is NOT NULL);
      // without this every radio-requested create_bolo was refused, then
      // mis-reported as "unable to start that call" by the gap below.
      { issuedBy: userId },
    ).catch(() => null);
    if (written) {
      replyText = written.spoken;
      actions.push({ type: `action:${decision.action.type}`, result: written.summary });
    } else {
      // Write refused or failed — give an honest correction (mirrors VoiceHubDO).
      replyText = decision.action.type === 'set_unit_status'
        ? `${speaker || 'Unit calling'}, dispatch did not catch your call-sign — say again your unit and status.`
        : decision.action.type === 'create_bolo'
          ? `${speaker || 'Unit calling'}, unable to put that BOLO out — say again the details.`
          : `${speaker || 'Unit calling'}, unable to start that call — say again the location and the nature.`;
      actions.push({ type: `action_refused:${decision.action.type}`, result: 'refused' });
    }
  }

  // 4. Guarantee: never silent when directly addressed.
  const intent = decision?.intent ?? (addressed ? 'forced_ack' : 'chatter');
  if (!replyText.trim()) {
    if (!addressed) {
      offTopic = true;
      // Terminal announcer requests get a terse negative; speech gets silent.
      replyText = source === 'announcer' ? 'No record found.' : '';
    } else {
      replyText = fallbackAcknowledgement(speaker);
    }
  }

  return c.json({
    reply: replyText,
    actions,
    off_topic: offTopic,
    voice_mode: source === 'announcer' ? 'spillman_flat' : 'conversational',
    latency_ms: Date.now() - start,
    record: recordRef ?? undefined,
    intent,
  });
  } catch (err) {
    console.error('[voice] POST /dialogue failed:', err);
    return c.json({ error: 'Dialogue processing failed', detail: (err as Error)?.message }, 500);
  }
});

// ─── POST /api/voice/read-aloud ───────────────────────────────
// Reads out dispatch details when a call/dispatch event occurs.
// Accepts a structured payload and returns natural spoken text.
//
// Types: 'new_call' | 'status_change' | 'dispatch' | 'call_update' | 'bolo'
voice.post('/read-aloud', async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ reply: '', phrase: '' });

  const { type, call_number, unit, status, location, incident_type, priority } = body as Record<string, unknown>;
  const t = (type as string) || '';

  try {
    if (t === 'new_call' && typeof call_number === 'string') {
      const call = await queryFirst<{
        call_number: string; incident_type: string | null; priority: string | null;
        location_address: string | null; description: string | null; caller_name: string | null;
      }>(
        db,
        `SELECT call_number, incident_type, priority, location_address, description, caller_name
         FROM calls_for_service WHERE call_number = ? LIMIT 1`,
        call_number,
      );
      if (call) {
        const prio = call.priority === 'P1' ? 'Priority One' : call.priority === 'P2' ? 'Priority Two' : call.priority;
        const incType = (call.incident_type || 'call').replace(/_/g, ' ');
        const at = call.location_address ? ` at ${call.location_address}` : '';
        const desc = call.description ? `. ${call.description}` : '';
        const reply = `Attention all units. New ${prio} call. ${incType}${at}.${desc}`.trim();
        return c.json({ reply, phrase: `New call ${call_number}: ${incType}${at}` });
      }
    }

    if (t === 'status_change' && typeof unit === 'string' && typeof status === 'string') {
      const loc = typeof location === 'string' ? location : '';
      const at = loc ? ` at ${loc}` : '';
      const statusSpoken = (status as string).replace(/_/g, ' ');
      let reply = `Unit ${unit}, ${statusSpoken}${at}.`;
      if (typeof call_number === 'string') {
        reply = `Unit ${unit}, ${statusSpoken}${at} on call ${call_number}.`;
      }
      return c.json({ reply, phrase: `Unit ${unit} ${statusSpoken}` });
    }

    if (t === 'dispatch') {
      const unitStr = typeof unit === 'string' ? unit : '';
      const cn = typeof call_number === 'string' ? call_number : '';
      const it = typeof incident_type === 'string' ? incident_type.replace(/_/g, ' ') : '';
      const loc = typeof location === 'string' ? location : '';
      const prio = typeof priority === 'string' ? priority : '';
      const at = loc ? ` at ${loc}` : '';
      const pLabel = prio === 'P1' ? 'Priority One' : prio === 'P2' ? 'Priority Two' : prio;
      let reply = '';
      if (unitStr && cn) {
        reply = `Unit ${unitStr}, dispatched to call ${cn}. ${it}${at}${pLabel ? `. ${pLabel}` : ''}.`;
      } else if (unitStr) {
        reply = `Unit ${unitStr}, dispatched. ${it}${at}.`;
      } else if (cn) {
        reply = `Call ${cn} dispatched. ${it}${at}.`;
      }
      return c.json({ reply: reply.trim(), phrase: reply.trim() });
    }

    if (t === 'bolo') {
      const title = (body.title as string) || (body.description as string) || '';
      const desc = (body.description as string) || '';
      const reply = `Attention all units. Be on the lookout. ${title}. ${desc}`.trim();
      return c.json({ reply, phrase: `BOLO: ${title}` });
    }

    return c.json({ reply: 'Copy.', phrase: '' });
  } catch (err) {
    console.error('[voice] read-aloud failed:', (err as Error)?.message);
    return c.json({ reply: 'Copy.', phrase: '' });
  }
});

export default voice;
