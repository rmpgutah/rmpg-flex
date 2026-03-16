import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { StreamPlayer } from '../utils/StreamPlayer';
import { playRadioTone } from '../utils/radioTones';

// ============================================================
// RMPG Flex — Private Call Hook (Full-Duplex)
// Provides 1:1 voice calls between two users, phone-style.
// Both parties transmit and receive simultaneously.
//
// Audio flow: Mic -> MediaRecorder (200ms chunks) -> base64
//   -> WebSocket -> server relay -> StreamPlayer (partner only)
//
// Lifecycle:
//   1. Caller sends private_call_request(targetUserId)
//   2. Server notifies receiver with private_call_incoming
//   3. Receiver accepts/declines
//   4. On accept: both open mic, start streaming to each other
//   5. Either party can end the call
//   6. Server auto-declines after 30s if no answer
// ============================================================

export interface IncomingCall {
  callId: string;
  callerUserId: number;
  callerName: string;
}

export interface ActiveCall {
  callId: string;
  partnerUserId: number;
  partnerName: string;
}

export interface PrivateCallState {
  /** Incoming call waiting for accept/decline */
  incomingCall: IncomingCall | null;
  /** Currently active (connected) call */
  activeCall: ActiveCall | null;
  /** True if we're in a connected call */
  isInCall: boolean;
  /** True if we initiated a call and it's ringing */
  isRinging: boolean;
  /** Partner info for the ringing call */
  ringingTarget: { userId: number; name: string } | null;
  /** Call duration in seconds (live counter) */
  callDuration: number;
  /** Whether our mic is muted */
  isMuted: boolean;
  /** Error message (auto-clears after a few seconds) */
  error: string | null;
}

export function usePrivateCall() {
  const { send, subscribe, isConnected } = useWebSocket();
  const { user } = useAuth();

  const [state, setState] = useState<PrivateCallState>({
    incomingCall: null,
    activeCall: null,
    isInCall: false,
    isRinging: false,
    ringingTarget: null,
    callDuration: 0,
    isMuted: false,
    error: null,
  });

  // ── Refs ──────────────────────────────────────────────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<StreamPlayer | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref mirrors to avoid stale closures
  const isInCallRef = useRef(false);
  const isMutedRef = useRef(false);
  const activeCallRef = useRef<ActiveCall | null>(null);

  // ── Helpers ───────────────────────────────────────────────

  /** Set an auto-clearing error */
  const setError = useCallback((msg: string) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setState(prev => ({ ...prev, error: msg }));
    errorTimerRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, error: null }));
    }, 5000);
  }, []);

  /** Start the duration counter */
  const startDurationTimer = useCallback(() => {
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    setState(prev => ({ ...prev, callDuration: 0 }));
    durationTimerRef.current = setInterval(() => {
      setState(prev => ({ ...prev, callDuration: prev.callDuration + 1 }));
    }, 1000);
  }, []);

  /** Stop the duration counter */
  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  /** Open mic and start streaming audio to partner */
  const startAudioStream = useCallback(async () => {
    try {
      // Pre-warm audio playback for receiving partner's audio
      StreamPlayer.preWarm();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 48000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && isInCallRef.current && !isMutedRef.current) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1] || '';
            send({
              type: 'private_call_audio',
              data: { audio: base64, mimeType },
            });
          };
          reader.readAsDataURL(event.data);
        }
      };

      recorder.onerror = () => {
        setError('Microphone error — call audio interrupted.');
      };

      // Handle mic disconnection
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          setError('Microphone disconnected.');
        };
      }

      // 200ms chunks — same as radio for consistent latency
      recorder.start(200);
      console.log('[PrivateCall] Audio stream started, mimeType:', mimeType);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Microphone access denied';
      setError(
        message.includes('Permission denied')
          ? 'Microphone permission denied. Allow microphone access in browser settings.'
          : message
      );
    }
  }, [send, setError]);

  /** Stop mic capture and clean up audio resources */
  const stopAudioStream = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;

    // Destroy incoming audio player
    playerRef.current?.destroy();
    playerRef.current = null;
  }, []);

  // ── Actions ───────────────────────────────────────────────

  /** Initiate a private call to another user */
  const startCall = useCallback((targetUserId: number) => {
    if (isInCallRef.current || state.isRinging) {
      setError('Already in a call');
      return;
    }

    send({
      type: 'private_call_request',
      targetUserId,
    });

    // Play ring tone (we'll get ringing confirmation from server)
    playRadioTone('keyUpTone');
  }, [send, state.isRinging, setError]);

  /** Accept an incoming call */
  const acceptCall = useCallback((callId: string) => {
    send({
      type: 'private_call_accept',
      callId,
    });

    // Clear the incoming call UI immediately — server will send connected
    setState(prev => ({ ...prev, incomingCall: null }));
  }, [send]);

  /** Decline an incoming call */
  const declineCall = useCallback((callId: string) => {
    send({
      type: 'private_call_decline',
      callId,
    });

    setState(prev => ({ ...prev, incomingCall: null }));
  }, [send]);

  /** End the active call */
  const endCall = useCallback(() => {
    send({ type: 'private_call_end' });

    stopAudioStream();
    stopDurationTimer();

    isInCallRef.current = false;
    activeCallRef.current = null;

    setState(prev => ({
      ...prev,
      activeCall: null,
      isInCall: false,
      isRinging: false,
      ringingTarget: null,
      callDuration: 0,
      isMuted: false,
    }));
  }, [send, stopAudioStream, stopDurationTimer]);

  /** Toggle mute — stops sending audio but keeps receiving */
  const toggleMute = useCallback(() => {
    setState(prev => {
      const newMuted = !prev.isMuted;
      isMutedRef.current = newMuted;

      // Also mute/unmute the actual audio track for visual indicator
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(track => {
          track.enabled = !newMuted;
        });
      }

      return { ...prev, isMuted: newMuted };
    });
  }, []);

  // ── WebSocket Subscriptions ───────────────────────────────
  useEffect(() => {
    // Server confirms our call is ringing
    const unsubRinging = subscribe('private_call_ringing', (msg: any) => {
      const data = msg.data || msg;
      setState(prev => ({
        ...prev,
        isRinging: true,
        ringingTarget: { userId: data.targetUserId, name: data.targetName },
      }));
    });

    // Incoming call from another user
    const unsubIncoming = subscribe('private_call_incoming', (msg: any) => {
      const data = msg.data || msg;
      // Play incoming call tone
      playRadioTone('keyUpTone');

      setState(prev => ({
        ...prev,
        incomingCall: {
          callId: data.callId,
          callerUserId: data.callerUserId,
          callerName: data.callerName,
        },
      }));
    });

    // Call connected — both parties open mic
    const unsubConnected = subscribe('private_call_connected', (msg: any) => {
      const data = msg.data || msg;

      const callInfo: ActiveCall = {
        callId: data.callId,
        partnerUserId: data.partnerUserId,
        partnerName: data.partnerName,
      };

      isInCallRef.current = true;
      activeCallRef.current = callInfo;
      isMutedRef.current = false;

      setState(prev => ({
        ...prev,
        activeCall: callInfo,
        isInCall: true,
        isRinging: false,
        ringingTarget: null,
        incomingCall: null,
        isMuted: false,
      }));

      // Start audio stream and duration timer
      startAudioStream();
      startDurationTimer();

      // Confirmation tone
      playRadioTone('channelChange');
      console.log(`[PrivateCall] CONNECTED with ${data.partnerName}`);
    });

    // Call declined (by receiver or auto-timeout)
    const unsubDeclined = subscribe('private_call_declined', (msg: any) => {
      const data = msg.data || msg;

      setState(prev => ({
        ...prev,
        isRinging: false,
        ringingTarget: null,
        incomingCall: null,
      }));

      setError(data.reason || 'Call declined');
      playRadioTone('channelDeny');
    });

    // Call ended (by either party or disconnect)
    const unsubEnded = subscribe('private_call_ended', (msg: any) => {
      const data = msg.data || msg;

      stopAudioStream();
      stopDurationTimer();

      isInCallRef.current = false;
      activeCallRef.current = null;

      setState(prev => ({
        ...prev,
        activeCall: null,
        isInCall: false,
        isRinging: false,
        ringingTarget: null,
        callDuration: 0,
        isMuted: false,
      }));

      if (data.reason) {
        setError(data.reason);
      }

      // End-of-call tone
      playRadioTone('receiveEnd');
      console.log(`[PrivateCall] ENDED (${data.duration || 0}s)`);
    });

    // Error from server
    const unsubError = subscribe('private_call_error', (msg: any) => {
      const data = msg.data || msg;
      setError(data.error || 'Call error');
      setState(prev => ({
        ...prev,
        isRinging: false,
        ringingTarget: null,
      }));
    });

    // Incoming audio chunks from partner
    const unsubAudio = subscribe('private_call_audio', (msg: any) => {
      const data = msg.data || msg;
      if (!data.audio || !data.mimeType) return;

      // Lazily create stream player on first chunk
      if (!playerRef.current) {
        playerRef.current = new StreamPlayer();
        playerRef.current.init(data.mimeType);
      }
      playerRef.current.appendChunk(data.audio);
    });

    return () => {
      unsubRinging();
      unsubIncoming();
      unsubConnected();
      unsubDeclined();
      unsubEnded();
      unsubError();
      unsubAudio();
    };
  }, [subscribe, startAudioStream, startDurationTimer, stopAudioStream, stopDurationTimer, setError]);

  // ── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      if (isInCallRef.current) {
        // Tell server we're ending the call
        send({ type: 'private_call_end' });
      }
      // Stop all audio
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      playerRef.current?.destroy();

      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);

      isInCallRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── End call on WS disconnect ─────────────────────────────
  useEffect(() => {
    if (!isConnected && isInCallRef.current) {
      stopAudioStream();
      stopDurationTimer();
      isInCallRef.current = false;
      activeCallRef.current = null;

      setState(prev => ({
        ...prev,
        activeCall: null,
        isInCall: false,
        isRinging: false,
        ringingTarget: null,
        incomingCall: null,
        callDuration: 0,
        isMuted: false,
        error: 'Connection lost — call ended',
      }));
    }
  }, [isConnected, stopAudioStream, stopDurationTimer]);

  return {
    ...state,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
  };
}
