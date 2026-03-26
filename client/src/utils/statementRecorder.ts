// ============================================================
// RMPG Flex — Witness Statement Recorder
//
// Continuous speech-to-text that appends to a call's narrative.
// Activated by "start statement", stopped by "end statement".
// Uses Web Speech API with auto-restart for uninterrupted
// recording, saving transcript to the server periodically.
//
// Usage:
//   startStatement('2024-0042', 157, {
//     onTranscript: (text) => console.log(text),
//     onError: (err) => console.error(err),
//   });
//   // ... officer takes statement ...
//   const final = endStatement();
// ============================================================

// ─── Types ──────────────────────────────────────────────────

export interface StatementState {
  active: boolean;
  callNumber: string | null;
  callId: number | null;
  startedAt: number | null;
  transcript: string;
  wordCount: number;
}

interface StatementCallbacks {
  onTranscript: (text: string) => void;
  onError: (error: string) => void;
}

// ─── State ──────────────────────────────────────────────────

let state: StatementState = {
  active: false,
  callNumber: null,
  callId: null,
  startedAt: null,
  transcript: '',
  wordCount: 0,
};

let recognition: SpeechRecognition | null = null;
let callbacks: StatementCallbacks | null = null;

// ─── Server persistence ─────────────────────────────────────

async function saveToServer(callId: number, transcript: string, isFinal = false): Promise<void> {
  const token = localStorage.getItem('rmpg-token');
  await fetch('/api/voice/statement', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ callId, transcript, isFinal }),
  }).catch(() => {}); // non-critical
}

// ─── Word count helper ──────────────────────────────────────

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ─── Public API ─────────────────────────────────────────────

export function startStatement(
  callNumber: string,
  callId: number,
  cbs: StatementCallbacks,
): boolean {
  // Already recording
  if (state.active) return false;

  // Check browser support
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    cbs.onError('Speech recognition not supported in this browser');
    return false;
  }

  callbacks = cbs;

  state = {
    active: true,
    callNumber,
    callId,
    startedAt: Date.now(),
    transcript: '',
    wordCount: 0,
  };

  recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        const text = result[0].transcript.trim();
        if (text) {
          state.transcript += (state.transcript ? ' ' : '') + text;
          state.wordCount = countWords(state.transcript);

          callbacks?.onTranscript(state.transcript);

          // Save incrementally
          if (state.callId !== null) {
            saveToServer(state.callId, state.transcript);
          }
        }
      }
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    // 'no-speech' and 'aborted' are normal during pauses
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      callbacks?.onError(`Speech recognition error: ${event.error}`);
    }
  };

  recognition.onend = () => {
    // Auto-restart if still active
    if (state.active && recognition) {
      try {
        recognition.start();
      } catch {
        // May fail if already started; ignore
      }
    }
  };

  try {
    recognition.start();
    return true;
  } catch {
    state.active = false;
    cbs.onError('Failed to start speech recognition');
    return false;
  }
}

export function endStatement(): StatementState {
  const finalState = { ...state };

  if (recognition) {
    state.active = false; // prevent auto-restart in onend
    recognition.stop();
    recognition = null;
  }

  // Final save
  if (finalState.callId !== null && finalState.transcript) {
    saveToServer(finalState.callId, finalState.transcript, true);
  }

  // Reset state
  state = {
    active: false,
    callNumber: null,
    callId: null,
    startedAt: null,
    transcript: '',
    wordCount: 0,
  };
  callbacks = null;

  return finalState;
}

export function getStatementState(): StatementState {
  return { ...state };
}

export function isRecording(): boolean {
  return state.active;
}
