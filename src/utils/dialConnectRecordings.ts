// ============================================================
// Dial Connect recordings — parse + persist into D1 / encrypted R2
// ============================================================
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { execute, queryFirst } from './db';
import { putEncrypted } from './encryptedR2';
import type { FileKekEnv } from './encryptedR2';
import { log } from './logger';

export const DIAL_CONNECT_RECORDINGS_DDL = `CREATE TABLE IF NOT EXISTS dial_connect_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_sid TEXT NOT NULL UNIQUE,
  call_sid TEXT,
  from_number TEXT,
  to_number TEXT,
  direction TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  dispatcher_name TEXT,
  transcript TEXT,
  segments_json TEXT,
  audio_r2_key TEXT,
  audio_content_type TEXT,
  audio_bytes INTEGER,
  source TEXT NOT NULL DEFAULT 'dial_connect',
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export const MAX_TRANSCRIPT_CHARS = 500_000;
export const MAX_SEGMENTS = 2_000;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const ALLOWED_AUDIO_HOSTS = new Set(['dialer.rmpgutah.us']);

export interface DialConnectTranscriptSegment {
  start?: number;
  end?: number;
  speaker?: string;
  text: string;
}

export interface DialConnectRecordingIngest {
  recordingSid: string;
  callSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  dispatcherName?: string;
  transcript?: string;
  segments?: DialConnectTranscriptSegment[];
  audioBase64?: string;
  audioContentType?: string;
  audioUrl?: string;
}

export interface DialConnectRecordingRow {
  id: number;
  recording_sid: string;
  call_sid: string | null;
  from_number: string | null;
  to_number: string | null;
  direction: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  dispatcher_name: string | null;
  transcript: string | null;
  segments_json: string | null;
  audio_r2_key: string | null;
  audio_content_type: string | null;
  audio_bytes: number | null;
  source: string | null;
  ingested_at: string | null;
  updated_at: string | null;
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function pick(body: Record<string, unknown>, camel: string, snake: string): unknown {
  return body[camel] ?? body[snake];
}

export function parseDialConnectRecordingIngest(
  raw: unknown,
): { ok: true; value: DialConnectRecordingIngest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'JSON body required' };
  const body = raw as Record<string, unknown>;
  const recordingSid = str(pick(body, 'recordingSid', 'recording_sid'), 64);
  if (!recordingSid) return { ok: false, error: 'recordingSid is required' };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(recordingSid)) {
    return { ok: false, error: 'recordingSid must be 8–64 alphanumeric characters' };
  }

  const value: DialConnectRecordingIngest = { recordingSid };
  value.callSid = str(pick(body, 'callSid', 'call_sid'), 64);
  value.from = str(pick(body, 'from', 'from_number'), 40);
  value.to = str(pick(body, 'to', 'to_number'), 40);
  value.direction = str(pick(body, 'direction', 'call_direction'), 20)?.toLowerCase();
  value.startedAt = str(pick(body, 'startedAt', 'started_at'), 64);
  value.endedAt = str(pick(body, 'endedAt', 'ended_at'), 64);
  value.durationSeconds = num(pick(body, 'durationSeconds', 'duration_seconds'));
  value.dispatcherName = str(pick(body, 'dispatcherName', 'dispatcher_name'), 120);
  value.transcript = str(pick(body, 'transcript', 'transcription'), MAX_TRANSCRIPT_CHARS);
  value.audioContentType = str(pick(body, 'audioContentType', 'audio_content_type'), 80);
  value.audioBase64 = str(pick(body, 'audioBase64', 'audio_base64'), Math.ceil(MAX_AUDIO_BYTES * 1.4) + 64);
  value.audioUrl = str(pick(body, 'audioUrl', 'audio_url'), 500);

  const segs = pick(body, 'segments', 'transcript_segments');
  if (Array.isArray(segs)) {
    const out: DialConnectTranscriptSegment[] = [];
    for (const s of segs.slice(0, MAX_SEGMENTS)) {
      if (!s || typeof s !== 'object') continue;
      const rec = s as Record<string, unknown>;
      const text = str(rec.text, 8_000);
      if (!text) continue;
      out.push({
        text,
        speaker: str(rec.speaker, 80),
        start: num(rec.start ?? rec.start_seconds),
        end: num(rec.end ?? rec.end_seconds),
      });
    }
    if (out.length) value.segments = out;
  }

  return { ok: true, value };
}

export function isAllowedDialConnectAudioUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;
  const host = parsed.hostname.toLowerCase();
  if (ALLOWED_AUDIO_HOSTS.has(host)) return true;
  return host.endsWith('.dialer.rmpgutah.us');
}

function extForContentType(ct: string | undefined): string {
  const t = (ct || '').toLowerCase();
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('webm')) return 'webm';
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a';
  return 'bin';
}

function decodeAudioBase64(raw: string): Uint8Array | null {
  const comma = raw.indexOf(',');
  const b64 = raw.startsWith('data:') && comma >= 0 ? raw.slice(comma + 1) : raw;
  try {
    const bin = atob(b64);
    if (bin.length > MAX_AUDIO_BYTES) return null;
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function ensureDialConnectRecordingsTable(db: D1Database): Promise<void> {
  await execute(db, DIAL_CONNECT_RECORDINGS_DDL);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_dial_connect_recordings_started ON dial_connect_recordings(started_at DESC)`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_dial_connect_recordings_call_sid ON dial_connect_recordings(call_sid)`);
}

async function fetchAllowedAudio(url: string, bearer?: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!isAllowedDialConnectAudioUrl(url)) return null;
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(url, { method: 'GET', headers, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) return null;
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || 'application/octet-stream';
  if (!ct.toLowerCase().startsWith('audio/') && !ct.toLowerCase().includes('octet-stream')) {
    return null;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_AUDIO_BYTES) return null;
  return { bytes: buf, contentType: ct.split(';')[0].trim() };
}

export async function upsertDialConnectRecording(opts: {
  db: D1Database;
  uploads?: R2Bucket;
  env?: FileKekEnv;
  ingest: DialConnectRecordingIngest;
  source: string;
  audioFetchBearer?: string;
}): Promise<{ id: number; created: boolean; hasAudio: boolean }> {
  const { db, ingest } = opts;
  await ensureDialConnectRecordingsTable(db);

  const segmentsJson = ingest.segments ? JSON.stringify(ingest.segments) : undefined;

  let audioBytes: Uint8Array | null = null;
  let audioCt = ingest.audioContentType;
  if (ingest.audioBase64) {
    audioBytes = decodeAudioBase64(ingest.audioBase64);
    if (!audioBytes) {
      log.warn('Dial Connect recording audioBase64 rejected', { recordingSid: ingest.recordingSid });
    }
  } else if (ingest.audioUrl && opts.uploads) {
    try {
      const fetched = await fetchAllowedAudio(ingest.audioUrl, opts.audioFetchBearer);
      if (fetched) {
        audioBytes = fetched.bytes;
        audioCt = audioCt || fetched.contentType;
      }
    } catch (err) {
      log.warn('Dial Connect audio URL fetch failed', {
        recordingSid: ingest.recordingSid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const existing = await queryFirst<DialConnectRecordingRow>(
    db,
    'SELECT * FROM dial_connect_recordings WHERE recording_sid = ?',
    ingest.recordingSid,
  );

  let r2Key = existing?.audio_r2_key || null;
  let storedBytes = existing?.audio_bytes ?? null;
  let storedCt = existing?.audio_content_type || null;

  if (audioBytes && opts.uploads && opts.env && !r2Key) {
    const key = `dial-connect-recordings/${ingest.recordingSid}.${extForContentType(audioCt)}`;
    await putEncrypted(opts.uploads, db, opts.env, key, audioBytes, {
      httpMetadata: { contentType: audioCt || 'audio/mpeg' },
    });
    r2Key = key;
    storedBytes = audioBytes.byteLength;
    storedCt = audioCt || 'audio/mpeg';
  }

  if (!existing) {
    const result = await execute(
      db,
      `INSERT INTO dial_connect_recordings (
         recording_sid, call_sid, from_number, to_number, direction,
         started_at, ended_at, duration_seconds, dispatcher_name,
         transcript, segments_json, audio_r2_key, audio_content_type, audio_bytes, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ingest.recordingSid,
      ingest.callSid ?? null,
      ingest.from ?? null,
      ingest.to ?? null,
      ingest.direction ?? null,
      ingest.startedAt ?? null,
      ingest.endedAt ?? null,
      ingest.durationSeconds ?? null,
      ingest.dispatcherName ?? null,
      ingest.transcript ?? null,
      segmentsJson ?? null,
      r2Key,
      storedCt,
      storedBytes,
      opts.source,
    );
    return {
      id: Number(result.meta.last_row_id),
      created: true,
      hasAudio: Boolean(r2Key),
    };
  }

  const nextTranscript =
    ingest.transcript && (!existing.transcript || ingest.transcript.length > existing.transcript.length)
      ? ingest.transcript
      : existing.transcript;
  const nextSegments = segmentsJson && !existing.segments_json ? segmentsJson : existing.segments_json;

  await execute(
    db,
    `UPDATE dial_connect_recordings SET
       call_sid = COALESCE(NULLIF(call_sid, ''), ?),
       from_number = COALESCE(NULLIF(from_number, ''), ?),
       to_number = COALESCE(NULLIF(to_number, ''), ?),
       direction = COALESCE(NULLIF(direction, ''), ?),
       started_at = COALESCE(NULLIF(started_at, ''), ?),
       ended_at = COALESCE(NULLIF(ended_at, ''), ?),
       duration_seconds = COALESCE(duration_seconds, ?),
       dispatcher_name = COALESCE(NULLIF(dispatcher_name, ''), ?),
       transcript = ?,
       segments_json = ?,
       audio_r2_key = COALESCE(NULLIF(audio_r2_key, ''), ?),
       audio_content_type = COALESCE(NULLIF(audio_content_type, ''), ?),
       audio_bytes = COALESCE(audio_bytes, ?),
       updated_at = datetime('now')
     WHERE recording_sid = ?`,
    ingest.callSid ?? existing.call_sid,
    ingest.from ?? existing.from_number,
    ingest.to ?? existing.to_number,
    ingest.direction ?? existing.direction,
    ingest.startedAt ?? existing.started_at,
    ingest.endedAt ?? existing.ended_at,
    ingest.durationSeconds ?? existing.duration_seconds,
    ingest.dispatcherName ?? existing.dispatcher_name,
    nextTranscript,
    nextSegments,
    r2Key,
    storedCt,
    storedBytes,
    ingest.recordingSid,
  );

  return { id: existing.id, created: false, hasAudio: Boolean(r2Key) };
}

export function publicRecordingSummary(row: DialConnectRecordingRow) {
  return {
    id: row.id,
    recording_sid: row.recording_sid,
    call_sid: row.call_sid,
    from_number: row.from_number,
    to_number: row.to_number,
    direction: row.direction,
    started_at: row.started_at,
    ended_at: row.ended_at,
    duration_seconds: row.duration_seconds,
    dispatcher_name: row.dispatcher_name,
    has_audio: Boolean(row.audio_r2_key),
    has_transcript: Boolean(row.transcript && row.transcript.trim()),
    ingested_at: row.ingested_at,
  };
}

export function publicRecordingDetail(row: DialConnectRecordingRow) {
  let segments: DialConnectTranscriptSegment[] | null = null;
  if (row.segments_json) {
    try {
      const parsed = JSON.parse(row.segments_json);
      if (Array.isArray(parsed)) segments = parsed;
    } catch {
      segments = null;
    }
  }
  return {
    ...publicRecordingSummary(row),
    transcript: row.transcript,
    segments,
    audio_content_type: row.audio_content_type,
  };
}
