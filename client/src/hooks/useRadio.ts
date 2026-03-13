import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { StreamPlayer } from '../utils/StreamPlayer';
import { playRadioTone, playRadioToneAsync } from '../utils/radioTones';

// ============================================================
// RMPG Flex — Push-to-Talk Radio Hook
// Provides channel-scoped two-way voice communication.
// One user can transmit per channel at a time (server-enforced).
// Audio streams via MediaRecorder → base64 → WebSocket → MSE.
//
// ── MANDATORY AUDIO RULE ──────────────────────────────────
// When PTT is pressed, the mic MUST be open and all audible
// sounds picked up by the device are streamed to every other
// active device on the channel in real time. The mic stays
// hot for the full PTT duration — no gaps, no silent frames.
// If the mic or recorder fails mid-TX, transmission is
// immediately terminated and the channel is released.
// Audio flows: Mic → MediaRecorder (200ms chunks) → base64
//   → WebSocket → server broadcast → MSE StreamPlayer.
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
  transcript?: string;
  hasAudio?: boolean;
}

export interface PanicRadioAlert {
  user_name: string;
  badge_number?: string;
  location_address?: string;
  unit_call_sign?: string;
  timestamp: number;
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
  /** Active panic alert being broadcast through radio */
  panicAlert: PanicRadioAlert | null;
  /** Live transcript text while transmitting (interim + final) */
  liveTranscript: string;
}

/** Hardcoded fallback channels used before API fetch resolves */
export const DEFAULT_RADIO_CHANNELS: RadioChannelDef[] = [
  { id: 'dispatch', label: 'DISPATCH', freq: '155.010' },
  { id: 'tac-1',    label: 'TAC-1',    freq: '155.475' },
  { id: 'tac-2',    label: 'TAC-2',    freq: '155.730' },
  { id: 'tac-3',    label: 'TAC-3',    freq: '156.090' },
  { id: 'patrol',   label: 'PATROL',   freq: '156.240' },
  { id: 'admin',    label: 'ADMIN',    freq: '158.985' },
];

export interface RadioChannelDef {
  id: string;
  label: string;
  freq: string;
}

/**
 * Shared mutable cache — populated once by the first useRadio() mount,
 * then reused by every component that reads RADIO_CHANNELS.
 */
let _cachedChannels: RadioChannelDef[] = DEFAULT_RADIO_CHANNELS;
let _fetchPromise: Promise<void> | null = null;

/** Fetch radio channels from backend and update shared cache */
async function loadRadioChannels(): Promise<void> {
  try {
    const token = localStorage.getItem('rmpg_token');
    const res = await fetch('/api/comms/radio-channels', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        _cachedChannels = data.map((ch: any) => ({
          id: ch.id,
          label: ch.label || ch.id.toUpperCase(),
          freq: ch.freq || '0.000',
        }));
      }
    }
  } catch { /* keep defaults */ }
}

/** Get current radio channels (may be default until API responds) */
export function getRadioChannels(): RadioChannelDef[] {
  return _cachedChannels;
}

/** Trigger a single background fetch (deduped) */
function ensureChannelsLoaded(): void {
  if (!_fetchPromise) {
    _fetchPromise = loadRadioChannels();
  }
}

/** @deprecated — use getRadioChannels() for dynamic channels. Kept for backward compat. */
export const RADIO_CHANNELS = DEFAULT_RADIO_CHANNELS;

const MAX_LOG_ENTRIES = 50;

/** Check if the browser can access the microphone (requires secure context) */
function canAccessMic(): boolean {
  return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
}

// ── Hook ─────────────────────────────────────────────────────

export function useRadio() {
  const { send, subscribe, isConnected } = useWebSocket();
  const { user } = useAuth();

  // Kick off channel fetch once (shared promise, only one in-flight)
  const [radioChannels, setRadioChannels] = useState<RadioChannelDef[]>(_cachedChannels);
  useEffect(() => {
    ensureChannelsLoaded();
    // Poll the cache briefly so the UI updates once the fetch resolves
    const t = setInterval(() => {
      if (_cachedChannels !== radioChannels) {
        setRadioChannels(_cachedChannels);
        clearInterval(t);
      }
    }, 200);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [state, setState] = useState<RadioState>({
    currentChannel: null,
    isTransmitting: false,
    activeSpeaker: null,
    channelUsers: [],
    transmissionLog: [],
    channelBusy: false,
    error: null,
    micSupported: canAccessMic(),
    liveTranscript: '',
    panicAlert: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<StreamPlayer | null>(null);
  const transmitStartTimeRef = useRef<number>(0);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>('');

  // Ref mirrors isTransmitting to avoid stale closures in event handlers.
  // When the Space key fires keyup, the callback closure may hold an old
  // `state.isTransmitting` value — the ref is always current.
  const isTransmittingRef = useRef(false);

  // Release delay timer — keeps the transmitter keyed for 500ms after PTT
  // release so the final syllable isn't clipped (standard radio "hang time").
  // If the user re-presses PTT within the window, the timer is cancelled
  // and transmission continues seamlessly.
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref mirrors user ID for stale-closure-safe comparisons in WS subscriptions
  const userIdRef = useRef<number>(0);
  useEffect(() => { userIdRef.current = Number(user?.id || 0); }, [user?.id]);

  // Ref mirrors currentChannel for stale-closure-safe access in joinChannel
  const currentChannelRef = useRef<string | null>(null);
  useEffect(() => { currentChannelRef.current = state.currentChannel; }, [state.currentChannel]);

  // ─── Join a radio channel ───────────────────────────────────
  const joinChannel = useCallback((channelId: string) => {
    // Leave current channel first (uses ref for stale-closure safety)
    if (currentChannelRef.current) {
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

    // Pre-warm audio playback (user gesture context — unlocks AudioContext)
    StreamPlayer.preWarm();

    // APX channel-change confirmation tone
    playRadioTone('channelChange');
  }, [send]);

  // ─── Leave the current radio channel ────────────────────────
  const leaveChannel = useCallback(() => {
    // Cancel any pending release delay — leaving channel is immediate
    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }

    // Stop transmitting if active
    if (isTransmittingRef.current) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ok */ }
        recognitionRef.current = null;
      }
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

    // If the user re-presses PTT during the 500ms release delay,
    // cancel the pending stop — transmission continues seamlessly.
    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
      // Already transmitting — just resume (no new mic/recorder needed)
      if (isTransmittingRef.current) return;
    }

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
      playRadioTone('channelDeny');
      setState(prev => ({ ...prev, channelBusy: true }));
      return;
    }

    try {
      // APX PTT chirp — plays through speakers BEFORE mic opens to prevent feedback
      await playRadioToneAsync('pttChirp');

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
        audioBitsPerSecond: 48000, // Voice-optimized: clear speech over Opus codec
      });
      mediaRecorderRef.current = recorder;

      let chunkCount = 0;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunkCount++;
          if (chunkCount === 1) {
            console.log('[Radio TX] First audio chunk captured:', event.data.size, 'bytes, mimeType:', mimeType);
          }
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            if (chunkCount <= 2) {
              console.log('[Radio TX] Sending chunk #' + chunkCount + ', base64 length:', base64?.length || 0);
            }
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

      // ── Mandatory audio protection ──────────────────────────
      // If the MediaRecorder errors or the mic track ends unexpectedly,
      // force-stop the transmission so the channel isn't held by silence.
      recorder.onerror = () => {
        if (isTransmittingRef.current) {
          stopTransmitFnRef.current();
          setState(prev => ({ ...prev, error: 'Microphone error — transmission ended.' }));
        }
      };
      // Browser can end mic track if permission is revoked or device lost
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          if (isTransmittingRef.current) {
            stopTransmitFnRef.current();
            setState(prev => ({ ...prev, error: 'Microphone disconnected — transmission ended.' }));
          }
        };
      }

      // ── CRITICAL: Tell server BEFORE recorder starts ───────
      // The server's relayRadioAudio() drops all audio unless
      // activeTransmitters has this client registered. We MUST
      // send radio_transmit_start before recorder.start() so the
      // server is ready before the first audio chunk arrives.
      send({ type: 'radio_transmit_start' });

      transmitStartTimeRef.current = Date.now();
      isTransmittingRef.current = true;

      // 200ms chunks — responsive near-real-time streaming (5 chunks/sec)
      recorder.start(200);

      // ── Speech-to-text (Chrome Web Speech API) ──────────
      transcriptRef.current = '';
      try {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';
          recognition.maxAlternatives = 1;

          let finalText = '';
          recognition.onresult = (event: any) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const result = event.results[i];
              if (result.isFinal) {
                finalText += result[0].transcript + ' ';
              } else {
                interim += result[0].transcript;
              }
            }
            transcriptRef.current = (finalText + interim).trim();
            setState(prev => ({ ...prev, liveTranscript: transcriptRef.current }));
          };

          recognition.onerror = () => { /* Speech recognition is best-effort */ };
          recognition.start();
          recognitionRef.current = recognition;
        }
      } catch { /* Speech recognition not supported — radio still works */ }

      setState(prev => ({
        ...prev,
        isTransmitting: true,
        channelBusy: false,
        error: null,
        liveTranscript: '',
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
  // Uses a 500ms "hang time" delay — the mic stays hot for half a
  // second after PTT release so the last syllable isn't clipped.
  // If the user re-presses PTT within the window, startTransmit
  // cancels the timer and transmission continues seamlessly.

  /** Immediate hard stop — tears down mic, recorder, and notifies server */
  const performStop = useCallback(() => {
    releaseTimerRef.current = null;

    // Guard: only act if we are actually transmitting (prevents phantom stops)
    if (!isTransmittingRef.current) return;
    isTransmittingRef.current = false;

    // Stop speech recognition and capture final transcript
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    }
    const transcript = transcriptRef.current || undefined;

    // Calculate duration (only valid because guard above ensures we started)
    const duration = Math.max(0, Math.round((Date.now() - transmitStartTimeRef.current) / 1000));

    // Helper: send the transmit_end signal to the server
    const sendEnd = () => {
      send({
        type: 'radio_transmit_end',
        data: { transcript, duration },
      });
    };

    // Stop recorder — wait for final ondataavailable + FileReader before sending end
    // The recorder's 'stop' event fires AFTER the final ondataavailable, then we
    // add 150ms for the FileReader base64 conversion to complete and send the chunk.
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      const recorder = mediaRecorderRef.current;
      recorder.addEventListener('stop', () => setTimeout(sendEnd, 150), { once: true });
      recorder.stop();
    } else {
      sendEnd();
    }

    // Release mic tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;

    // APX roger beep — confirms transmission ended
    playRadioTone('rogerBeep');

    const userName = user
      ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'You'
      : 'You';

    setState(prev => ({
      ...prev,
      isTransmitting: false,
      liveTranscript: '',
      transmissionLog: [
        {
          id: `tx-${Date.now()}`,
          userId: Number(user?.id || 0),
          username: user?.username || 'You',
          fullName: userName,
          channel: prev.currentChannel || '',
          startedAt: transmitStartTimeRef.current,
          duration,
          transcript,
          hasAudio: true,
        },
        ...prev.transmissionLog,
      ].slice(0, MAX_LOG_ENTRIES),
    }));
  }, [send, user]);

  /** Public stop — called on PTT release. Delays 500ms before actual stop. */
  const stopTransmit = useCallback(() => {
    if (!isTransmittingRef.current) return;
    // If a release timer is already pending, don't stack another
    if (releaseTimerRef.current) return;

    releaseTimerRef.current = setTimeout(() => {
      performStop();
    }, 500);
  }, [performStop]);

  // Ref to latest performStop — used by MediaRecorder/track error handlers.
  // Error handlers need IMMEDIATE stop (no 500ms delay) since the mic/recorder
  // is already broken. Using performStop instead of stopTransmit bypasses the
  // release delay.
  const stopTransmitFnRef = useRef(performStop);
  useEffect(() => { stopTransmitFnRef.current = performStop; }, [performStop]);

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
        playRadioTone('channelDeny');
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

      // APX receive-start chirp for remote transmissions (not our own)
      if (data.userId !== userIdRef.current) {
        playRadioTone('receiveStart');
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

      // APX receive-end chirp for remote transmissions (not our own)
      if (data.userId && data.userId !== userIdRef.current) {
        playRadioTone('receiveEnd');
      }

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
                transcript: data.transcript || undefined,
                hasAudio: data.hasAudio || false,
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
    let rxChunkCount = 0;
    const unsubAudio = subscribe('radio_audio', (msg: any) => {
      const data = msg.data || msg;
      if (!data.audio || !data.mimeType) {
        console.warn('[Radio RX] Received audio message with missing audio/mimeType:', Object.keys(data));
        return;
      }

      rxChunkCount++;
      if (rxChunkCount <= 2) {
        console.log('[Radio RX] Chunk #' + rxChunkCount + ' from', data.fromUser || 'unknown',
          '| base64 length:', data.audio?.length || 0, '| mimeType:', data.mimeType);
      }

      // Lazily create stream player on first chunk
      if (!playerRef.current) {
        console.log('[Radio RX] Creating StreamPlayer for', data.mimeType);
        playerRef.current = new StreamPlayer();
        playerRef.current.init(data.mimeType);
      }
      playerRef.current.appendChunk(data.audio);
    });

    // ── Panic alert integration ───────────────────────────────
    // When a panic alert is broadcast, play the emergency warble
    // on the radio and log it as an EMERGENCY entry in the TX log.
    const panicPlayerRef: { current: StreamPlayer | null } = { current: null };
    let panicDismissTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubPanic = subscribe('panic_alert', (msg: any) => {
      const data = msg.data || msg;
      // Play emergency warble through radio
      playRadioTone('panicWarble');

      // Set panic alert state (for radio page banner) and add log entry
      const alertData: PanicRadioAlert = {
        user_name: data.user_name || 'Unknown',
        badge_number: data.badge_number,
        location_address: data.location_address,
        unit_call_sign: data.unit_call_sign,
        timestamp: Date.now(),
      };

      setState(prev => ({
        ...prev,
        panicAlert: alertData,
        transmissionLog: [
          {
            id: `panic-${Date.now()}`,
            userId: data.user_id || 0,
            username: data.user_name || 'PANIC',
            fullName: `⚠ EMERGENCY: ${data.user_name || 'Unknown'}`,
            channel: 'ALL',
            startedAt: Date.now(),
            duration: 0,
            transcript: `PANIC ALERT — ${data.user_name || 'Unknown'}${data.badge_number ? ` (Badge: ${data.badge_number})` : ''}${data.location_address ? ' at ' + data.location_address : ''}`,
          },
          ...prev.transmissionLog,
        ].slice(0, MAX_LOG_ENTRIES),
      }));

      // Auto-dismiss panic banner after 30 seconds (tracked for cleanup)
      if (panicDismissTimer) clearTimeout(panicDismissTimer);
      panicDismissTimer = setTimeout(() => {
        setState(prev => prev.panicAlert === alertData ? { ...prev, panicAlert: null } : prev);
      }, 30000);
    });

    // Stream panic sender's live mic audio through the radio speaker
    const unsubPanicAudio = subscribe('panic_audio', (msg: any) => {
      const data = msg.data || msg;
      if (!data.audio || !data.mimeType) return;
      // Create a dedicated panic stream player (separate from channel audio)
      if (!panicPlayerRef.current) {
        panicPlayerRef.current = new StreamPlayer();
        panicPlayerRef.current.init(data.mimeType);
      }
      panicPlayerRef.current.appendChunk(data.audio);
    });

    return () => {
      unsubState();
      unsubJoin();
      unsubLeave();
      unsubTxStart();
      unsubTxEnd();
      unsubAudio();
      unsubPanic();
      unsubPanicAudio();
      panicPlayerRef.current?.destroy();
      if (panicDismissTimer) clearTimeout(panicDismissTimer);
    };
  }, [subscribe, user?.id]);

  // ─── Cleanup on unmount ──────────────────────────────────────
  useEffect(() => {
    return () => {
      // Cancel any pending release delay
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ok */ }
        recognitionRef.current = null;
      }
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
      // Cancel release delay
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
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
    radioChannels,
    joinChannel,
    leaveChannel,
    startTransmit,
    stopTransmit,
    isConnected,
  };
}
