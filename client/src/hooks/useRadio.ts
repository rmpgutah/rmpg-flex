import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { StreamPlayer } from '../utils/StreamPlayer';
import { playRadioTone, playRadioToneAsync, createRadioStatic, playLoopingTone } from '../utils/radioTones';
import { getRadioAudioBus, getRadioAudioContext } from '../utils/radioAudioBus';
import { createRadioFxChain } from '../utils/radioFxChain';

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
  /** Live transcript text while transmitting (interim + final) */
  liveTranscript: string;

  // ── Volume / FX (Phase 1) ──
  masterVolume: number;
  isMuted: boolean;
  fxEnabled: boolean;

  // ── Signal Strength (Phase 5) ──
  signalLatency: number;   // ms
  signalBars: number;      // 1-5
  signalLabel: string;     // STRONG / GOOD / FAIR / WEAK / LOST
  signalColor: string;     // color hex

  // ── Emergency (Phase 4) ──
  emergencyActive: boolean;
  emergencyUser: { userId: number; fullName: string; latitude?: number; longitude?: number } | null;

  // ── Radio Check / Selcall (Phase 6) ──
  radioCheckResponses: { userId: number; fullName: string; ackAt: number }[];
  selcallAlert: { fromUserId: number; fromFullName: string } | null;
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

  // Initialize audio bus to read saved volume/mute/FX state
  const busRef = useRef(getRadioAudioBus());

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
    // Volume / FX
    masterVolume: busRef.current.getMasterVolume(),
    isMuted: busRef.current.isMuted,
    fxEnabled: busRef.current.isFxEnabled(),
    // Signal strength
    signalLatency: 0,
    signalBars: 5,
    signalLabel: 'STRONG',
    signalColor: '#33ff33',
    // Emergency
    emergencyActive: false,
    emergencyUser: null,
    // Radio check / selcall
    radioCheckResponses: [],
    selcallAlert: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<StreamPlayer | null>(null);
  const transmitStartTimeRef = useRef<number>(0);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>('');

  // TX FX chain — processes mic audio through radio DSP before encoding
  const txFxChainRef = useRef<{ input: GainNode; output: GainNode; enabled: boolean; toggle(): void; destroy(): void } | null>(null);
  const txMediaStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // Signal strength ping/pong
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingStartRef = useRef<number>(0);

  // Emergency
  const emergencyToneRef = useRef<{ stop: () => void } | null>(null);
  const emergencyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selcall
  const selcallToneRef = useRef<{ stop: () => void } | null>(null);

  // Background radio static — creates ambient radio hiss when on a channel
  const radioStaticRef = useRef(createRadioStatic());

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

    // Pre-warm audio playback (user gesture context — unlocks AudioContext)
    StreamPlayer.preWarm();

    // APX channel-change confirmation tone
    playRadioTone('channelChange');

    // Start background radio static hiss
    radioStaticRef.current.start();
  }, [send, state.currentChannel]);

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

    // Stop background radio static
    radioStaticRef.current.stop();

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

      // ── TX FX Chain: Route mic through radio DSP before encoding ──
      // Path: mic → MediaStreamSource → FxChain → MediaStreamDestination → MediaRecorder
      // This gives transmitted audio the authentic radio character.
      let recordingStream = stream;
      try {
        const bus = busRef.current;
        if (bus.isFxEnabled()) {
          const ctx = bus.ctx;
          const micSource = ctx.createMediaStreamSource(stream);
          const txFx = createRadioFxChain(ctx);
          txFxChainRef.current = txFx;
          const dest = ctx.createMediaStreamDestination();
          txMediaStreamDestRef.current = dest;

          micSource.connect(txFx.input);
          txFx.output.connect(dest);

          recordingStream = dest.stream;
          console.log('[Radio TX] FX chain active on mic');
        }
      } catch (fxErr) {
        console.warn('[Radio TX] FX chain setup failed, using raw mic:', fxErr);
        // Fallback: record the raw mic stream
        recordingStream = stream;
      }

      const recorder = new MediaRecorder(recordingStream, {
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

    // Release mic
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;

    // Clean up TX FX chain
    if (txFxChainRef.current) {
      txFxChainRef.current.destroy();
      txFxChainRef.current = null;
    }
    txMediaStreamDestRef.current = null;

    // Calculate duration (only valid because guard above ensures we started)
    const duration = Math.max(0, Math.round((Date.now() - transmitStartTimeRef.current) / 1000));

    // Tell server we're done — include transcript + duration for DB storage
    send({
      type: 'radio_transmit_end',
      data: { transcript, duration },
    });

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
        playRadioTone('squelchOpen');
        setTimeout(() => playRadioTone('receiveStart'), 90);
        // Increase static volume during incoming TX to simulate open squelch
        radioStaticRef.current.setVolume(0.04);
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

      // APX receive-end chirp + squelch tail for remote transmissions
      if (data.userId && data.userId !== userIdRef.current) {
        playRadioTone('receiveEnd');
        setTimeout(() => playRadioTone('squelchClose'), 60);
        // Return static to idle level
        radioStaticRef.current.setVolume(0.015);
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

      radioStaticRef.current.stop();

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

  // ─── Volume / Mute / FX controls ────────────────────────────
  const setMasterVolume = useCallback((v: number) => {
    busRef.current.setMasterVolume(v);
    setState(prev => ({ ...prev, masterVolume: v }));
  }, []);

  const toggleMute = useCallback(() => {
    const newMuted = busRef.current.toggleMute();
    setState(prev => ({ ...prev, isMuted: newMuted }));
    return newMuted;
  }, []);

  const toggleFx = useCallback(() => {
    const newEnabled = busRef.current.toggleFx();
    setState(prev => ({ ...prev, fxEnabled: newEnabled }));
    return newEnabled;
  }, []);

  // ─── Signal Strength (Ping/Pong Latency) ──────────────────
  const getSignalQuality = useCallback((latencyMs: number) => {
    if (latencyMs < 100)  return { bars: 5, label: 'STRONG', color: '#33ff33' };
    if (latencyMs < 250)  return { bars: 4, label: 'GOOD',   color: '#33ff33' };
    if (latencyMs < 500)  return { bars: 3, label: 'FAIR',   color: '#d4a017' };
    if (latencyMs < 1000) return { bars: 2, label: 'WEAK',   color: '#ff8800' };
    return { bars: 1, label: 'LOST', color: '#ef4444' };
  }, []);

  // Start ping interval when on a channel
  useEffect(() => {
    if (!state.currentChannel || !isConnected) {
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      return;
    }

    // Send ping every 5 seconds
    pingTimerRef.current = setInterval(() => {
      pingStartRef.current = performance.now();
      send({ type: 'ping' });
    }, 5000);

    // Initial ping
    pingStartRef.current = performance.now();
    send({ type: 'ping' });

    return () => {
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    };
  }, [state.currentChannel, isConnected, send]);

  // Subscribe to pong responses for latency measurement
  useEffect(() => {
    const unsubPong = subscribe('pong', () => {
      const latencyMs = Math.round(performance.now() - pingStartRef.current);
      const quality = getSignalQuality(latencyMs);
      setState(prev => ({
        ...prev,
        signalLatency: latencyMs,
        signalBars: quality.bars,
        signalLabel: quality.label,
        signalColor: quality.color,
      }));
    });
    return () => unsubPong();
  }, [subscribe, getSignalQuality]);

  // ─── Emergency Mode ────────────────────────────────────────
  const startEmergency = useCallback(async () => {
    if (!state.currentChannel) return;

    // Get GPS (best-effort, 5s timeout)
    let latitude: number | undefined;
    let longitude: number | undefined;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 30000,
        });
      });
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    } catch { /* GPS unavailable — continue without */ }

    // Send emergency start to server
    send({
      type: 'radio_emergency_start',
      data: { latitude, longitude },
    });

    // Play emergency warble (looping until cancelled)
    emergencyToneRef.current = playLoopingTone('emergency', 2200);

    setState(prev => ({
      ...prev,
      emergencyActive: true,
      emergencyUser: {
        userId: Number(user?.id || 0),
        fullName: `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.username || 'You',
        latitude,
        longitude,
      },
    }));

    // Auto-start 10-second forced transmit
    startTransmit();
    emergencyTimerRef.current = setTimeout(() => {
      stopTransmit();
      emergencyTimerRef.current = null;
    }, 10000);
  }, [state.currentChannel, send, user, startTransmit, stopTransmit]);

  const cancelEmergency = useCallback(() => {
    // Stop emergency tone
    emergencyToneRef.current?.stop();
    emergencyToneRef.current = null;
    // Cancel forced TX timer
    if (emergencyTimerRef.current) {
      clearTimeout(emergencyTimerRef.current);
      emergencyTimerRef.current = null;
    }
    // Stop transmitting if still active
    if (isTransmittingRef.current) {
      performStop();
    }
    // Notify server
    send({ type: 'radio_emergency_cancel' });
    setState(prev => ({ ...prev, emergencyActive: false, emergencyUser: null }));
  }, [send, performStop]);

  const acknowledgeEmergency = useCallback(() => {
    send({ type: 'radio_emergency_ack' });
  }, [send]);

  // Subscribe to emergency events
  useEffect(() => {
    const unsubEmergencyAlert = subscribe('radio_emergency_alert', (msg: any) => {
      const data = msg.data || msg;
      // Play emergency tone for remote emergencies
      if (data.userId !== userIdRef.current) {
        emergencyToneRef.current?.stop();
        emergencyToneRef.current = playLoopingTone('emergency', 2200);
      }
      setState(prev => ({
        ...prev,
        emergencyActive: true,
        emergencyUser: {
          userId: data.userId,
          fullName: data.fullName || data.username || 'Unknown',
          latitude: data.latitude,
          longitude: data.longitude,
        },
      }));
    });

    const unsubEmergencyCancel = subscribe('radio_emergency_cancel', () => {
      emergencyToneRef.current?.stop();
      emergencyToneRef.current = null;
      setState(prev => ({ ...prev, emergencyActive: false, emergencyUser: null }));
    });

    return () => {
      unsubEmergencyAlert();
      unsubEmergencyCancel();
    };
  }, [subscribe]);

  // ─── Radio Check ───────────────────────────────────────────
  const sendRadioCheck = useCallback(() => {
    if (!state.currentChannel) return;
    playRadioTone('mdcDataBurst'); // MDC burst indicates check sent
    send({ type: 'radio_check_request' });
    setState(prev => ({ ...prev, radioCheckResponses: [] }));
  }, [state.currentChannel, send]);

  // Subscribe to radio check events
  useEffect(() => {
    const unsubCheckReq = subscribe('radio_check_request', (msg: any) => {
      const data = msg.data || msg;
      // Someone is requesting a radio check — play tone and auto-respond
      playRadioTone('radioCheck');
      // Auto-ACK after 1 second
      setTimeout(() => {
        send({ type: 'radio_check_ack', data: { toUserId: data.userId } });
        playRadioTone('radioCheckAck');
      }, 1000);
    });

    const unsubCheckAck = subscribe('radio_check_ack', (msg: any) => {
      const data = msg.data || msg;
      playRadioTone('radioCheckAck');
      setState(prev => ({
        ...prev,
        radioCheckResponses: [
          ...prev.radioCheckResponses,
          { userId: data.userId, fullName: data.fullName || data.username || 'Unknown', ackAt: Date.now() },
        ],
      }));
    });

    return () => {
      unsubCheckReq();
      unsubCheckAck();
    };
  }, [subscribe, send]);

  // ─── Selcall / Unit Alerting ───────────────────────────────
  const sendSelcall = useCallback((targetUserId: number) => {
    if (!state.currentChannel) return;
    playRadioTone('twoTonePage'); // Two-tone indicates selcall sent
    send({ type: 'radio_selcall', data: { targetUserId } });
  }, [state.currentChannel, send]);

  const acknowledgeSelcall = useCallback(() => {
    // Stop alert tone
    selcallToneRef.current?.stop();
    selcallToneRef.current = null;
    // Send ACK
    if (state.selcallAlert) {
      send({ type: 'radio_selcall_ack', data: { toUserId: state.selcallAlert.fromUserId } });
    }
    setState(prev => ({ ...prev, selcallAlert: null }));
  }, [send, state.selcallAlert]);

  // Subscribe to selcall events
  useEffect(() => {
    const unsubSelcallAlert = subscribe('radio_selcall_alert', (msg: any) => {
      const data = msg.data || msg;
      // Play persistent alert tone
      selcallToneRef.current?.stop();
      selcallToneRef.current = playLoopingTone('selcallAlert', 2500);
      setState(prev => ({
        ...prev,
        selcallAlert: {
          fromUserId: data.fromUserId,
          fromFullName: data.fromFullName || data.fromUsername || 'Unknown',
        },
      }));
    });

    const unsubSelcallAck = subscribe('radio_selcall_ack', (msg: any) => {
      const data = msg.data || msg;
      playRadioTone('radioCheckAck'); // Confirmation pip
    });

    return () => {
      unsubSelcallAlert();
      unsubSelcallAck();
    };
  }, [subscribe]);

  // ─── Cleanup emergency/selcall on unmount ─────────────────
  useEffect(() => {
    return () => {
      emergencyToneRef.current?.stop();
      selcallToneRef.current?.stop();
      if (emergencyTimerRef.current) clearTimeout(emergencyTimerRef.current);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    };
  }, []);

  return {
    ...state,
    radioChannels,
    joinChannel,
    leaveChannel,
    startTransmit,
    stopTransmit,
    isConnected,
    // Volume / FX
    setMasterVolume,
    toggleMute,
    toggleFx,
    getAnalyser: () => busRef.current.getAnalyser(),
    // Emergency
    startEmergency,
    cancelEmergency,
    acknowledgeEmergency,
    // Radio Check
    sendRadioCheck,
    // Selcall
    sendSelcall,
    acknowledgeSelcall,
  };
}
