import { useState, useRef, useCallback, useEffect } from 'react';
import { StreamPlayer } from '../utils/StreamPlayer';
import { voiceWsUrl } from '../utils/voiceWs';

// ============================================================
// RMPG Flex — Panic Audio Hook
// ============================================================
// Live distress audio for a panic alert, carried on the DEDICATED
// voice socket (VoiceHubDO, room panic-<panicId>) — NOT the main
// /api/ws alert socket, which lands on the legacy worker that has no
// audio relay (the old panic_audio messages were silently dropped).
//
// Roles in a panic room (all share the same half-duplex hub):
//   • Sender   — the officer: startBroadcast() opens the mic for up to
//                60s. The DO relays it to everyone AND archives it to
//                R2 (panic_alerts.audio_file_id). Stays connected after
//                to hear talk-back.
//   • Listener — dispatchers/supervisors: listen() on the incoming
//                panic_alert, hear the officer in real time.
//   • Responder— a listener who talks back: startResponse() once the
//                officer's broadcast ends (half-duplex).
// ============================================================

export interface PanicAudioState {
  isBroadcasting: boolean;   // local mic capturing (sender)
  isReceiving: boolean;      // hearing audio from the room
  isResponding: boolean;     // responder mic open (talk-back)
  broadcastTimeLeft: number; // remaining seconds of the sender broadcast
  panicSenderUserId: number | null; // sender (for talk-back target)
  error: string | null;
}

const BROADCAST_DURATION = 60; // seconds
const MIC: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 },
};

function pickMime(): string {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
}

export function usePanicAudio() {
  const [state, setState] = useState<PanicAudioState>({
    isBroadcasting: false,
    isReceiving: false,
    isResponding: false,
    broadcastTimeLeft: 0,
    panicSenderUserId: null,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<number | null>(null);   // current panicId
  const authedRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const broadcastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const broadcastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBroadcastingRef = useRef(false);
  const panicIdRef = useRef<number | null>(null);
  const broadcastStartTimeRef = useRef<number>(0);
  const playerRef = useRef<StreamPlayer | null>(null);
  const playerTeardownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopBroadcastRef = useRef<() => void>(() => {});

  const sendVoice = (obj: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch { /* in-flight */ }
    }
  };

  const teardownPlayer = useCallback(() => {
    if (playerTeardownTimer.current) { clearTimeout(playerTeardownTimer.current); playerTeardownTimer.current = null; }
    if (playerRef.current) { try { playerRef.current.destroy(); } catch { /* noop */ } playerRef.current = null; }
  }, []);

  // Open (or reuse) the voice socket for a panic room and resolve once
  // the DO has authenticated us. The onmessage handler plays incoming
  // audio for every role — the sender hears talk-back through the very
  // same path a dispatcher hears the sender.
  const ensureConnected = useCallback((panicId: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current && roomRef.current === panicId
          && wsRef.current.readyState === WebSocket.OPEN && authedRef.current) {
        resolve(); return;
      }
      if (wsRef.current && roomRef.current !== panicId) {
        try { wsRef.current.close(); } catch { /* noop */ }
        wsRef.current = null; authedRef.current = false;
      }
      const token = localStorage.getItem('rmpg_token');
      if (!token) { reject(new Error('Not authenticated')); return; }

      roomRef.current = panicId;
      const ws = new WebSocket(voiceWsUrl(`panic-${panicId}`));
      wsRef.current = ws;
      let settled = false;
      const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error('Voice connect timeout')); } }, 8000);

      ws.onopen = () => { try { ws.send(JSON.stringify({ type: 'authenticate', token })); } catch { /* noop */ } };
      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case 'voice_ready':
            authedRef.current = true;
            if (!settled) { settled = true; clearTimeout(to); resolve(); }
            break;
          case 'radio_transmit_start':
            teardownPlayer();
            { const p = new StreamPlayer(); p.init('audio/webm;codecs=opus'); playerRef.current = p; }
            setState((prev) => ({ ...prev, isReceiving: true, panicSenderUserId: msg.user_id ?? prev.panicSenderUserId }));
            break;
          case 'radio_audio':
            playerRef.current?.appendChunk(msg.chunk);
            break;
          case 'radio_transmit_end':
            setState((prev) => ({ ...prev, isReceiving: false }));
            if (playerTeardownTimer.current) clearTimeout(playerTeardownTimer.current);
            playerTeardownTimer.current = setTimeout(teardownPlayer, 1500);
            break;
          case 'voice_busy':
            setState((prev) => ({ ...prev, error: 'Channel busy — wait for the current transmission' }));
            break;
        }
      };
      ws.onerror = () => { if (!settled) { settled = true; clearTimeout(to); reject(new Error('Voice connect error')); } };
      ws.onclose = () => { if (roomRef.current === panicId) authedRef.current = false; };
    });
  }, [teardownPlayer]);

  // ─── Sender: open the mic for up to 60s ─────────────────────
  const startBroadcast = useCallback(async (panicId?: number) => {
    if (isBroadcastingRef.current) return;
    if (panicId == null) { setState((p) => ({ ...p, error: 'No panic id for voice room' })); return; }
    isBroadcastingRef.current = true;
    panicIdRef.current = panicId;
    broadcastStartTimeRef.current = Date.now();

    try {
      await ensureConnected(panicId);
      const stream = await navigator.mediaDevices.getUserMedia(MIC);
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: pickMime(), audioBitsPerSecond: 16000 });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const reader = new FileReader();
        reader.onload = () => sendVoice({ type: 'audio', chunk: (reader.result as string).split(',')[1] || '' });
        reader.readAsDataURL(event.data);
      };

      sendVoice({ type: 'transmit_start' });
      recorder.start(500);
      setState((prev) => ({ ...prev, isBroadcasting: true, broadcastTimeLeft: BROADCAST_DURATION, error: null }));

      let timeLeft = BROADCAST_DURATION;
      broadcastTimerRef.current = setInterval(() => {
        timeLeft -= 1;
        setState((prev) => ({ ...prev, broadcastTimeLeft: timeLeft }));
        if (timeLeft <= 0) stopBroadcastRef.current();
      }, 1000);
      broadcastTimeoutRef.current = setTimeout(() => stopBroadcastRef.current(), BROADCAST_DURATION * 1000);
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
      if (broadcastTimerRef.current) { clearInterval(broadcastTimerRef.current); broadcastTimerRef.current = null; }
      if (broadcastTimeoutRef.current) { clearTimeout(broadcastTimeoutRef.current); broadcastTimeoutRef.current = null; }
      isBroadcastingRef.current = false;
      setState((prev) => ({ ...prev, isBroadcasting: false, error: err instanceof Error ? err.message : 'Failed to access microphone' }));
    }
  }, [ensureConnected]);

  // ─── Stop the sender broadcast (stays connected for talk-back) ──
  const stopBroadcast = useCallback(() => {
    if (!isBroadcastingRef.current) return;
    isBroadcastingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    if (broadcastTimerRef.current) { clearInterval(broadcastTimerRef.current); broadcastTimerRef.current = null; }
    if (broadcastTimeoutRef.current) { clearTimeout(broadcastTimeoutRef.current); broadcastTimeoutRef.current = null; }

    const duration = Math.round((Date.now() - broadcastStartTimeRef.current) / 1000);
    sendVoice({ type: 'transmit_end', duration });
    panicIdRef.current = null;
    broadcastStartTimeRef.current = 0;
    setState((prev) => ({ ...prev, isBroadcasting: false, broadcastTimeLeft: 0 }));
  }, []);

  useEffect(() => { stopBroadcastRef.current = stopBroadcast; }, [stopBroadcast]);

  // ─── Listener: hear a panic room (dispatcher receiving the alert) ──
  const listen = useCallback(async (panicId: number) => {
    try { await ensureConnected(panicId); } catch { /* connect failures are non-fatal — alert UI still works */ }
  }, [ensureConnected]);

  // ─── Responder: talk back over the already-open room ──────────
  const startResponse = useCallback(async (_targetUserId: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setState((p) => ({ ...p, error: 'Not connected to the panic channel' })); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC);
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: pickMime(), audioBitsPerSecond: 16000 });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const reader = new FileReader();
        reader.onload = () => sendVoice({ type: 'audio', chunk: (reader.result as string).split(',')[1] || '' });
        reader.readAsDataURL(event.data);
      };
      sendVoice({ type: 'transmit_start' });
      recorder.start(500);
      setState((prev) => ({ ...prev, isResponding: true, error: null }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err instanceof Error ? err.message : 'Failed to access microphone' }));
    }
  }, []);

  const stopResponse = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    sendVoice({ type: 'transmit_end' });
    setState((prev) => ({ ...prev, isResponding: false }));
  }, []);

  // ─── Stop listening / leave the room (alert dismissed/resolved) ──
  const stopListening = useCallback(() => {
    if (isBroadcastingRef.current) return; // never cut our own live broadcast
    try { wsRef.current?.close(); } catch { /* noop */ }
    wsRef.current = null; authedRef.current = false; roomRef.current = null;
    teardownPlayer();
    setState((prev) => ({ ...prev, isReceiving: false }));
  }, [teardownPlayer]);

  const setSenderUserId = useCallback((userId: number) => {
    setState((prev) => ({ ...prev, panicSenderUserId: userId }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isBroadcastingRef.current = false;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (broadcastTimerRef.current) clearInterval(broadcastTimerRef.current);
      if (broadcastTimeoutRef.current) clearTimeout(broadcastTimeoutRef.current);
      if (playerTeardownTimer.current) clearTimeout(playerTeardownTimer.current);
      try { playerRef.current?.destroy(); } catch { /* noop */ }
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
  }, []);

  return {
    ...state,
    startBroadcast,
    stopBroadcast,
    startResponse,
    stopResponse,
    setSenderUserId,
    listen,
    stopListening,
  };
}
