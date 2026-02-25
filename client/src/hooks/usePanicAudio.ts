import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { StreamPlayer } from '../utils/StreamPlayer';

// ============================================================
// RMPG Flex — Panic Audio Hook
// Opens a live mic for 15 seconds when panic is activated.
// Other users hear the audio in real-time via MediaSource
// Extensions (MSE) streaming. After 15 seconds, responders
// can talk back to the panic sender.
// ============================================================

export interface PanicAudioState {
  /** Whether the local mic is actively capturing (sender) */
  isBroadcasting: boolean;
  /** Whether we are receiving audio from a panic sender */
  isReceiving: boolean;
  /** Whether the responder mic is open (talk-back mode) */
  isResponding: boolean;
  /** Remaining seconds of the broadcast */
  broadcastTimeLeft: number;
  /** The user ID of the panic sender (for talk-back) */
  panicSenderUserId: number | null;
  /** Error message */
  error: string | null;
}

const BROADCAST_DURATION = 15; // seconds

// ── Hook ─────────────────────────────────────────────────────

export function usePanicAudio() {
  const { send, subscribe } = useWebSocket();

  const [state, setState] = useState<PanicAudioState>({
    isBroadcasting: false,
    isReceiving: false,
    isResponding: false,
    broadcastTimeLeft: 0,
    panicSenderUserId: null,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const broadcastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const broadcastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stream players for incoming audio (separate for panic vs. response)
  const panicPlayerRef = useRef<StreamPlayer | null>(null);
  const responsePlayerRef = useRef<StreamPlayer | null>(null);

  // ─── Start broadcasting (sender — open mic) ─────────────────
  const startBroadcast = useCallback(async () => {
    try {
      // Request mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      // Use MediaRecorder to capture audio in small chunks
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          // Convert blob to base64 and send via WebSocket
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            send({
              type: 'panic_audio',
              data: {
                audio: base64,
                mimeType,
                chunk: true,
              },
            });
          };
          reader.readAsDataURL(event.data);
        }
      };

      // Capture in 500ms chunks for near-real-time streaming
      recorder.start(500);

      setState(prev => ({
        ...prev,
        isBroadcasting: true,
        broadcastTimeLeft: BROADCAST_DURATION,
        error: null,
      }));

      // Countdown timer
      let timeLeft = BROADCAST_DURATION;
      broadcastTimerRef.current = setInterval(() => {
        timeLeft -= 1;
        setState(prev => ({ ...prev, broadcastTimeLeft: timeLeft }));
        if (timeLeft <= 0) {
          stopBroadcast();
        }
      }, 1000);

      // Hard stop after duration
      broadcastTimeoutRef.current = setTimeout(() => {
        stopBroadcast();
      }, BROADCAST_DURATION * 1000);

    } catch (err) {
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to access microphone',
      }));
    }
  }, [send]);

  // ─── Stop broadcasting ──────────────────────────────────────
  const stopBroadcast = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (broadcastTimerRef.current) {
      clearInterval(broadcastTimerRef.current);
      broadcastTimerRef.current = null;
    }
    if (broadcastTimeoutRef.current) {
      clearTimeout(broadcastTimeoutRef.current);
      broadcastTimeoutRef.current = null;
    }
    mediaRecorderRef.current = null;

    // Signal end of broadcast
    send({
      type: 'panic_audio',
      data: { end: true },
    });

    setState(prev => ({
      ...prev,
      isBroadcasting: false,
      broadcastTimeLeft: 0,
    }));
  }, [send]);

  // ─── Start responding (talk-back mode) ──────────────────────
  const startResponse = useCallback(async (targetUserId: number) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 16000 });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            send({
              type: 'panic_audio_response',
              targetUserId,
              data: {
                audio: base64,
                mimeType,
                chunk: true,
              },
            });
          };
          reader.readAsDataURL(event.data);
        }
      };

      recorder.start(500);
      setState(prev => ({ ...prev, isResponding: true, error: null }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to access microphone',
      }));
    }
  }, [send]);

  // ─── Stop responding ────────────────────────────────────────
  const stopResponse = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setState(prev => ({ ...prev, isResponding: false }));
  }, []);

  // ─── Receive and play audio via MSE streaming ────────────────
  useEffect(() => {
    // Listen for incoming panic audio (from the officer who triggered panic)
    const unsubAudio = subscribe('panic_audio', (msg: any) => {
      const data = msg.data || msg.payload || msg;

      if (data.end) {
        // Broadcast ended — destroy player, allow responder talk-back
        panicPlayerRef.current?.destroy();
        panicPlayerRef.current = null;
        setState(prev => ({ ...prev, isReceiving: false }));
        return;
      }

      if (data.audio && data.mimeType) {
        setState(prev => ({
          ...prev,
          isReceiving: true,
          panicSenderUserId: data.fromUserId || prev.panicSenderUserId,
        }));

        // Lazily create the stream player on first audio chunk
        if (!panicPlayerRef.current) {
          panicPlayerRef.current = new StreamPlayer();
          panicPlayerRef.current.init(data.mimeType);
        }
        panicPlayerRef.current.appendChunk(data.audio);
      }
    });

    // Listen for incoming audio responses (talk-back from responders to sender)
    const unsubResponse = subscribe('panic_audio_response', (msg: any) => {
      const data = msg.data || msg.payload || msg;
      if (data.audio && data.mimeType) {
        // Lazily create response player
        if (!responsePlayerRef.current) {
          responsePlayerRef.current = new StreamPlayer();
          responsePlayerRef.current.init(data.mimeType);
        }
        responsePlayerRef.current.appendChunk(data.audio);
      }
    });

    return () => {
      unsubAudio();
      unsubResponse();
      panicPlayerRef.current?.destroy();
      panicPlayerRef.current = null;
      responsePlayerRef.current?.destroy();
      responsePlayerRef.current = null;
    };
  }, [subscribe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (broadcastTimerRef.current) clearInterval(broadcastTimerRef.current);
      if (broadcastTimeoutRef.current) clearTimeout(broadcastTimeoutRef.current);
      panicPlayerRef.current?.destroy();
      responsePlayerRef.current?.destroy();
    };
  }, []);

  const setSenderUserId = useCallback((userId: number) => {
    setState(prev => ({ ...prev, panicSenderUserId: userId }));
  }, []);

  return {
    ...state,
    startBroadcast,
    stopBroadcast,
    startResponse,
    stopResponse,
    setSenderUserId,
  };
}
