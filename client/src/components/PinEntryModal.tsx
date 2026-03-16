import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Lock, AlertTriangle, Loader2 } from 'lucide-react';
import { useOfflineMode } from '../hooks/useOfflineMode';

interface PinEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful PIN entry (optional — the hook updates state automatically) */
  onSuccess?: () => void;
}

/**
 * 6-digit PIN entry modal shown to employees when they attempt an offline write
 * without authorization. Large touch-friendly digit boxes for field use.
 *
 * Auto-triggered when an OfflineUnauthorizedError is caught by the UI.
 */
export default function PinEntryModal({ isOpen, onClose, onSuccess }: PinEntryModalProps) {
  const { enterPin } = useOfflineMode();
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus first input on open
  useEffect(() => {
    if (isOpen) {
      setDigits(['', '', '', '', '', '']);
      setError(null);
      setAttemptsRemaining(null);
      setSubmitting(false);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [isOpen]);

  const handleChange = useCallback((index: number, value: string) => {
    // Only allow numeric input
    const digit = value.replace(/\D/g, '').slice(-1);
    setDigits(prev => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    setError(null);

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      // Move back on backspace from empty field
      inputRefs.current[index - 1]?.focus();
      setDigits(prev => {
        const next = [...prev];
        next[index - 1] = '';
        return next;
      });
    }
  }, [digits]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length > 0) {
      const next = ['', '', '', '', '', ''];
      for (let i = 0; i < pasted.length; i++) {
        next[i] = pasted[i];
      }
      setDigits(next);
      // Focus the appropriate field
      const focusIdx = Math.min(pasted.length, 5);
      inputRefs.current[focusIdx]?.focus();
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const pin = digits.join('');
    if (pin.length !== 6) {
      setError('Enter all 6 digits');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await enterPin(pin);

      if (result.success) {
        onSuccess?.();
        onClose();
      } else {
        setError(result.error || 'Invalid PIN');
        if (result.attemptsRemaining !== undefined) {
          setAttemptsRemaining(result.attemptsRemaining);
        }
        // Clear digits on failure
        setDigits(['', '', '', '', '', '']);
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN validation failed');
    } finally {
      setSubmitting(false);
    }
  }, [digits, enterPin, onClose, onSuccess]);

  // Auto-submit when all 6 digits entered
  useEffect(() => {
    if (digits.every(d => d !== '') && !submitting) {
      handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', zIndex: 99998 }}
    >
      <div
        className="w-full max-w-sm mx-4"
        style={{
          background: '#141e2b',
          border: '1px solid #1e3048',
          borderTop: '3px solid #d97706',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-bold text-white">Offline Authorization</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-rmpg-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-rmpg-300 text-center leading-relaxed">
            Internet is unavailable. Enter the 6-digit PIN provided by your administrator to enable offline data entry.
          </p>

          {/* PIN Input Grid */}
          <div className="flex justify-center gap-2">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => handleChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                onPaste={i === 0 ? handlePaste : undefined}
                disabled={submitting}
                className="w-12 h-14 text-center text-2xl font-mono font-bold text-white transition-colors focus:outline-none"
                style={{
                  background: '#0d0d0d',
                  border: `2px solid ${error ? '#dc2626' : digit ? '#d97706' : '#2a3e58'}`,
                  caretColor: '#d97706',
                }}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs bg-red-900/30 border border-red-700/50 text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Attempts remaining warning */}
          {attemptsRemaining !== null && attemptsRemaining <= 2 && (
            <div className="text-center text-[10px] text-amber-400 font-mono">
              {attemptsRemaining === 0
                ? 'Account locked. Try again in 15 minutes.'
                : `${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining before lockout`
              }
            </div>
          )}

          {/* Submit button (mostly for accessibility — auto-submits on 6th digit) */}
          <button
            onClick={handleSubmit}
            disabled={submitting || digits.some(d => d === '')}
            className="btn-primary w-full justify-center"
            style={{ borderColor: '#d97706', background: submitting ? '#3a3a3a' : undefined }}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Authorize Offline Access'
            )}
          </button>

          <p className="text-[9px] text-rmpg-500 text-center">
            Contact your administrator for a PIN. Authorization lasts 24 hours.
          </p>
        </div>
      </div>
    </div>
  );
}
