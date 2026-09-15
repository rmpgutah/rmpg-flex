// useVoiceChannel — live radio voice for the console.
//
// Opens a DEDICATED WebSocket to VoiceHubDO via voiceWsUrl() (same-origin
// on rmpgutah.us through the zone proxy; wrangler :8787 in local dev).
// main /api/ws alert socket. The server side is a Durable Object
// (src/durable-objects/VoiceHubDO.ts) — one instance per channel —
// that relays PTT audio to everyone on the channel and records each
// transmission to R2.
//
// Half-duplex: one talker at a time. Mic capture is WebM/Opus in
// ~250ms chunks (base64 over JSON, matching the panic-audio wire
// format). Incoming transmissions play through StreamPlayer; a fresh
// player is created per transmission because each is a self-contained
// WebM (concatenating headers into one buffer breaks decoding).
import { useCallback, useEffect, useRef, useState } from 'react';
import { StreamPlayer } from '../../utils/StreamPlayer';
import { RadioHazePlayer } from '../../utils/radioProcessor';
import { voiceWsUrl } from '../../utils/voiceWs';

// AI-dispatcher replies arrive as a single inline clip (base64), not a
// chunk stream, so they play through RadioHazePlayer (full P25 haze)
// rather than StreamPlayer. A synthetic userId marks the active speaker.
const DISPATCH_USER_ID = -1;

function base64ToArrayBuffer(b64: string): ArrayBuffer | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  } catch { return null; }
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

export interface VoiceChannelState {
  connected: boolean;
  members: number;
  transmitting: boolean;            // am I holding the PTT
  activeSpeaker: { userId: number; label: string } | null; // who's talking (null = quiet)
  busy: boolean;                    // tried to talk while someone else held the channel
  supported: boolean;               // mic + MediaRecorder available
  pttDown: () => void;
  pttUp: () => void;
}

// A pointer to a record file the AI dispatcher looked up, carried on a
// dispatch_speak message so the operator console can auto-open it.
export interface DispatchRecordRef { kind: 'person' | 'vehicle'; id: number }

export function useVoiceChannel(
  channelId: number | null,
  onRecorded?: (transmission: any) => void,
  // `fromMe` = the looked-up record was THIS device's own request. The operator
  // console opens regardless (it monitors all traffic); a field MDT opens only
  // its own. See DispatchRecordPanel consumers.
  onRecordOpen?: (ref: DispatchRecordRef, ctx: { fromMe: boolean }) => void,
): VoiceChannelState {
  const [connected, setConnected] = useState(false);
  const [members, setMembers] = useState(0);
  const [transmitting, setTransmitting] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<{ userId: number; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Pre-acquired mic stream — opened when the channel connects so PTT
  // key-down can start encoding immediately with no getUserMedia delay.
  const micStreamRef = useRef<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<StreamPlayer | null>(null);
  const dispatchPlayerRef = useRef<RadioHazePlayer | null>(null);
  const playerDestroyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const onRecordOpenRef = useRef(onRecordOpen);
  onRecordOpenRef.current = onRecordOpen;

  const supported = typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined';

  const send = (obj: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch { /* in-flight */ }
    }
  };

  const teardownPlayer = useCallback(() => {
    if (playerDestroyTimer.current) { clearTimeout(playerDestroyTimer.current); playerDestroyTimer.current = null; }
    if (playerRef.current) { try { playerRef.current.destroy(); } catch { /* noop */ } playerRef.current = null; }
  }, []);

  // ── Connect / reconnect to the channel's voice room ──
  useEffect(() => {
    if (channelId == null) { setConnected(false); return; }
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const open = () => {
      const token = localStorage.getItem('rmpg_token');
      if (!token) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const ws = new WebSocket(voiceWsUrl(`radio-${channelId}`));
      wsRef.current = ws;

      ws.onopen = () => { if (alive) { attempts = 0; ws.send(JSON.stringify({ type: 'authenticate', token })); } };

      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case 'voice_ready':
            setConnected(true); setMembers(msg.members ?? 1);
            // Decode my own id from the JWT so I don't play back my own voice.
            try { myIdRef.current = JSON.parse(atob(token.split('.')[1])).user_id ?? JSON.parse(atob(token.split('.')[1])).userId ?? 0; } catch { /* noop */ }
            // Pre-acquire the mic so PTT key-down starts encoding instantly
            // with no getUserMedia round-trip delay (~100-300ms saved per TX).
            if (supported && !micStreamRef.current?.active) {
              navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
                .then((s) => { if (alive) { micStreamRef.current = s; } else { s.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } })
                .catch(() => { /* permission denied — pttDown falls back to on-demand */ });
            }
            break;
          case 'voice_presence':
            setMembers(msg.members ?? 0);
            break;
          case 'voice_busy':
            setBusy(true); setTimeout(() => setBusy(false), 1500);
            break;
          case 'radio_transmit_start': {
            if (msg.user_id === myIdRef.current) break; // don't echo myself
            teardownPlayer();
            const p = new StreamPlayer();
            p.init('audio/webm;codecs=opus');
            playerRef.current = p;
            setActiveSpeaker({ userId: msg.user_id, label: msg.unit_label || msg.full_name || 'Unit' });
            try { window.dispatchEvent(new CustomEvent('rmpg-radio-state', { detail: { state: 'rx' } })); } catch { /* SSR */ }
            break;
          }
          case 'radio_audio':
            if (msg.user_id === myIdRef.current) break;
            playerRef.current?.appendChunk(msg.chunk);
            break;
          case 'radio_transmit_end':
            setActiveSpeaker(null);
            // Let the tail finish, then free the decoder.
            if (playerDestroyTimer.current) clearTimeout(playerDestroyTimer.current);
            playerDestroyTimer.current = setTimeout(teardownPlayer, 1500);
            try { window.dispatchEvent(new CustomEvent('rmpg-radio-state', { detail: { state: 'idle' } })); } catch { /* SSR */ }
            break;
          case 'radio_recorded':
            onRecordedRef.current?.(msg.transmission);
            break;
          case 'dispatch_speak': {
            // AI dispatcher reply: drop it into the feed AND play it live
            // through the radio-haze chain so the channel hears DISPATCH.
            if (msg.transmission) onRecordedRef.current?.(msg.transmission);
            // If the dispatcher ran a plate/person check, auto-open the record
            // file (operator-gated server-side via ai_auto_open_records).
            // source_user_id is the requesting officer — fromMe lets a field MDT
            // open only its own request while the operator console opens all.
            if (msg.record && (msg.record.kind === 'person' || msg.record.kind === 'vehicle') && typeof msg.record.id === 'number') {
              const fromMe = msg.source_user_id != null && msg.source_user_id === myIdRef.current;
              onRecordOpenRef.current?.(msg.record as DispatchRecordRef, { fromMe });
            }
            const buf = typeof msg.audio === 'string' ? base64ToArrayBuffer(msg.audio) : null;
            if (buf) {
              teardownPlayer(); // stop any live StreamPlayer before AI dispatcher speaks
              setActiveSpeaker({ userId: DISPATCH_USER_ID, label: msg.transmission?.unit_label || 'DISPATCH' });
              const p = dispatchPlayerRef.current ?? (dispatchPlayerRef.current = new RadioHazePlayer());
              p.playBytes(buf, () => setActiveSpeaker((cur) => (cur?.userId === DISPATCH_USER_ID ? null : cur)))
                .catch(() => setActiveSpeaker((cur) => (cur?.userId === DISPATCH_USER_ID ? null : cur)));
            }
            break;
          }
          case 'dispatch_action': {
            try {
              window.dispatchEvent(new CustomEvent('rmpg:dispatch-action', {
                detail: {
                  channelId: msg.channel_id ?? null,
                  unit: msg.unit ?? null,
                  action: msg.action ?? null,
                  summary: msg.summary ?? null,
                },
              }));
            } catch { /* SSR / no-DOM */ }
            break;
          }
          case 'error': {
            // TX_TOO_LARGE: the server killed our transmission because the mic
            // stayed open too long (20 MB cap — stuck PTT on rugged hardware).
            // Without this handler the client believed it was still transmitting,
            // holding the mic open and sending chunks the server silently dropped.
            console.warn('[Radio] Server error:', msg.code, msg.message);
            if (msg.code === 'TX_TOO_LARGE') {
              setActiveSpeaker(null);
              try { window.dispatchEvent(new CustomEvent('rmpg-radio-state', { detail: { state: 'idle' } })); } catch { /* SSR */ }
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        if (!alive) return;
        setConnected(false); setActiveSpeaker(null);
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        // Exponential backoff with no hard cap — the 6-attempt limit silently
        // killed radio voice with no auto-recovery, forcing officers to manually
        // reload the page. The online listener below resets attempts on network
        // recovery, so this only backs off during sustained outages.
        attempts++;
        const delay = Math.min(1000 * Math.pow(2, Math.min(attempts, 5)), 30000);
        retry = setTimeout(open, delay);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    open();
    const onOnline = () => { if (alive) { attempts = 0; open(); } };
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      window.removeEventListener('online', onOnline);
      if (retry) clearTimeout(retry);
      teardownPlayer();
      try { dispatchPlayerRef.current?.stop(); } catch { /* noop */ }
      dispatchPlayerRef.current = null;
      try { wsRef.current?.close(); } catch { /* noop */ }
      wsRef.current = null;
      // Release the pre-acquired mic when leaving the channel.
      micStreamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      micStreamRef.current = null;
      // Release any in-progress fallback on-demand stream (used when pre-acquire
      // failed). Without this, navigating away mid-transmission leaves the mic
      // indicator lit and the audio device held open until GC.
      streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      streamRef.current = null;
      setConnected(false); setActiveSpeaker(null); setMembers(0);
    };
  }, [channelId, teardownPlayer]);

  // transmittingRef mirrors state for use inside async getUserMedia
  // (the closure captured by getUserMedia().then needs the live value).
  const transmittingRef = useRef(false);
  transmittingRef.current = transmitting;

  // ── PTT key-down: capture mic, stream chunks ──
  const pttDown = useCallback(() => {
    if (!supported || !connected || transmitting || activeSpeaker) return;
    StreamPlayer.preWarm(); // unlock playback under the same user gesture
    setTransmitting(true);
    send({ type: 'transmit_start' });
    try { window.dispatchEvent(new CustomEvent('rmpg-radio-state', { detail: { state: 'tx' } })); } catch { /* SSR */ }

    // Use the pre-acquired stream when available (zero getUserMedia latency).
    // Fall back to on-demand acquisition if pre-warm failed (permission denied
    // at connect time, or the stream was stopped by the browser).
    const preAcquired = micStreamRef.current?.active ? micStreamRef.current : null;
    const streamPromise = preAcquired
      ? Promise.resolve(preAcquired)
      : navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);

    streamPromise.then((stream) => {
      // If the user released before the mic opened, abort cleanly.
      if (!wsRef.current || !transmittingRef.current) {
        if (!preAcquired) stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        return;
      }
      // For the pre-acquired stream, we don't own it here — pttUp must not
      // stop the tracks so the stream stays alive for the next transmission.
      streamRef.current = preAcquired ? null : stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        e.data.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          send({ type: 'audio', chunk: btoa(bin) });
        }).catch(() => { /* drop */ });
      };
      rec.start(250); // 250ms chunks
    }).catch(() => {
      // Mic denied/unavailable — abandon the transmission.
      setTransmitting(false);
      send({ type: 'transmit_end' });
    });
  }, [supported, connected, transmitting, activeSpeaker]);

  // ── PTT key-up: stop the recorder, close the transmission ──
  const pttUp = useCallback(() => {
    if (!transmitting) return;
    setTransmitting(false);
    const rec = recorderRef.current;
    recorderRef.current = null;
    // streamRef holds a one-off stream (fallback path only). The pre-acquired
    // stream lives in micStreamRef and must stay open for the next PTT press.
    streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    streamRef.current = null;
    if (rec && rec.state !== 'inactive') {
      // Send transmit_end AFTER the recorder flushes its final chunk —
      // rec.stop() is async; the last ondataavailable fires after it returns.
      // Without this, the DO clears activeTx and drops the final ~250ms clip.
      rec.onstop = () => {
        send({ type: 'transmit_end' });
        try { window.dispatchEvent(new CustomEvent('rmpg-radio-state', { detail: { state: 'idle' } })); } catch { /* SSR */ }
      };
      try { rec.stop(); } catch {
        send({ type: 'transmit_end' });
        try { window.dispatchEvent(new CustomEvent('rmpg-radio-state', { detail: { state: 'idle' } })); } catch { /* SSR */ }
      }
    } else {
      send({ type: 'transmit_end' });
      try { window.dispatchEvent(new CustomEvent('rmpg-radio-state', { detail: { state: 'idle' } })); } catch { /* SSR */ }
    }
  }, [transmitting]);

  return { connected, members, transmitting, activeSpeaker, busy, supported, pttDown, pttUp };
}
