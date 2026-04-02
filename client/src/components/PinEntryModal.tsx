import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Lock, AlertTriangle, Loader2, User, ChevronDown } from 'lucide-react';
import { useOfflineMode } from '../hooks/useOfflineMode';
import { getAll, isOfflineDbReady, setConfig } from '../services/offlineDb';

interface CachedUser {
  id: number;
  username: string;
  full_name: string;
  badge_number?: string;
  role: string;
  status: string;
}

interface PinEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful PIN entry (optional — the hook updates state automatically) */
  onSuccess?: () => void;
}

/**
 * 6-digit PIN entry modal shown to employees when they attempt an offline write
 * without authorization. Includes an employee dropdown so officers can identify
 * themselves when offline. Large touch-friendly digit boxes for field use.
 *
 * Auto-triggered when an OfflineUnauthorizedError is caught by the UI.
 */
export default function PinEntryModal({ isOpen, onClose, onSuccess }: PinEntryModalProps) {
  const { enterPin } = useOfflineMode();
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [employees, setEmployees] = useState<CachedUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Load cached employees when modal opens
  useEffect(() => {
    if (isOpen && isOfflineDbReady()) {
      setLoadingEmployees(true);
      getAll('users')
        .then((users: any[]) => {
          const active = users
            .filter((u: any) => u.status === 'active' && u.role !== 'client_viewer')
            .map((u: any) => ({
              id: u.id,
              username: u.username,
              full_name: u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username,
              badge_number: u.badge_number,
              role: u.role,
              status: u.status,
            }))
            .sort((a: CachedUser, b: CachedUser) => a.full_name.localeCompare(b.full_name));
          setEmployees(active);
          // Auto-select current user if available
          const currentId = localStorage.getItem('rmpg_offline_user_id');
          if (currentId && active.find((u: CachedUser) => String(u.id) === currentId)) {
            setSelectedUserId(currentId);
          } else if (active.length === 1) {
            setSelectedUserId(String(active[0].id));
          }
        })
        .catch(() => {
          // If IndexedDB read fails, user can still try without dropdown
        })
        .finally(() => setLoadingEmployees(false));
    }
  }, [isOpen]);

  // Focus first input on open (after employee selected)
  useEffect(() => {
    if (isOpen) {
      setDigits(['', '', '', '', '', '']);
      setError(null);
      setAttemptsRemaining(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  // Focus first digit when employee is selected
  useEffect(() => {
    if (selectedUserId) {
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [selectedUserId]);

  const handleEmployeeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const userId = e.target.value;
    setSelectedUserId(userId);
    setError(null);
    setDigits(['', '', '', '', '', '']);

    // Store selected user ID AND role for PIN validation context
    if (userId) {
      const emp = employees.find(em => String(em.id) === userId);
      setConfig('current_user_id', userId).catch((err) => { console.warn('[PinEntryModal] set current_user_id config failed:', err); });
      if (emp?.role) {
        setConfig('current_user_role', emp.role).catch((err) => { console.warn('[PinEntryModal] set current_user_role config failed:', err); });
      }
      localStorage.setItem('rmpg_offline_user_id', userId);
    }
  }, [employees]);

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

  const isSelectedAdmin = employees.find(em => String(em.id) === selectedUserId)?.role === 'admin';

  const handleSubmit = useCallback(async () => {
    if (!selectedUserId && employees.length > 0) {
      setError('Select your name from the dropdown');
      return;
    }

    const pin = digits.join('');
    // Admin users don't need a PIN — the server-side validatePin() returns success for admins
    if (!isSelectedAdmin && pin.length !== 6) {
      setError('Enter all 6 digits');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // For admin: any PIN value works (validatePin returns success for admin role)
      const result = await enterPin(isSelectedAdmin ? '000000' : pin);

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
  }, [digits, enterPin, onClose, onSuccess, selectedUserId, employees.length]);

  // Auto-submit when all 6 digits entered
  useEffect(() => {
    if (digits.every(d => d !== '') && !submitting && (selectedUserId || employees.length === 0)) {
      handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  if (!isOpen) return null;

  const selectedEmployee = employees.find(e => String(e.id) === selectedUserId);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', zIndex: 99998, touchAction: 'manipulation' }}
      role="dialog"
      aria-modal="true"
      aria-label="Offline authorization PIN entry"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4"
        style={{
          background: '#0a0a0a',
          border: '1px solid #1e3048',
          borderTop: '3px solid #d97706',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-bold text-white">Offline Authorization</span>
          </div>
          <button type="button"
            onClick={onClose}
            className="p-2 sm:p-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-rmpg-400 hover:text-white transition-colors"
            style={{ touchAction: 'manipulation' }}
            aria-label="Close">
            <X className="w-5 h-5 sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-rmpg-300 text-center leading-relaxed">
            {isSelectedAdmin
              ? 'Admin accounts have full offline access. Press authorize below.'
              : 'Internet is unavailable. Select your name and enter your 6-digit PIN to authorize offline access.'}
          </p>

          {/* Employee Dropdown */}
          {employees.length > 0 && (
            <div>
              <label
                className="block text-[10px] font-bold uppercase mb-1 tracking-wide"
                style={{ color: '#888888' }}
              >
                <User className="w-3 h-3 inline-block mr-1 -mt-0.5" />
                Employee
              </label>
              <div className="relative">
                <select
                  value={selectedUserId}
                  onChange={handleEmployeeChange}
                  disabled={submitting || loadingEmployees}
                  className="w-full h-9 pl-3 pr-8 text-sm text-white appearance-none cursor-pointer focus:outline-none"
                  style={{
                    background: '#0d0d0d',
                    border: `1px solid ${!selectedUserId ? '#d97706' : '#2e2e2e'}`,
                    borderRadius: 0,
                  }}
                >
                  <option value="">— Select Employee —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={String(emp.id)}>
                      {emp.full_name}
                      {emp.badge_number ? ` (${emp.badge_number})` : ''}
                      {emp.role === 'admin' ? ' — Admin' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                  style={{ color: '#666666' }}
                />
              </div>
              {selectedEmployee && (
                <div className="flex items-center gap-1.5 mt-1">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: '#4ade80' }}
                  />
                  <span className="text-[9px] uppercase tracking-wide" style={{ color: '#4ade80' }}>
                    {(selectedEmployee.role || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} — Badge {selectedEmployee.badge_number || 'N/A'}
                  </span>
                </div>
              )}
            </div>
          )}

          {loadingEmployees && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
              <span className="text-[10px] text-rmpg-400">Loading employees...</span>
            </div>
          )}

          {/* PIN Input Grid — hidden for admin (no PIN required) */}
          {!isSelectedAdmin && (
            <div className="flex justify-center gap-2">
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  aria-label={`PIN digit ${i + 1}`}
                  onChange={e => handleChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  onPaste={i === 0 ? handlePaste : undefined}
                  disabled={submitting || (!selectedUserId && employees.length > 0)}
                  className="w-11 h-13 text-center text-2xl font-mono font-bold text-white transition-colors focus:outline-none disabled:opacity-40"
                  style={{
                    background: '#0d0d0d',
                    border: `2px solid ${error ? '#dc2626' : digit ? '#d97706' : '#2e2e2e'}`,
                    caretColor: '#d97706',
                  }}
                />
              ))}
            </div>
          )}

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
          <button type="button"
            onClick={handleSubmit}
            disabled={submitting || (!isSelectedAdmin && digits.some(d => d === '')) || (!selectedUserId && employees.length > 0)}
            className="btn-primary w-full justify-center"
            style={{ borderColor: '#d97706', background: submitting ? '#3a3a3a' : undefined }}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying...
              </>
            ) : isSelectedAdmin ? (
              'Authorize (Admin — No PIN Required)'
            ) : (
              'Authorize Offline Access'
            )}
          </button>

          {!isSelectedAdmin && (
            <p className="text-[9px] text-rmpg-500 text-center">
              Contact your administrator for a PIN. Authorization lasts 24 hours.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
