// ============================================================
// RMPG Flex — TOTP 6-Digit Code Input
// Six individual digit boxes with auto-advance, backspace
// navigation, and paste support for authenticator codes.
// ============================================================

import React, { useRef, useCallback, useEffect } from 'react';

interface TotpCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  error?: boolean;
}

export default function TotpCodeInput({ value, onChange, onComplete, disabled, error }: TotpCodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

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
    if (newValue.replace(/\s/g, '').length === 6) {
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

      if (pasted.length === 6) {
        setTimeout(() => onComplete(pasted), 50);
      }
    }
  }, [onChange, onComplete]);

  return (
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
            background: '#0d1520',
            border: `2px solid ${error ? '#ef4444' : digits[i]?.trim() ? '#1a5a9e' : '#1e3048'}`,
            borderRadius: 2,
            color: '#fff',
            outline: 'none',
            caretColor: '#1a5a9e',
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => {
            e.target.style.borderColor = '#1a5a9e';
            e.target.select();
          }}
          onBlur={(e) => {
            e.target.style.borderColor = error ? '#ef4444' : digits[i]?.trim() ? '#1a5a9e' : '#1e3048';
          }}
        />
      ))}
    </div>
  );
}
