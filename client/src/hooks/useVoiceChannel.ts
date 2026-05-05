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
import { useWebSocket } from '../context/WebSocketContext';

export interface UseVoiceChannelResult {
  state: VoiceChannelState;
  transcript: string;
  lastCommand: CommandResult | null;
  error: string | null;
  activateManualListen: () => void;
  startHoldToTalk: () => void;
  endHoldToTalk: () => void;
  submitText: (text: string) => void;
  alert: (narrative: string, severity: AlertSeverity) => void;
  enabled: boolean;
  stressDetected: boolean;
  isRadioBusy: () => boolean;
}

export function useVoiceChannel(): UseVoiceChannelResult {
  const [state, setState] = useState<VoiceChannelState>('idle');
  const [transcript, setTranscript] = useState('');
  const [lastCommand, setLastCommand] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled] = useState(() => isVoiceChannelEnabled());
  const [stressDetected, setStressDetected] = useState(false);
  const { subscribe } = useWebSocket();

  const channelRef = useRef<VoiceChannel | null>(null);
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize VoiceChannel instance once on mount
  useEffect(() => {
    if (!enabled) return;

    const channel = new VoiceChannel({
      onStateChange: (s) => setState(s),
      onTranscript: (text, isFinal) => {
        setTranscript(text);
        // Clear transcript after 3s if final
        if (isFinal) {
          if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
          transcriptTimerRef.current = setTimeout(() => setTranscript(''), 3000);
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
          setTimeout(() => setStressDetected(false), 5000);
        }
      },
    });

    channelRef.current = channel;

    // Track radio PTT state for voice channel muting
    const unsubRadioStart = subscribe('radio_transmit_start' as any, () => {
      channelRef.current?.setRadioActive(true);
    });
    const unsubRadioEnd = subscribe('radio_transmit_end' as any, () => {
      channelRef.current?.setRadioActive(false);
    });

    return () => {
      channel.destroy();
      channelRef.current = null;
      unsubRadioStart();
      unsubRadioEnd();
      if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
      if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [enabled, subscribe]);

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

  const alert = useCallback((narrative: string, severity: AlertSeverity) => {
    channelRef.current?.alert(narrative, severity);
  }, []);

  const isRadioBusy = useCallback(() => channelRef.current?.isRadioBusy() ?? false, []);

  return {
    state,
    transcript,
    lastCommand,
    error,
    activateManualListen,
    startHoldToTalk,
    endHoldToTalk,
    submitText,
    alert,
    enabled,
    stressDetected,
    isRadioBusy,
  };
}
