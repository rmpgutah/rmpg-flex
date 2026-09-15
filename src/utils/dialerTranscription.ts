// ============================================================
// Dial Connect — transcription backstop
// ============================================================
// Every archived call and voicemail must end up with a transcript.
//
// The PRIMARY transcription path is upstream in dispatch-app: Twilio Voice
// Intelligence when TWILIO_INTELLIGENCE_SERVICE_SID is set, otherwise the
// OpenAI pipeline in call-ai-processing.ts. Both are gated on credentials and
// both return silently when those are unset — which is why recordings could
// sit in the archive with transcript_status = 'none' indefinitely, with
// nothing anywhere saying transcription had simply never run. A search over
// `transcript` then reports "no matches" for a call that was never read.
//
// This sweep closes that gap using the Worker's OWN Workers AI binding, over
// the recording already mirrored into encrypted R2 (see the mirror in
// routes/dialerConnect.ts). It is deliberately a BACKSTOP, not a replacement:
// it only ever fills a row whose transcript is still empty, so an upstream
// transcript — which has speaker diarization and no size ceiling — always
// wins. Bookkeeping columns come from migration 0292.
// ============================================================

import type { Env } from '../types';
import { getDb, query, execute, queryFirst } from './db';
import { getDecrypted, FileEncryptionError } from './encryptedR2';
import { transcribeTransmission } from './aiDispatcher';
import { log } from './logger';

type Kind = 'call' | 'vm';

const TABLE: Record<Kind, 'dialer_calls' | 'dialer_voicemails'> = {
  call: 'dialer_calls',
  vm: 'dialer_voicemails',
};

/**
 * Retry ceiling per row. A transient model failure deserves another tick; a
 * recording Whisper cannot make sense of must stop consuming AI budget every
 * 30 minutes forever.
 */
export const TRANSCRIBE_MAX_ATTEMPTS = 3;

/**
 * Largest recording handed to Whisper. The model takes the audio inline
 * (base64 for the turbo model), so a long call recording would blow the
 * request budget rather than transcribe slowly. Oversize rows are marked
 * 'too_large' and left for the upstream path, which has no such ceiling.
 */
export const TRANSCRIBE_MAX_BYTES = 8 * 1024 * 1024;

interface Candidate {
  id: number;
  recording_r2_key: string;
  recording_bytes: number | null;
  transcript_attempts: number | null;
}

/** Statuses the sweep must not re-enter: terminal, or already satisfied. */
const TERMINAL_STATUSES = ["'ready'", "'too_large'", "'unintelligible'"].join(', ');

async function markTerminal(
  db: D1Database, table: string, id: number, status: string, error: string,
): Promise<void> {
  await execute(db, `UPDATE ${table} SET
      transcript_status = ?, transcript_error = ?, updated_at = datetime('now')
    WHERE id = ?`, status, error.slice(0, 300), id);
}

async function transcribeRow(env: Env['Bindings'], kind: Kind, row: Candidate): Promise<'transcribed' | 'failed' | 'skipped'> {
  const db = getDb(env);
  const table = TABLE[kind];

  if ((row.recording_bytes ?? 0) > TRANSCRIBE_MAX_BYTES) {
    await markTerminal(db, table, row.id, 'too_large',
      `recording too large to transcribe inline: ${row.recording_bytes} bytes`);
    return 'skipped';
  }

  // Every attempt is counted BEFORE the model runs. Counting after would let a
  // call that reliably crashes the isolate mid-run be retried forever.
  await execute(db, `UPDATE ${table} SET
      transcript_attempts = COALESCE(transcript_attempts, 0) + 1, updated_at = datetime('now')
    WHERE id = ?`, row.id);

  const fail = async (reason: string) => {
    const attempts = (row.transcript_attempts ?? 0) + 1;
    if (attempts >= TRANSCRIBE_MAX_ATTEMPTS) {
      await markTerminal(db, table, row.id, 'unintelligible', reason);
    } else {
      await execute(db, `UPDATE ${table} SET transcript_error = ?, updated_at = datetime('now') WHERE id = ?`,
        reason.slice(0, 300), row.id);
    }
    log.warn('dialer transcription failed', { kind, id: row.id, attempts, reason });
    return 'failed' as const;
  };

  let audio: Uint8Array;
  try {
    const decrypted = await getDecrypted(env.UPLOADS!, db, env, row.recording_r2_key);
    if (!decrypted) return fail('recording missing from R2');
    audio = decrypted.bytes;
  } catch (err) {
    if (err instanceof FileEncryptionError) return fail(`decrypt: ${err.message}`);
    return fail(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
  if (audio.byteLength > TRANSCRIBE_MAX_BYTES) {
    await markTerminal(db, table, row.id, 'too_large',
      `recording too large to transcribe inline: ${audio.byteLength} bytes`);
    return 'skipped';
  }

  let text: string | null;
  try {
    text = await transcribeTransmission(env.AI, audio);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (!text) return fail('model returned no transcript');

  // Guarded on `transcript IS NULL`: an upstream `transcript_ready` event may
  // have landed while the model was running, and it is the better transcript.
  await execute(db, `UPDATE ${table} SET
      transcript = ?, transcript_status = 'ready', transcript_source = 'workers-ai',
      transcript_error = NULL, updated_at = datetime('now')
    WHERE id = ? AND (transcript IS NULL OR TRIM(transcript) = '')`, text, row.id);
  log.info('dialer recording transcribed', { kind, id: row.id, chars: text.length });
  return 'transcribed';
}

/**
 * Cron backstop: transcribe mirrored recordings that still have no transcript.
 * Bounded per tick so one sweep can never monopolise the AI budget.
 */
export async function transcribePendingRecordings(
  env: Env['Bindings'],
  limit = 10,
): Promise<{ attempted: number; transcribed: number; failed: number }> {
  const out = { attempted: 0, transcribed: 0, failed: 0 };
  if (!env.AI || !env.UPLOADS) return out;
  const db = getDb(env);

  let budget = limit;
  for (const kind of ['call', 'vm'] as const) {
    if (budget <= 0) break;
    const table = TABLE[kind];
    let rows: Candidate[];
    try {
      rows = await query<Candidate>(db, `SELECT id, recording_r2_key, recording_bytes, transcript_attempts
        FROM ${table}
        WHERE recording_r2_key IS NOT NULL
          AND (transcript IS NULL OR TRIM(transcript) = '')
          AND COALESCE(transcript_status, 'none') NOT IN (${TERMINAL_STATUSES})
          AND COALESCE(transcript_attempts, 0) < ?
        ORDER BY id DESC LIMIT ?`, TRANSCRIBE_MAX_ATTEMPTS, budget);
    } catch (err) {
      // The 0292 columns are reconciled by the dialerConnect route at runtime;
      // a sweep that fires before any request has touched that route must
      // degrade rather than take the whole cron tick down with it.
      log.warn('dialer transcription sweep could not read candidates', { kind, err: err instanceof Error ? err.message : String(err) });
      continue;
    }
    for (const row of rows) {
      budget -= 1;
      out.attempted += 1;
      const res = await transcribeRow(env, kind, row);
      if (res === 'transcribed') out.transcribed += 1;
      else if (res === 'failed') out.failed += 1;
    }
  }
  return out;
}

/** Exposed for the route's on-demand retry of a single row. */
export async function transcribeOne(env: Env['Bindings'], kind: Kind, id: number): Promise<boolean> {
  if (!env.AI || !env.UPLOADS) return false;
  const row = await queryFirst<Candidate>(getDb(env),
    `SELECT id, recording_r2_key, recording_bytes, transcript_attempts FROM ${TABLE[kind]} WHERE id = ?`, id);
  if (!row?.recording_r2_key) return false;
  return (await transcribeRow(env, kind, row)) === 'transcribed';
}
