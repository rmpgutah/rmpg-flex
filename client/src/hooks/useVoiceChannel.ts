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

export interface UseVoiceChannelResult {
  state: VoiceChannelState;
  transcript: string;
  lastCommand: CommandResult | null;
  error: string | null;
  activateManualListen: () => void;
  alert: (narrative: string, severity: AlertSeverity) => void;
  enabled: boolean;
  stressDetected: boolean;
}

export function useVoiceChannel(): UseVoiceChannelResult {
  const [state, setState] = useState<VoiceChannelState>('idle');
  const [transcript, setTranscript] = useState('');
  const [lastCommand, setLastCommand] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled] = useState(() => isVoiceChannelEnabled());
  const [stressDetected, setStressDetected] = useState(false);

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

    return () => {
      channel.destroy();
      channelRef.current = null;
      if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
      if (commandTimerRef.current) clearTimeout(commandTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [enabled]);

  // V-key listener for manual listen activation
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in a form element
      const target = e.target as HTMLElement;
      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;
      if (target.isContentEditable) return;

      // Don't trigger with modifier keys
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        channelRef.current?.activateManualListen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);

  const activateManualListen = useCallback(() => {
    channelRef.current?.activateManualListen();
  }, []);

  const alert = useCallback((narrative: string, severity: AlertSeverity) => {
    channelRef.current?.alert(narrative, severity);
  }, []);

  return {
    state,
    transcript,
    lastCommand,
    error,
    activateManualListen,
    alert,
    enabled,
    stressDetected,
  };
}
