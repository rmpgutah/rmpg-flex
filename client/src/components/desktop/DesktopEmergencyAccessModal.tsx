// ============================================================
// RMPG FlexOS — Emergency Access Override Modal
// Activated by Ctrl+Alt+Shift+F12 from Lock Screen / Kiosk
// Allows supervisor emergency unlock & diagnostic audit log
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { AlertOctagon, ShieldAlert, Key, X, CheckCircle2, Lock, Terminal } from 'lucide-react';
import { verifyOfflinePin } from '../../utils/DesktopOfflineAuthVault';

interface EmergencyAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEmergencyUnlock: (reason: string, supervisorName: string) => void;
}

export default function DesktopEmergencyAccessModal({ isOpen, onClose, onEmergencyUnlock }: EmergencyAccessModalProps) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('Tactical Duty Override / Network Disconnection');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [auditLog, setAuditLog] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError('');
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      const logEntry = `[${new Date().toISOString()}] EMERGENCY_ACCESS_TRIGGERED via Ctrl+Alt+Shift+F12`;
      setAuditLog(prev => [logEntry, ...prev.slice(0, 9)]);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAuthorize = async () => {
    if (pin.length < 4) {
      setError('Enter 4-digit supervisor emergency PIN');
      return;
    }

    setBusy(true);
    setError('');

    try {
      // First try master override code
      if (pin === '5172' || pin === '9999') {
        onEmergencyUnlock(reason, 'Supervisor Zamora (Master Key)');
        return;
      }

      // Try offline vault lookup
      const res = await verifyOfflinePin('zamora', pin);
      if (res.ok) {
        onEmergencyUnlock(reason, `${res.user?.firstName} ${res.user?.lastName}`);
      } else {
        setError('Invalid Emergency Supervisor PIN');
      }
    } catch {
      setError('Emergency auth verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Emergency Access Override"
      aria-modal
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: 'rgba(5, 10, 20, 0.88)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(239, 68, 68, 0.5)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(239, 68, 68, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(90deg, rgba(239,68,68,0.2) 0%, rgba(15,23,42,0.8) 100%)',
            borderBottom: '1px solid rgba(239,68,68,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertOctagon style={{ width: 20, height: 20, color: 'var(--sev-critical)' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                EMERGENCY ACCESS OVERRIDE
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>
                Ctrl+Alt+Shift+F12 Supervisor Bypass Mode
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ padding: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 11, color: 'var(--sev-critical-soft)', lineHeight: 1.5 }}>
            <ShieldAlert style={{ width: 14, height: 14, display: 'inline', marginRight: 6, verticalAlign: -2 }} />
            <strong>AUDITED OPERATION:</strong> Using Emergency Access overrides standard authentication. All actions are logged to local tamper-evident memory and dispatch server.
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Override Reason / Incident ID
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 12,
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(148,163,184,0.3)',
                color: 'var(--text-primary)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Supervisor PIN / Master Emergency Key
            </label>
            <input
              ref={inputRef}
              type="password"
              maxLength={8}
              value={pin}
              onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAuthorize()}
              placeholder="Enter PIN (e.g. 5172)"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 20,
                letterSpacing: '0.4em',
                textAlign: 'center',
                background: 'rgba(0,0,0,0.5)',
                border: error ? '1px solid var(--sev-critical)' : '1px solid rgba(59,130,246,0.5)',
                color: 'var(--text-primary)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{ fontSize: 11, color: 'var(--sev-critical)', textAlign: 'center', fontWeight: 600 }}>
              {error}
            </div>
          )}

          {/* Audit trail */}
          <div>
            <div style={{ fontSize: 9, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Terminal style={{ width: 10, height: 10 }} /> Audit Log Snapshot
            </div>
            <div style={{ background: 'var(--surface-overlay)', padding: 8, fontSize: 9, fontFamily: 'Arial, sans-serif', color: '#10b981', height: 48, overflowY: 'auto', border: '1px solid var(--border-subtle)' }}>
              {auditLog.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '10px 0',
                fontSize: 12,
                background: 'rgba(148,163,184,0.1)',
                border: '1px solid rgba(148,163,184,0.2)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAuthorize}
              disabled={busy}
              style={{
                flex: 2,
                padding: '10px 0',
                fontSize: 12,
                fontWeight: 700,
                background: 'var(--sev-critical)',
                border: 'none',
                color: 'var(--text-primary)',
                cursor: busy ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Key style={{ width: 14, height: 14 }} /> Authorize Emergency Access
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
