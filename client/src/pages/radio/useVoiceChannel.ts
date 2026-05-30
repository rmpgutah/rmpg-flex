// useVoiceChannel — live radio voice for the console.
//
// Opens a DEDICATED WebSocket straight to the rewrite worker's voice
// hub (wss://api.rmpgutah.us/api/voice-ws), separate from the app's
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
  onRecordOpen?: (ref: DispatchRecordRef) => void,
): VoiceChannelState {
  const [connected, setConnected] = useState(false);
  const [members, setMembers] = useState(0);
  const [transmitting, setTransmitting] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<{ userId: number; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
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
            if (msg.record && (msg.record.kind === 'person' || msg.record.kind === 'vehicle') && typeof msg.record.id === 'number') {
              onRecordOpenRef.current?.(msg.record as DispatchRecordRef);
            }
            const buf = typeof msg.audio === 'string' ? base64ToArrayBuffer(msg.audio) : null;
            if (buf) {
              setActiveSpeaker({ userId: DISPATCH_USER_ID, label: msg.transmission?.unit_label || 'DISPATCH' });
              const p = dispatchPlayerRef.current ?? (dispatchPlayerRef.current = new RadioHazePlayer());
              p.playBytes(buf, () => setActiveSpeaker((cur) => (cur?.userId === DISPATCH_USER_ID ? null : cur)))
                .catch(() => setActiveSpeaker((cur) => (cur?.userId === DISPATCH_USER_ID ? null : cur)));
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        if (!alive) return;
        setConnected(false); setActiveSpeaker(null);
        // Backoff reconnect while this channel stays selected.
        if (attempts < 6) {
          attempts++;
          retry = setTimeout(open, Math.min(1000 * attempts, 5000));
        }
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    open();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      teardownPlayer();
      try { dispatchPlayerRef.current?.stop(); } catch { /* noop */ }
      dispatchPlayerRef.current = null;
      try { wsRef.current?.close(); } catch { /* noop */ }
      wsRef.current = null;
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

    navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS).then((stream) => {
      // If the user released before the mic opened, abort cleanly.
      if (!wsRef.current || !transmittingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
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
      rec.start(250); // 250ms chunks — snappy without flooding
    }).catch(() => {
      // Mic denied/unavailable — abandon the transmission.
      setTransmitting(false);
      send({ type: 'transmit_end' });
    });
  }, [supported, connected, transmitting, activeSpeaker]);

  // ── PTT key-up: stop the mic, close the transmission ──
  const pttUp = useCallback(() => {
    if (!transmitting) return;
    setTransmitting(false);
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* noop */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    send({ type: 'transmit_end' });
  }, [transmitting]);

  return { connected, members, transmitting, activeSpeaker, busy, supported, pttDown, pttUp };
}
