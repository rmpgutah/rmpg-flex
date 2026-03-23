// ============================================================
// RMPG Flex — CAD Command Line
// Fixed-position command bar at the bottom of DispatchPage.
// Green monospace text on dark background (terminal aesthetic).
// Global shortcut: "/" focuses the command line.
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Terminal, ChevronRight } from 'lucide-react';
import { executeCommand, getCommandVerbs, loadCommandHistory, saveCommandHistory, type CadContext, type CommandAction } from '../utils/cadCommandParser';
import { playTone } from '../utils/dispatchTones';

interface CadCommandLineProps {
  context: CadContext;
  onAction?: (action: CommandAction) => void;
}

export default function CadCommandLine({ context, onAction }: CadCommandLineProps) {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<{ text: string; success: boolean } | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadCommandHistory());
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [isExpanded, setIsExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auto-clear output after 8 seconds ──
  useEffect(() => {
    if (output && !output.text.includes('\n')) {
      outputTimerRef.current = setTimeout(() => setOutput(null), 8000);
    }
    return () => { if (outputTimerRef.current) clearTimeout(outputTimerRef.current); };
  }, [output]);

  // ── Global "/" shortcut to focus command line ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement)?.isContentEditable;

      if (e.key === '/' && !isEditable && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsExpanded(true);
      }

      // Escape to blur
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setInput('');
        setSuggestions([]);
        setIsExpanded(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Update suggestions as user types ──
  useEffect(() => {
    if (!input.trim()) {
      setSuggestions([]);
      return;
    }
    const firstWord = input.trim().split(/\s+/)[0].toUpperCase();
    const verbs = getCommandVerbs();
    if (input.trim().indexOf(' ') === -1) {
      // Still typing the verb — suggest matching verbs
      const matches = verbs.filter(v => v.startsWith(firstWord) && v !== firstWord);
      setSuggestions(matches.slice(0, 4));
    } else {
      setSuggestions([]);
    }
  }, [input]);

  // ── Execute command ──
  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Add to history and persist
    setHistory(prev => {
      const next = [trimmed, ...prev.filter(h => h !== trimmed)].slice(0, 100);
      saveCommandHistory(next);
      return next;
    });
    setHistoryIdx(-1);
    setInput('');
    setSuggestions([]);

    try {
      const result = await executeCommand(trimmed, context);
      setOutput({ text: result.message, success: result.success });

      // Play tone based on result
      if (result.success && result.action.type !== 'show_help' && result.action.type !== 'none') {
        playTone('info');
      } else if (!result.success) {
        playTone('error');
      }

      // Notify parent of action
      if (result.action.type !== 'none' && onAction) {
        onAction(result.action);
      }

      // For help, keep output visible (expanded)
      if (result.action.type === 'show_help') {
        setIsExpanded(true);
      }
    } catch (err) {
      setOutput({ text: `Error: ${err}`, success: false });
      playTone('error');
    }
  }, [input, context, onAction]);

  // ── Key handling ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    // History navigation
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      } else {
        setHistoryIdx(-1);
        setInput('');
      }
    }
    // Tab autocomplete
    if (e.key === 'Tab') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setInput(suggestions[0] + ' ');
        setSuggestions([]);
      }
    }
  }, [handleSubmit, history, historyIdx, suggestions]);

  const isMultiline = output?.text.includes('\n');

  return (
    <div className="cad-command-line">
      {/* Output area (multi-line for HELP, single line for results) */}
      {output && isMultiline && isExpanded && (
        <div className="cad-command-output-expanded">
          <pre>{output.text}</pre>
        </div>
      )}

      {/* Single-line output */}
      {output && !isMultiline && (
        <div className={`cad-command-output ${output.success ? 'cad-output-success' : 'cad-output-error'}`}>
          {output.text}
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="cad-command-suggestions">
          {suggestions.map(s => (
            <button type="button"
              key={s}
              className="cad-suggestion"
              onMouseDown={(e) => { e.preventDefault(); setInput(s + ' '); setSuggestions([]); inputRef.current?.focus(); }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Command input */}
      <div className="cad-command-input-row">
        <Terminal style={{ width: 12, height: 12, color: '#d4a017', flexShrink: 0 }} />
        <ChevronRight style={{ width: 10, height: 10, color: '#d4a017', flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          className="cad-command-input"
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsExpanded(true)}
          placeholder="Type command or press / to focus  (HELP for commands)"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
        />
        <span className="cad-command-hint">
          {input ? 'ENTER' : '/'}
        </span>
      </div>
    </div>
  );
}
