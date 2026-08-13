import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Mail, MessageCircle } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface CommUnreadCount {
  total: number;
  urgent: number;
  from_dispatch?: number;
}

interface EmailUnreadCount {
  count: number;
}

interface MessageState {
  total: number;
  urgent: number;
  dispatch: number;
  email: number;
  loading: boolean;
  error: boolean;
}

const COMM_INTERVAL_MS = 30_000;
const EMAIL_INTERVAL_MS = 60_000;

export default function DesktopMessageCountWidget() {
  const navigate = useNavigate();
  const [state, setState] = useState<MessageState>({
    total: 0,
    urgent: 0,
    dispatch: 0,
    email: 0,
    loading: true,
    error: false,
  });

  const fetchComm = useCallback(async () => {
    try {
      const data = await apiFetch<CommUnreadCount>('/comms/unread-count');
      setState(prev => ({
        ...prev,
        total: (data.total ?? 0) + prev.email,
        urgent: data.urgent ?? 0,
        dispatch: data.from_dispatch ?? 0,
        loading: false,
        error: false,
      }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: true }));
    }
  }, []);

  const fetchEmail = useCallback(async () => {
    try {
      const data = await apiFetch<EmailUnreadCount>('/email/unread-count');
      setState(prev => ({
        ...prev,
        email: data.count ?? 0,
        total: prev.total - prev.email + (data.count ?? 0),
      }));
    } catch {
      // email polling failure is non-critical
    }
  }, []);

  useEffect(() => {
    fetchComm();
    fetchEmail();
    const commTimer = setInterval(fetchComm, COMM_INTERVAL_MS);
    const emailTimer = setInterval(fetchEmail, EMAIL_INTERVAL_MS);
    return () => {
      clearInterval(commTimer);
      clearInterval(emailTimer);
    };
  }, [fetchComm, fetchEmail]);

  const allClear = !state.loading && !state.error && state.total === 0;
  const hasUrgent = state.urgent > 0;

  const badgeColor = hasUrgent
    ? 'var(--sev-critical)'
    : allClear
    ? 'var(--sev-ok)'
    : 'var(--brand-400)';

  const badgeBg = hasUrgent
    ? 'rgba(var(--sev-critical-rgb, 220,38,38), 0.18)'
    : allClear
    ? 'rgba(var(--sev-ok-rgb, 34,197,94), 0.15)'
    : 'rgba(var(--brand-400-rgb, 96,165,250), 0.15)';

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '2px',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        minWidth: '180px',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      title="Open Communications"
      onClick={() => navigate('/communications')}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Mail size={13} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--panel-header-color, var(--text-secondary))',
            textTransform: 'uppercase',
          }}
        >
          Messages
        </span>
      </div>

      {/* Badge + count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* iOS-style badge circle */}
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            background: badgeBg,
            border: `1.5px solid ${badgeColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            animation: hasUrgent ? 'rmpg-pulse 1.4s ease-in-out infinite' : 'none',
          }}
        >
          {allClear ? (
            <MessageCircle size={16} style={{ color: badgeColor }} />
          ) : (
            <span
              style={{
                fontSize: state.total >= 100 ? '10px' : '14px',
                fontWeight: 700,
                color: badgeColor,
                lineHeight: 1,
              }}
            >
              {state.loading ? '—' : state.total >= 100 ? '99+' : state.total}
            </span>
          )}
        </div>

        {/* Status text */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {allClear ? (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--sev-ok)',
              }}
            >
              All clear
            </span>
          ) : state.error ? (
            <span style={{ fontSize: '10px', color: 'var(--sev-warn)' }}>Unavailable</span>
          ) : (
            <>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: hasUrgent ? 'var(--sev-critical)' : 'var(--text-primary)',
                  lineHeight: 1,
                }}
              >
                {state.loading ? '—' : state.total} unread
              </span>
            </>
          )}
        </div>
      </div>

      {/* Sub-breakdown */}
      {!allClear && !state.error && !state.loading && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '5px',
          }}
        >
          {state.dispatch > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--brand-300)', fontWeight: 600 }}>{state.dispatch}</span>
              {' dispatch'}
            </span>
          )}
          {state.urgent > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--sev-critical)', fontWeight: 600 }}>{state.urgent}</span>
              {' urgent'}
            </span>
          )}
          {state.email > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{state.email}</span>
              {' email'}
            </span>
          )}
        </div>
      )}

      {/* Click hint */}
      <div
        style={{
          fontSize: '9px',
          color: 'var(--text-muted, var(--text-secondary))',
          letterSpacing: '0.04em',
          opacity: 0.7,
        }}
      >
        Open Communications
      </div>

      <style>{`
        @keyframes rmpg-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(var(--sev-critical-rgb, 220,38,38), 0.4); }
          50% { opacity: 0.85; box-shadow: 0 0 0 5px rgba(var(--sev-critical-rgb, 220,38,38), 0); }
        }
      `}</style>
    </div>
  );
}
