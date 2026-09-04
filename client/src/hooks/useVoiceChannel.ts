// ============================================================
// useVoiceChannel — React hook wrapping VoiceChannel state machine
//
// Provides reactive state, transcript, command results, error
// messages, and a V-key shortcut for manual listen activation.
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  VoiceChannel,
  type VoiceChannelState,
  type CommandResult,
  isVoiceChannelEnabled,
} from '../utils/voiceChannel';
import type { AlertSeverity } from '../utils/alertSeverity';
import { voiceWsUrl } from '../utils/voiceWs';
import { getPttPrefs, PTT_PREFS_EVENT } from '../utils/pttPreferences';

export interface UseVoiceChannelResult {
  state: VoiceChannelState;
  transcript: string;
  /** True once the STT engine has committed the transcript as final.
   *  False while the officer is still mid-sentence (interim partial). */
  transcriptFinal: boolean;
  lastCommand: CommandResult | null;
  error: string | null;
  activateManualListen: () => void;
  startHoldToTalk: () => void;
  endHoldToTalk: () => void;
  submitText: (text: string) => void;
  setDriveMode: (active: boolean) => void;
  refreshConfig: () => void;
  alert: (narrative: string, severity: AlertSeverity) => void;
  enabled: boolean;
  stressDetected: boolean;
  isRadioBusy: () => boolean;
}

export function useVoiceChannel(): UseVoiceChannelResult {
  const [state, setState] = useState<VoiceChannelState>('idle');
  const [transcript, setTranscript] = useState('');
  const [transcriptFinal, setTranscriptFinal] = useState(true);
  const [lastCommand, setLastCommand] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled] = useState(() => isVoiceChannelEnabled());
  const [stressDetected, setStressDetected] = useState(false);

  const channelRef = useRef<VoiceChannel | null>(null);
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize VoiceChannel instance once on mount
  useEffect(() => {
    if (!enabled) return;

    const channel = new VoiceChannel({
      onStateChange: (s) => setState(s),
      onTranscript: (text, isFinal) => {
        setTranscript(text);
        setTranscriptFinal(isFinal);
        if (isFinal) {
          if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
          transcriptTimerRef.current = setTimeout(() => {
            setTranscript('');
            setTranscriptFinal(true);
          }, 3000);
        }
      },
      onCommandResult: (result) => {
        setLastCommand(result);
        // Clear after 5s
        if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
        commandTimerRef.current = setTimeout(() => setLastCommand(null), 5000);
      },
      onError: (err) => {
        setError(err);
        // Clear after 5s
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setError(null), 5000);
      },
      onStressDetected: (result) => {
        if (result.isStressed) {
          setStressDetected(true);
          if (stressTimerRef.current) clearTimeout(stressTimerRef.current);
          stressTimerRef.current = setTimeout(() => setStressDetected(false), 5000);
        }
      },
    });

    channelRef.current = channel;

    return () => {
      channel.destroy();
      channelRef.current = null;
      if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
      if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (stressTimerRef.current) clearTimeout(stressTimerRef.current);
    };
  }, [enabled]);

  // ── Radio PTT muting source (GPS-5) ────────────────────────
  // The voice-COMMAND mic must go quiet while someone is transmitting on the
  // radio, or STT picks up the radio audio. `radio_transmit_start/end` are
  // emitted ONLY by VoiceHubDO over the dedicated voice-ws (/api/voice-ws),
  // NOT the main /api/ws context — subscribing via useWebSocket() (the old
  // code) never fired, so the mic never muted. Open a monitor-only voice-ws
  // to the active radio room and drive setRadioActive() from it.
  //
  // Monitor-only: we authenticate and listen for transmit start/end (and
  // dispatch_speak, which also occupies the channel), but never capture mic
  // or play audio — that's the radio console / PttController's job. The room
  // follows the same channel resolution as the global PTT controller so the
  // two agree on which channel is "live".
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;

    let alive = true;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let currentRoomChannel: number | null = null;

    const resolveChannelId = (): number | null => getPttPrefs().channelId;

    const close = () => {
      if (retry) { clearTimeout(retry); retry = null; }
      if (ws) { try { ws.close(); } catch { /* noop */ } ws = null; }
      // Leaving the room — make sure we don't strand the mic in a muted state.
      channelRef.current?.setRadioActive(false);
    };

    const open = () => {
      const channelId = resolveChannelId();
      if (channelId == null) { close(); return; }   // no radio channel → nothing to monitor
      currentRoomChannel = channelId;
      const token = localStorage.getItem('rmpg_token');
      if (!token) return;
      const sock = new WebSocket(voiceWsUrl(`radio-${channelId}`));
      ws = sock;

      sock.onopen = () => {
        if (!alive) return;
        attempts = 0; // reset so backoff starts fresh after each clean reconnect
        try { sock.send(JSON.stringify({ type: 'authenticate', token })); } catch { /* in-flight */ }
      };

      sock.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case 'radio_transmit_start':
          case 'dispatch_speak':
            // Channel occupied — mute the command mic.
            channelRef.current?.setRadioActive(true);
            break;
          case 'radio_transmit_end':
            channelRef.current?.setRadioActive(false);
            break;
        }
      };

      sock.onclose = () => {
        if (!alive) return;
        // Don't leave the mic muted if the monitor drops mid-transmission.
        channelRef.current?.setRadioActive(false);
        attempts++;
        // No cap — keep retrying indefinitely with exponential backoff (max 30s).
        // A hard cap of 6 could be exhausted in one Worker deployment cycle
        // (each "script upgraded" close counts as one attempt), permanently
        // breaking radio-channel mic muting until the component remounts.
        retry = setTimeout(open, Math.min(500 * attempts, 30000));
      };
      sock.onerror = () => { try { sock.close(); } catch { /* noop */ } };
    };

    // Reconnect to the right room if the operator changes their PTT channel.
    const onPrefsChange = () => {
      if (resolveChannelId() !== currentRoomChannel) {
        close();
        attempts = 0;
        open();
      }
    };
    window.addEventListener(PTT_PREFS_EVENT, onPrefsChange);
    window.addEventListener('storage', onPrefsChange);

    open();

    return () => {
      alive = false;
      window.removeEventListener(PTT_PREFS_EVENT, onPrefsChange);
      window.removeEventListener('storage', onPrefsChange);
      close();
    };
  }, [enabled]);

  // The global V-key handler is owned by VoiceChannelIndicator now —
  // V held for 3 seconds opens the dispatch panel + auto-starts listening.
  // Casual taps deliberately do nothing to prevent accidental opens.
  // Push-to-talk inside the panel uses pointer events on the V button.

  const activateManualListen = useCallback(() => {
    channelRef.current?.activateManualListen();
  }, []);

  const startHoldToTalk = useCallback(() => {
    channelRef.current?.startHoldToTalk();
  }, []);

  const endHoldToTalk = useCallback(() => {
    channelRef.current?.endHoldToTalk();
  }, []);

  const submitText = useCallback((text: string) => {
    channelRef.current?.submitText(text);
  }, []);

  const setDriveMode = useCallback((active: boolean) => {
    channelRef.current?.setDriveMode(active);
  }, []);

  const refreshConfig = useCallback(() => {
    channelRef.current?.refreshConfig();
  }, []);

  const alert = useCallback((narrative: string, severity: AlertSeverity) => {
    channelRef.current?.alert(narrative, severity);
  }, []);

  const isRadioBusy = useCallback(() => channelRef.current?.isRadioBusy() ?? false, []);

  return {
    state,
    transcript,
    transcriptFinal,
    lastCommand,
    error,
    activateManualListen,
    startHoldToTalk,
    endHoldToTalk,
    submitText,
    setDriveMode,
    refreshConfig,
    alert,
    enabled,
    stressDetected,
    isRadioBusy,
  };
}
