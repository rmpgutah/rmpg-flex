import React, { useState, useCallback, useEffect } from 'react';
import { X, Key, Copy, Check, Loader2, AlertCircle, Clock } from 'lucide-react';
import { useOfflineMode } from '../hooks/useOfflineMode';
import { toDisplayLabel } from '../utils/formatters';
import type { User } from '../types';

interface PinGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-populated list of employees (non-admin users) */
  users: User[];
}

/**
 * Admin-only modal for generating 6-digit offline PINs for employees.
 * The generated PIN is displayed large on screen for the admin to read
 * over the phone to the field employee.
 */
export default function PinGeneratorModal({ isOpen, onClose, users }: PinGeneratorModalProps) {
  const { generatePin } = useOfflineMode();

  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedPin, setGeneratedPin] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedUserId('');
      setGenerating(false);
      setError(null);
      setGeneratedPin(null);
      setExpiresAt(null);
      setCopied(false);
    }
  }, [isOpen]);

  const handleGenerate = useCallback(async () => {
    if (!selectedUserId) {
      setError('Select an employee first');
      return;
    }

    setGenerating(true);
    setError(null);
    setGeneratedPin(null);

    try {
      const result = await generatePin(selectedUserId);

      if (result.error) {
        setError(result.error);
      } else {
        setGeneratedPin(result.pin);
        setExpiresAt(result.expiresAt || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate PIN');
    } finally {
      setGenerating(false);
    }
  }, [selectedUserId, generatePin]);

  const handleCopy = useCallback(() => {
    if (!generatedPin) return;
    navigator.clipboard.writeText(generatedPin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* silent */ });
  }, [generatedPin]);

  // Filter to non-admin employees
  const employees = users.filter(u => u.role !== 'admin' && u.is_active);

  // Format expiry for display
  let expiryDisplay = '';
  if (expiresAt) {
    try {
      const dt = new Date(expiresAt);
      expiryDisplay = dt.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });
    } catch {
      expiryDisplay = expiresAt;
    }
  }

  const selectedUser = employees.find(u => String(u.id) === selectedUserId);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', zIndex: 99998 }}
    >
      <div
        className="w-full max-w-md mx-4"
        style={{
          background: '#141e2b',
          border: '1px solid #1e3048',
          borderTop: '3px solid #d97706',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-bold text-white">Generate Offline PIN</span>
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
          {/* Employee selector */}
          <div>
            <label className="field-label">Employee</label>
            <select
              value={selectedUserId}
              onChange={e => {
                setSelectedUserId(e.target.value);
                setGeneratedPin(null);
                setError(null);
              }}
              className="input-dark w-full"
            >
              <option value="">Select an employee...</option>
              {employees.map(u => (
                <option key={u.id} value={u.id}>
                  {u.last_name?.toUpperCase()}, {u.first_name}
                  {u.badge_number ? ` — #${u.badge_number}` : ''}
                  {` (${toDisplayLabel(u.role)})`}
                </option>
              ))}
            </select>
          </div>

          {/* Generate button */}
          {!generatedPin && (
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedUserId}
              className="btn-primary w-full justify-center"
              style={{ borderColor: '#d97706' }}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  Generate PIN
                </>
              )}
            </button>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs bg-red-900/30 border border-red-700/50 text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Generated PIN display */}
          {generatedPin && (
            <div className="space-y-3">
              {/* Employee name badge */}
              <div className="text-center text-xs text-rmpg-300">
                PIN for{' '}
                <span className="font-bold text-white">
                  {selectedUser?.first_name} {selectedUser?.last_name}
                </span>
              </div>

              {/* Large PIN display */}
              <div
                className="flex justify-center gap-2 py-4 cursor-pointer"
                onClick={handleCopy}
                title="Click to copy"
              >
                {generatedPin.split('').map((digit, i) => (
                  <div
                    key={i}
                    className="w-14 h-16 flex items-center justify-center text-3xl font-mono font-bold text-amber-400"
                    style={{
                      background: '#0d0d0d',
                      border: '2px solid #d97706',
                    }}
                  >
                    {digit}
                  </div>
                ))}
              </div>

              {/* Copy button */}
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 mx-auto px-3 py-1.5 text-xs transition-colors"
                style={{
                  background: copied ? 'rgba(34, 197, 94, 0.15)' : '#182840',
                  border: `1px solid ${copied ? '#22c55e' : '#2a3e58'}`,
                  color: copied ? '#22c55e' : '#888',
                }}
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>

              {/* Expiry info */}
              {expiryDisplay && (
                <div className="flex items-center justify-center gap-1.5 text-[10px] text-rmpg-400 font-mono">
                  <Clock className="w-3 h-3" />
                  Expires: {expiryDisplay}
                </div>
              )}

              {/* Instructions */}
              <div
                className="px-3 py-2 text-[10px] text-amber-400/80 leading-relaxed"
                style={{ background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.2)' }}
              >
                <strong>Read this PIN to the employee over the phone.</strong>
                <br />
                It authorizes 24 hours of offline data entry and cannot be recovered once this dialog is closed.
              </div>

              {/* Generate another */}
              <button
                onClick={() => {
                  setGeneratedPin(null);
                  setExpiresAt(null);
                  setSelectedUserId('');
                  setCopied(false);
                }}
                className="text-xs text-rmpg-400 hover:text-white transition-colors mx-auto block underline"
              >
                Generate for another employee
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
