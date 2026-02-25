import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { StreamPlayer } from '../utils/StreamPlayer';

// ============================================================
// RMPG Flex — Push-to-Talk Radio Hook
// Provides channel-scoped two-way voice communication.
// One user can transmit per channel at a time (server-enforced).
// Audio streams via MediaRecorder → base64 → WebSocket → MSE.
//
// Requires HTTPS — navigator.mediaDevices is undefined on HTTP.
// ============================================================

export interface RadioUser {
  userId: number;
  username: string;
  fullName: string;
  role: string;
}

export interface ActiveSpeaker {
  userId: number;
  username: string;
  fullName: string;
  role?: string;
}

export interface TransmissionEntry {
  id: string;
  userId: number;
  username: string;
  fullName: string;
  channel: string;
  startedAt: number;
  duration: number; // seconds
}

export interface RadioState {
  currentChannel: string | null;
  isTransmitting: boolean;
  activeSpeaker: ActiveSpeaker | null;
  channelUsers: RadioUser[];
  transmissionLog: TransmissionEntry[];
  channelBusy: boolean;
  error: string | null;
  /** True if the browser supports getUserMedia (requires HTTPS) */
  micSupported: boolean;
}

export const RADIO_CHANNELS = [
  { id: 'dispatch', label: 'DISPATCH', freq: '155.010' },
  { id: 'tac-1',    label: 'TAC-1',    freq: '155.475' },
  { id: 'tac-2',    label: 'TAC-2',    freq: '155.730' },
  { id: 'tac-3',    label: 'TAC-3',    freq: '156.090' },
  { id: 'patrol',   label: 'PATROL',   freq: '156.240' },
  { id: 'admin',    label: 'ADMIN',    freq: '158.985' },
];

const MAX_LOG_ENTRIES = 50;

/** Check if the browser can access the microphone (requires secure context) */
function canAccessMic(): boolean {
  return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
}

// ── Hook ─────────────────────────────────────────────────────

export function useRadio() {
  const { send, subscribe, isConnected } = useWebSocket();
  const { user } = useAuth();

  const [state, setState] = useState<RadioState>({
    currentChannel: null,
    isTransmitting: false,
    activeSpeaker: null,
    channelUsers: [],
    transmissionLog: [],
    channelBusy: false,
    error: null,
    micSupported: canAccessMic(),
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<StreamPlayer | null>(null);
  const transmitStartTimeRef = useRef<number>(0);

  // Ref mirrors isTransmitting to avoid stale closures in event handlers.
  // When the Space key fires keyup, the callback closure may hold an old
  // `state.isTransmitting` value — the ref is always current.
  const isTransmittingRef = useRef(false);

  // ─── Join a radio channel ───────────────────────────────────
  const joinChannel = useCallback((channelId: string) => {
    // Leave current channel first (server handles this too, but be explicit)
    if (state.currentChannel) {
      send({ type: 'radio_channel_leave' });
    }

    setState(prev => ({
      ...prev,
      currentChannel: channelId,
      activeSpeaker: null,
      channelUsers: [],
      channelBusy: false,
      error: null,
    }));

    send({
      type: 'radio_channel_join',
      radioChannel: channelId,
    });
  }, [send, state.currentChannel]);

  // ─── Leave the current radio channel ────────────────────────
  const leaveChannel = useCallback(() => {
    // Stop transmitting if active
    if (isTransmittingRef.current) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
      isTransmittingRef.current = false;
      send({ type: 'radio_transmit_end' });
    }

    // Stop playback
    playerRef.current?.destroy();
    playerRef.current = null;

    send({ type: 'radio_channel_leave' });

    setState(prev => ({
      ...prev,
      currentChannel: null,
      isTransmitting: false,
      activeSpeaker: null,
      channelUsers: [],
      channelBusy: false,
    }));
  }, [send]);

  // ─── Start transmitting (PTT key-down) ─────────────────────
  const startTransmit = useCallback(async () => {
    if (!state.currentChannel) return;
    if (isTransmittingRef.current) return;

    // ── Secure-context guard ──────────────────────────────
    // navigator.mediaDevices is undefined on HTTP origins.
    if (!canAccessMic()) {
      setState(prev => ({
        ...prev,
        error: 'Microphone requires a secure connection (HTTPS). Connect via https:// to use radio.',
        micSupported: false,
      }));
      return;
    }

    // Don't even try if someone else is already talking
    if (state.activeSpeaker && state.activeSpeaker.userId !== Number(user?.id)) {
      setState(prev => ({ ...prev, channelBusy: true }));
      return;
    }

    try {
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
        audioBitsPerSecond: 16000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            send({
              type: 'radio_audio',
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

      // 500ms chunks for near-real-time streaming
      recorder.start(500);
      transmitStartTimeRef.current = Date.now();
      isTransmittingRef.current = true;

      // Tell the server we're keying up
      send({ type: 'radio_transmit_start' });

      setState(prev => ({
        ...prev,
        isTransmitting: true,
        channelBusy: false,
        error: null,
      }));
    } catch (err) {
      // Clean up anything partially initialized
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
      isTransmittingRef.current = false;

      const message = err instanceof Error ? err.message : 'Microphone access denied';
      setState(prev => ({
        ...prev,
        isTransmitting: false,
        error: message.includes('Permission denied')
          ? 'Microphone permission denied. Allow microphone access in browser settings.'
          : message,
      }));
    }
  }, [send, state.currentChannel, state.activeSpeaker, user?.id]);

  // ─── Stop transmitting (PTT key-up) ────────────────────────
  const stopTransmit = useCallback(() => {
    // Guard: only act if we are actually transmitting (prevents phantom stops)
    if (!isTransmittingRef.current) return;
    isTransmittingRef.current = false;

    // Release mic
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;

    // Tell server we're done
    send({ type: 'radio_transmit_end' });

    // Calculate duration (only valid because guard above ensures we started)
    const duration = Math.max(0, Math.round((Date.now() - transmitStartTimeRef.current) / 1000));
    const userName = user
      ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'You'
      : 'You';

    setState(prev => ({
      ...prev,
      isTransmitting: false,
      transmissionLog: [
        {
          id: `tx-${Date.now()}`,
          userId: Number(user?.id || 0),
          username: user?.username || 'You',
          fullName: userName,
          channel: prev.currentChannel || '',
          startedAt: transmitStartTimeRef.current,
          duration,
        },
        ...prev.transmissionLog,
      ].slice(0, MAX_LOG_ENTRIES),
    }));
  }, [send, user]);

  // ─── WebSocket subscriptions ────────────────────────────────
  useEffect(() => {
    // Channel state (sent when we join a channel)
    const unsubState = subscribe('radio_channel_state', (msg: any) => {
      const data = msg.data || msg;
      setState(prev => ({
        ...prev,
        channelUsers: data.users || [],
        activeSpeaker: data.activeSpeaker || null,
        channelBusy: !!data.activeSpeaker,
      }));
    });

    // User joined the channel
    const unsubJoin = subscribe('radio_channel_join', (msg: any) => {
      const data = msg.data || msg;
      if (!data.userId) return;
      setState(prev => {
        // Avoid duplicates
        if (prev.channelUsers.some(u => u.userId === data.userId)) return prev;
        return {
          ...prev,
          channelUsers: [...prev.channelUsers, {
            userId: data.userId,
            username: data.username || 'Unknown',
            fullName: data.fullName || data.username || 'Unknown',
            role: data.role || 'unknown',
          }],
        };
      });
    });

    // User left the channel
    const unsubLeave = subscribe('radio_channel_leave', (msg: any) => {
      const data = msg.data || msg;
      if (!data.userId) return;
      setState(prev => ({
        ...prev,
        channelUsers: prev.channelUsers.filter(u => u.userId !== data.userId),
        // Clear active speaker if it was this user
        activeSpeaker: prev.activeSpeaker?.userId === data.userId ? null : prev.activeSpeaker,
      }));
    });

    // Someone started transmitting
    const unsubTxStart = subscribe('radio_transmit_start', (msg: any) => {
      const data = msg.data || msg;

      // Server denied our request (channel busy)
      if (data.denied) {
        // Clean up our mic if we started one
        if (isTransmittingRef.current) {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }
          mediaRecorderRef.current = null;
          isTransmittingRef.current = false;
        }
        setState(prev => ({ ...prev, channelBusy: true, isTransmitting: false }));
        return;
      }

      setState(prev => ({
        ...prev,
        activeSpeaker: {
          userId: data.userId,
          username: data.username || 'Unknown',
          fullName: data.fullName || data.username || 'Unknown',
          role: data.role,
        },
        channelBusy: true,
      }));
    });

    // Someone stopped transmitting
    const unsubTxEnd = subscribe('radio_transmit_end', (msg: any) => {
      const data = msg.data || msg;

      // Destroy the player when transmission ends
      playerRef.current?.destroy();
      playerRef.current = null;

      // Add remote transmission to log
      if (data.userId) {
        setState(prev => {
          // Only log if it's a different user (we already log our own in stopTransmit)
          if (data.userId === Number(user?.id)) {
            return { ...prev, activeSpeaker: null, channelBusy: false };
          }
          return {
            ...prev,
            activeSpeaker: null,
            channelBusy: false,
            transmissionLog: [
              {
                id: `rx-${Date.now()}`,
                userId: data.userId,
                username: data.username || 'Unknown',
                fullName: data.fullName || data.username || 'Unknown',
                channel: prev.currentChannel || '',
                startedAt: Date.now(),
                duration: data.duration || 0,
              },
              ...prev.transmissionLog,
            ].slice(0, MAX_LOG_ENTRIES),
          };
        });
      } else {
        setState(prev => ({ ...prev, activeSpeaker: null, channelBusy: false }));
      }
    });

    // Incoming audio chunks
    const unsubAudio = subscribe('radio_audio', (msg: any) => {
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
      unsubState();
      unsubJoin();
      unsubLeave();
      unsubTxStart();
      unsubTxEnd();
      unsubAudio();
    };
  }, [subscribe, user?.id]);

  // ─── Cleanup on unmount ──────────────────────────────────────
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      playerRef.current?.destroy();
      isTransmittingRef.current = false;
    };
  }, []);

  // ─── Leave channel on disconnect ─────────────────────────────
  useEffect(() => {
    if (!isConnected && state.currentChannel) {
      // Clean up media
      if (isTransmittingRef.current) {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        mediaRecorderRef.current = null;
        isTransmittingRef.current = false;
      }
      playerRef.current?.destroy();
      playerRef.current = null;

      setState(prev => ({
        ...prev,
        currentChannel: null,
        isTransmitting: false,
        activeSpeaker: null,
        channelUsers: [],
        channelBusy: false,
      }));
    }
  }, [isConnected, state.currentChannel]);

  return {
    ...state,
    joinChannel,
    leaveChannel,
    startTransmit,
    stopTransmit,
    isConnected,
  };
}
