import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from '../context/WebSocketContext';

// ============================================================
// RMPG Flex — Panic Audio Hook
// Opens a live mic for 15 seconds when panic is activated.
// Other users hear the audio in real-time. After 15 seconds,
// responders can talk back to the panic sender.
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const broadcastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const broadcastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ─── Receive and play audio chunks ──────────────────────────
  useEffect(() => {
    // Initialize AudioContext lazily
    const getAudioCtx = () => {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContext();
      }
      return audioContextRef.current;
    };

    const playAudioChunk = async (base64: string, mimeType: string) => {
      try {
        const ctx = getAudioCtx();
        if (ctx.state === 'suspended') await ctx.resume();

        // Decode base64 to ArrayBuffer
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        // Create blob and decode
        const blob = new Blob([bytes], { type: mimeType });
        const arrayBuffer = await blob.arrayBuffer();

        try {
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.start(0);
        } catch {
          // Some chunks may not be decodable standalone — that's OK
        }
      } catch {
        // Audio decode error — non-critical
      }
    };

    // Listen for incoming panic audio
    const unsubAudio = subscribe('panic_audio', (msg: any) => {
      const data = msg.data || msg.payload || msg;

      if (data.end) {
        // Broadcast ended — allow responder talk-back
        setState(prev => ({ ...prev, isReceiving: false }));
        return;
      }

      if (data.audio && data.mimeType) {
        setState(prev => ({
          ...prev,
          isReceiving: true,
          panicSenderUserId: data.fromUserId || prev.panicSenderUserId,
        }));
        playAudioChunk(data.audio, data.mimeType);
      }
    });

    // Listen for incoming audio responses (for the panic sender)
    const unsubResponse = subscribe('panic_audio_response', (msg: any) => {
      const data = msg.data || msg.payload || msg;
      if (data.audio && data.mimeType) {
        playAudioChunk(data.audio, data.mimeType);
      }
    });

    return () => {
      unsubAudio();
      unsubResponse();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
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
