// Crash-resilient interaction audio recorder (Intel Wave 3b).
// MediaRecorder (opus, 5s timeslice) → each chunk PUT to R2 immediately,
// so a reload/crash loses at most the in-flight 5 seconds. Holds a wake
// lock while recording and persists the active recording id to
// localStorage so a reload can finalize an orphaned session.
//
// HONEST LIMIT: this runs while the app/tab is open. Capture with the
// app fully closed / screen locked needs the native iOS app.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './useApi';

const TIMESLICE_MS = 5000;
const LS_KEY = 'rmpg-active-recording';

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
}

export interface RecorderMeta { location?: string; lat?: number; lng?: number; notes?: string }

export function useInteractionRecorder() {
  const [recording, setRecording] = useState(false);
  const [recordingId, setRecordingId] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [chunksSent, setChunksSent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mrRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const seqRef = useRef(0);
  const idRef = useRef<number | null>(null);
  const wakeRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Surface an orphaned recording (reload mid-session) so it can be finalized.
  const [orphan, setOrphan] = useState<number | null>(() => {
    try { const v = localStorage.getItem(LS_KEY); return v ? Number(v) : null; } catch { return null; }
  });

  const uploadChunk = useCallback(async (id: number, seq: number, blob: Blob) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/intel/recordings/${id}/chunk?seq=${seq}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'content-type': 'audio/webm', ...authHeader() },
          body: blob,
        });
        if (res.ok) { setChunksSent((n) => n + 1); return; }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    setError('A chunk failed to upload after retries');
  }, []);

  const start = useCallback(async (meta: RecorderMeta = {}) => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const { id } = await apiFetch<{ id: number }>('/intel/recordings/start', {
        method: 'POST', body: JSON.stringify(meta),
      });
      idRef.current = id; seqRef.current = 0;
      setRecordingId(id); setChunksSent(0); setElapsed(0);
      try { localStorage.setItem(LS_KEY, String(id)); } catch { /* ignore */ }

      const mr = new MediaRecorder(stream, { mimeType: pickMime() });
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0 && idRef.current != null) {
          const seq = seqRef.current++;
          void uploadChunk(idRef.current, seq, e.data);
        }
      };
      mr.start(TIMESLICE_MS);
      mrRef.current = mr;
      setRecording(true);

      try { wakeRef.current = await (navigator as any).wakeLock?.request('screen'); } catch { /* best-effort */ }
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (err) {
      setError(((err as { name?: string }).name === 'NotAllowedError') ? 'Microphone permission denied' : (err instanceof Error ? err.message : 'Could not start recording'));
      streamRef.current?.getTracks().forEach((t) => t.stop());
    }
  }, [uploadChunk]);

  const finalize = useCallback(async (id: number, duration: number) => {
    try { await apiFetch(`/intel/recordings/${id}/stop`, { method: 'POST', body: JSON.stringify({ duration_sec: duration }) }); }
    catch (e) { console.error(e); }
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }, []);

  const stop = useCallback(async () => {
    clearInterval(timerRef.current);
    const mr = mrRef.current;
    if (mr && mr.state !== 'inactive') { try { mr.requestData(); mr.stop(); } catch { /* ignore */ } }
    try { await wakeRef.current?.release?.(); } catch { /* ignore */ }
    wakeRef.current = null;
    setRecording(false);
    const id = idRef.current;
    if (id != null) { await finalize(id, elapsed); }
    idRef.current = null;
    setOrphan(null);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [elapsed, finalize]);

  // Finalize an orphaned recording from a previous session.
  const finalizeOrphan = useCallback(async () => {
    if (orphan != null) { await finalize(orphan, 0); setOrphan(null); }
  }, [orphan, finalize]);

  useEffect(() => () => { clearInterval(timerRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  return { recording, recordingId, elapsed, chunksSent, error, orphan, start, stop, finalizeOrphan };
}

// Mirror apiFetch's auth: it attaches the bearer token; for the raw fetch
// chunk PUT we replicate just the Authorization header from storage.
function authHeader(): Record<string, string> {
  try {
    const t = localStorage.getItem('rmpg_token');
    return t ? { authorization: `Bearer ${t}` } : {};
  } catch { return {}; }
}
