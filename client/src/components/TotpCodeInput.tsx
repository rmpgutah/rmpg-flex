// ============================================================
// RMPG Flex — TOTP 6-Digit Code Input
// Six individual digit boxes with auto-advance, backspace
// navigation, paste support, and a countdown timer showing
// seconds remaining on the current TOTP period.
// ============================================================

import React, { useRef, useCallback, useEffect, useState } from 'react';

interface TotpCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  error?: boolean;
}

/** Seconds remaining in the current 30-second TOTP period. */
function getSecondsRemaining(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

export default function TotpCodeInput({ value, onChange, onComplete, disabled, error }: TotpCodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, '').slice(0, 6).split('');

  // TOTP countdown timer
  const [secondsLeft, setSecondsLeft] = useState(getSecondsRemaining);
  useEffect(() => {
    const tick = () => setSecondsLeft(getSecondsRemaining());
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  const timerUrgent = secondsLeft <= 5;
  const timerProgress = secondsLeft / 30;
  // Focus first input on mount and when value is cleared (retry after error)
  useEffect(() => {
    if (!value || value.trim() === '') {
      inputRefs.current[0]?.focus();
    }
  }, [value]);

  const handleInput = useCallback((index: number, char: string) => {
    if (!/^\d$/.test(char)) return;

    const newDigits = [...digits];
    newDigits[index] = char;
    const newValue = newDigits.join('');
    onChange(newValue);

    // Auto-advance
    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (newValue.replace(/\s/g, '').length === 6 && onComplete) {
      setTimeout(() => onComplete(newValue.trim()), 50);
    }
  }, [digits, onChange, onComplete]);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const newDigits = [...digits];

      if (digits[index] && digits[index] !== ' ') {
        newDigits[index] = ' ';
        onChange(newDigits.join(''));
      } else if (index > 0) {
        newDigits[index - 1] = ' ';
        onChange(newDigits.join(''));
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }, [digits, onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length > 0) {
      // Always fill from the first box regardless of which was focused
      onChange(pasted.padEnd(6, ' '));
      const focusIdx = Math.min(pasted.length, 5);
      inputRefs.current[focusIdx]?.focus();

      if (pasted.length === 6 && onComplete) {
        setTimeout(() => onComplete(pasted), 50);
      }
    }
  }, [onChange, onComplete]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            disabled={disabled}
            value={digits[i]?.trim() || ''}
            onChange={(e) => handleInput(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            autoComplete="one-time-code"
            style={{
              width: 44,
              height: 52,
              textAlign: 'center',
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'monospace',
              background: '#050505',
              border: `2px solid ${error ? '#ef4444' : digits[i]?.trim() ? '#888888' : '#222222'}`,
              borderRadius: 2,
              color: '#fff',
              outline: 'none',
              caretColor: '#888888',
              transition: 'border-color 0.15s',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = '#888888';
              e.target.select();
            }}
            onBlur={(e) => {
              e.target.style.borderColor = error ? '#ef4444' : digits[i]?.trim() ? '#888888' : '#222222';
            }}
          />
        ))}
      </div>

      {/* TOTP countdown timer */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <div style={{
          flex: 1,
          maxWidth: 200,
          height: 3,
          background: '#1a1a1a',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${timerProgress * 100}%`,
            height: '100%',
            background: timerUrgent ? '#ef4444' : '#888888',
            transition: 'width 1s linear, background 0.3s',
            borderRadius: 2,
          }} />
        </div>
        <span style={{
          fontSize: 10,
          fontFamily: 'monospace',
          fontWeight: 700,
          color: timerUrgent ? '#ef4444' : '#666666',
          minWidth: 24,
          textAlign: 'right',
        }}>
          {secondsLeft}s
        </span>
      </div>
      {timerUrgent && (
        <p style={{ textAlign: 'center', fontSize: 9, color: '#ef4444', marginTop: 4 }}>
          Code expiring — wait for next code if entry fails
        </p>
      )}
    </div>
  );
}
