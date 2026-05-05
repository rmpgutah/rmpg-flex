// ============================================================
// VoiceChannelIndicator — Corner V icon that opens on demand
//
// Default: a small V pill in the bottom-right corner — unobtrusive.
// Press V (keyboard) or click the pill: expands inline into a compact
// dispatch panel with push-to-talk button, text input, last reply,
// and a help line. Auto-collapses after 6s of post-reply inactivity
// or on Esc / click-outside.
//
// All input — voice and text — funnels through useVoiceChannel into
// the natural-language dialogue agent at /api/voice/dialogue.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useVoiceChannel } from '../hooks/useVoiceChannel';
import { isRecording as isStatementRecording, getStatementState } from '../utils/statementRecorder';

const HOLD_THRESHOLD_MS = 250;
const AUTO_COLLAPSE_MS = 6000;
const OPEN_HOLD_MS = 3000; // V key must be held this long to open the panel

export default function VoiceChannelIndicator() {
  const {
    state,
    transcript,
    lastCommand,
    error,
    activateManualListen,
    startHoldToTalk,
    endHoldToTalk,
    submitText,
    enabled,
    stressDetected,
    isRadioBusy,
  } = useVoiceChannel();

  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [statementActive, setStatementActive] = useState(false);
  const [statementWords, setStatementWords] = useState(0);
  const [textInput, setTextInput] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDownAtRef = useRef<number>(0);
  const pointerHoldingRef = useRef(false);
  // Global V-key 3-second hold-to-open
  const openHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openHoldFiredRef = useRef(false);
  // Visual hold-progress on the small corner pill (0..1)
  const [holdProgress, setHoldProgress] = useState(0);
  const holdStartedAtRef = useRef(0);
  const holdRafRef = useRef<number | null>(null);

  // ── Statement recorder polling ──
  useEffect(() => {
    const interval = setInterval(() => {
      setStatementActive(isStatementRecording());
      if (isStatementRecording()) setStatementWords(getStatementState().wordCount);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Auto-open ONLY for severe externally-triggered states (alerts).
  // Routine processing/responding ticks should not pop the panel — only
  // dispatcher-pushed alerts deserve to take over the screen.
  useEffect(() => {
    if (state === 'alerting') setOpen(true);
  }, [state]);

  // ── Auto-collapse after idle ──
  useEffect(() => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    if (!open) return;
    if (state !== 'idle') return;          // only collapse when idle
    if (statementActive || stressDetected) return; // keep open during these
    collapseTimerRef.current = setTimeout(() => setOpen(false), AUTO_COLLAPSE_MS);
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, [open, state, lastCommand, transcript, error, statementActive, stressDetected]);

  // ── Esc closes; click-outside closes ──
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setShowHelp(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowHelp(false);
      }
    };
    document.addEventListener('keydown', onEsc);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // ── Global V-key gesture: hold for 3 seconds to open the live dispatch
  // panel and immediately start a listen session. Quick taps are ignored
  // entirely — opening dispatch is a deliberate gesture, not a stray
  // keystroke. A progress fill on the corner pill shows how close the
  // user is to the trigger so the gesture is discoverable.
  useEffect(() => {
    if (!enabled) return;

    const isFormTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return el.isContentEditable;
    };

    const cancelHold = () => {
      if (openHoldTimerRef.current) {
        clearTimeout(openHoldTimerRef.current);
        openHoldTimerRef.current = null;
      }
      if (holdRafRef.current) {
        cancelAnimationFrame(holdRafRef.current);
        holdRafRef.current = null;
      }
      setHoldProgress(0);
      openHoldFiredRef.current = false;
    };

    const tickProgress = () => {
      const elapsed = Date.now() - holdStartedAtRef.current;
      const p = Math.min(1, elapsed / OPEN_HOLD_MS);
      setHoldProgress(p);
      if (p < 1 && openHoldTimerRef.current) {
        holdRafRef.current = requestAnimationFrame(tickProgress);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isFormTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'v' && e.key !== 'V') return;
      if (e.repeat) return;
      if (open) return;            // already open — V hold is a no-op
      if (openHoldTimerRef.current) return; // hold already in progress

      e.preventDefault();
      holdStartedAtRef.current = Date.now();
      openHoldFiredRef.current = false;
      openHoldTimerRef.current = setTimeout(() => {
        openHoldFiredRef.current = true;
        openHoldTimerRef.current = null;
        if (holdRafRef.current) {
          cancelAnimationFrame(holdRafRef.current);
          holdRafRef.current = null;
        }
        setHoldProgress(0);
        setOpen(true);
        // Immediately start a listen session — "live dispatch pops open
        // and communicates with you". The user shouldn't have to make
        // a second gesture after a 3-second commit.
        activateManualListen();
      }, OPEN_HOLD_MS);
      holdRafRef.current = requestAnimationFrame(tickProgress);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'v' && e.key !== 'V') return;
      if (openHoldFiredRef.current) {
        // Released after the hold already fired — nothing to undo
        openHoldFiredRef.current = false;
        return;
      }
      cancelHold();
    };

    // Lose focus / tab change → cancel any in-progress hold
    const onBlur = () => cancelHold();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      cancelHold();
    };
  }, [enabled, open, activateManualListen]);

  // ── Focus the text input when the panel opens ──
  useEffect(() => {
    if (open && inputRef.current) {
      // Defer so the input has mounted
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ── V button push-to-talk (pointer) ──
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointerDownAtRef.current = Date.now();
    pointerHoldingRef.current = true;
    startHoldToTalk();
  }, [startHoldToTalk]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!pointerHoldingRef.current) return;
    pointerHoldingRef.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const heldMs = Date.now() - pointerDownAtRef.current;
    if (heldMs < HOLD_THRESHOLD_MS) activateManualListen();
    else endHoldToTalk();
  }, [activateManualListen, endHoldToTalk]);

  const handlePointerCancel = useCallback(() => {
    if (!pointerHoldingRef.current) return;
    pointerHoldingRef.current = false;
    endHoldToTalk();
  }, [endHoldToTalk]);

  const handleTextSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const text = textInput.trim();
    if (!text) return;
    submitText(text);
    setTextInput('');
  }, [textInput, submitText]);

  if (!enabled) return null;

  const radioBusy = state === 'listening' && isRadioBusy();
  const stateLabel = STATE_LABELS[state] ?? '';
  const stateColor = STATE_COLORS[state] ?? '#888888';

  return (
    <div
      ref={rootRef}
      className="fixed right-4 z-[9999]"
      style={{ bottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}
    >
      {/* Closed: small corner V pill. Hold-V progress fills the bottom
          edge as the user holds — visual confirmation of the 3s commit. */}
      {!open && (
        <button
          type="button"
          onClick={() => { setOpen(true); activateManualListen(); }}
          className="relative flex items-center gap-1.5 px-2.5 py-1.5 bg-[#181818] border border-[#373737] rounded text-gray-400 hover:border-[#d4a017] hover:text-[#d4a017] transition-colors text-xs font-mono overflow-hidden"
          title="Voice dispatch — hold V for 3 seconds, or click to open"
          aria-label="Open voice dispatch panel"
        >
          <MicIcon />
          <span>V</span>
          {holdProgress > 0 && (
            <span
              aria-hidden="true"
              className="absolute left-0 bottom-0 h-[2px] bg-[#d4a017]"
              style={{ width: `${holdProgress * 100}%`, transition: 'width 50ms linear' }}
            />
          )}
        </button>
      )}

      {/* Open: compact dispatch panel */}
      {open && (
        <div
          className="bg-[#141414] border rounded shadow-lg overflow-hidden flex flex-col"
          style={{
            width: 280,
            maxWidth: 'calc(100vw - 2rem)',
            borderColor: state === 'listening' ? '#22c55e' : '#373737',
          }}
        >
          {/* Conversation stack — most recent at top */}
          {(transcript || lastCommand || error) && (
            <div className="flex flex-col gap-1 p-2" style={{ background: '#0a0a0a', borderBottom: '1px solid #2a2a2a' }}>
              {transcript && (
                <div className="text-[11px] font-mono text-green-400 break-words">
                  <span className="text-[9px] uppercase tracking-wider text-gray-600 mr-1.5">YOU</span>
                  {transcript}
                </div>
              )}
              {lastCommand && (
                <div
                  className={`text-[11px] font-mono break-words ${
                    lastCommand.success ? 'text-gray-100' : 'text-red-300'
                  }`}
                >
                  <span className="text-[9px] uppercase tracking-wider text-[#d4a017] mr-1.5">DSP</span>
                  {lastCommand.message}
                </div>
              )}
              {error && (
                <div className="text-[11px] font-mono text-red-300 break-words">
                  <span className="text-[9px] uppercase tracking-wider text-red-500 mr-1.5">ERR</span>
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Statement / stress chips */}
          {statementActive && (
            <div className="flex items-center gap-2 px-2.5 py-1 bg-red-900/40 text-red-200 text-[10px] font-mono uppercase tracking-wider">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
              </span>
              REC STATEMENT · {statementWords}w
            </div>
          )}
          {stressDetected && (
            <div className="px-2.5 py-1 bg-orange-900/40 text-orange-200 text-[10px] font-mono uppercase tracking-wider animate-pulse">
              STRESS DETECTED
            </div>
          )}

          {/* Help panel — toggles via the ? button */}
          {showHelp && (
            <div className="p-2.5 text-[10px] font-mono text-gray-300 leading-relaxed" style={{ background: '#0a0a0a', borderBottom: '1px solid #2a2a2a' }}>
              <div className="text-[#d4a017] uppercase tracking-wider mb-1">Help</div>
              <ul className="space-y-0.5 text-gray-400">
                <li><span className="text-gray-100">Hold V</span> — push-to-talk (mic stays open)</li>
                <li><span className="text-gray-100">Tap V</span> — listen for a few seconds</li>
                <li><span className="text-gray-100">Type + Enter</span> — text query to dispatch</li>
                <li><span className="text-gray-100">Esc</span> — close panel</li>
                <li className="pt-1 text-gray-500">Try: "who's nearest?", "10-97", "run plate ABC123"</li>
              </ul>
            </div>
          )}

          {/* Main row — V button + input + help/close */}
          <div className="flex items-stretch">
            <button
              type="button"
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onPointerLeave={handlePointerCancel}
              onContextMenu={(e) => e.preventDefault()}
              className="flex flex-col items-center justify-center px-3 py-2 select-none transition-colors"
              style={{
                minWidth: 56,
                background:
                  state === 'listening' ? '#0e2517' :
                  state === 'processing' ? '#251f0e' :
                  state === 'responding' ? '#2a200a' :
                  '#1a1a1a',
                borderRight: '1px solid #2a2a2a',
                color: stateColor,
                cursor: state === 'alerting' ? 'not-allowed' : 'pointer',
              }}
              title="Hold to talk · tap to listen"
              aria-label="Voice dispatch — hold to talk"
              disabled={state === 'alerting'}
            >
              <MicIcon big pulsing={state === 'listening'} />
              <span className="text-[10px] font-mono font-bold tracking-widest mt-0.5">V</span>
            </button>

            <form onSubmit={handleTextSubmit} className="flex-1 flex items-center min-w-0">
              <input
                ref={inputRef}
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={
                  state === 'listening' ? 'Listening…' :
                  state === 'processing' ? 'Working…' :
                  state === 'responding' ? 'Responding…' :
                  'Type or hold V…'
                }
                disabled={state === 'alerting' || state === 'processing' || state === 'responding'}
                className="flex-1 min-w-0 bg-transparent border-0 outline-none px-2.5 py-2 text-xs font-mono text-gray-100 placeholder-gray-600"
                autoComplete="off"
                spellCheck={false}
              />
              {textInput.trim() && (
                <button
                  type="submit"
                  className="px-2 py-2 text-[10px] font-mono font-bold uppercase tracking-wider text-[#d4a017] hover:bg-[#1a1a1a] transition-colors"
                  title="Send (Enter)"
                >
                  SEND
                </button>
              )}
            </form>

            <button
              type="button"
              onClick={() => setShowHelp(s => !s)}
              className="px-1.5 text-[11px] font-mono text-gray-500 hover:text-[#d4a017] transition-colors"
              title="Toggle help"
              aria-label="Toggle help"
            >
              ?
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setShowHelp(false); }}
              className="px-1.5 text-xs text-gray-500 hover:text-gray-200 transition-colors"
              title="Close panel (Esc)"
              aria-label="Close voice panel"
            >
              ×
            </button>
          </div>

          {/* State strip */}
          <div
            className="flex items-center justify-between px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest"
            style={{ background: '#050505', borderTop: '1px solid #1a1a1a' }}
          >
            <span style={{ color: stateColor }}>
              {state === 'listening' && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5 animate-pulse" />
              )}
              {stateLabel}
            </span>
            {radioBusy
              ? <span className="text-purple-400">RADIO ACTIVE — PAUSED</span>
              : <span className="text-gray-700">HOLD V · TAP V · TYPE</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components & lookups ───────────────────────────────

const STATE_LABELS: Record<string, string> = {
  idle: 'READY',
  alerting: 'ALERT',
  listening: 'LISTENING',
  processing: 'PROCESSING',
  responding: 'RESPONSE',
};

const STATE_COLORS: Record<string, string> = {
  idle: '#888888',
  alerting: '#ef4444',
  listening: '#22c55e',
  processing: '#eab308',
  responding: '#d4a017',
};

function MicIcon({ big = false, pulsing = false }: { big?: boolean; pulsing?: boolean }) {
  const size = big ? 18 : 14;
  return (
    <svg
      style={{ width: size, height: size }}
      fill="currentColor"
      viewBox="0 0 20 20"
      className={pulsing ? 'animate-pulse' : ''}
    >
      <path
        fillRule="evenodd"
        d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
        clipRule="evenodd"
      />
    </svg>
  );
}
