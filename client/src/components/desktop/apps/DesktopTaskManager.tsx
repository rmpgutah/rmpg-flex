import React, { useState, useEffect } from 'react';
import { X, Monitor, Users, Layers } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { useDesktopWindows } from '../DesktopWindowManager';
import { useAuth } from '../../../context/AuthContext';
import { apiFetch } from '../../../hooks/useApi';
import { sessionsToCsv, downloadTextFile } from '../../../utils/rmsListExport';
import { copyToClipboard } from '../../../utils/contextMenuActions';
import { safeTimeStr } from '../../../utils/dateUtils';

interface ActiveSession {
  id: number;
  user_id: number;
  username: string;
  role: string;
  last_active?: string;
}

interface DesktopTaskManagerProps {
  onClose: () => void;
}

type TabId = 'windows' | 'sessions' | 'system';

const W = 600;
const H = 500;

export default function DesktopTaskManager({ onClose }: DesktopTaskManagerProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [tab, setTab] = useState<TabId>('windows');
  const { windows, closeWindow, focusWindow } = useDesktopWindows();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessLoading] = useState(false);
  const [windowQuery, setWindowQuery] = useState('');

  useEffect(() => {
    if (tab !== 'sessions' || !isAdmin) return;
    setSessLoading(true);
    apiFetch<ActiveSession[]>('/admin/active-sessions')
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setSessLoading(false));
  }, [tab, isAdmin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleForceSignOut = (sessionId: number) => {
    apiFetch(`/admin/sessions/${sessionId}`, { method: 'DELETE' })
      .then(() => setSessions(s => s.filter(x => x.id !== sessionId)))
      .catch(() => {});
  };

  const [openDurations] = useState<Record<string, number>>(() => {
    const now = Date.now();
    return Object.fromEntries(windows.map(w => [w.id, now]));
  });

  const elapsed = (id: string) => {
    const start = openDurations[id] ?? Date.now();
    const secs = Math.floor((Date.now() - start) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  const baseStyle: React.CSSProperties = {
    position: 'fixed',
    left: pos.x,
    top: pos.y,
    width: W,
    height: H,
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-default)',
    borderRadius: 2,
    boxShadow: '0 8px 32px var(--window-shadow)',
    zIndex: 20100,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 11,
    fontWeight: active ? 700 : 400,
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid var(--desktop-shell-accent, var(--accent-silver-400))' : '2px solid transparent',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  });

  return (
    <div style={baseStyle}>
      {/* Title bar */}
      <div
        onPointerDown={onPointerDown}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}
      >
        <Monitor size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>Task Manager</span>
        <button
          aria-label="Close Task Manager"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-default)', background: 'var(--surface-base)', flexShrink: 0 }}>
        <button style={tabStyle(tab === 'windows')} onClick={() => setTab('windows')}><Layers size={11} style={{ display: 'inline', marginRight: 4 }} />Windows</button>
        {isAdmin && <button style={tabStyle(tab === 'sessions')} onClick={() => setTab('sessions')}><Users size={11} style={{ display: 'inline', marginRight: 4 }} />Sessions</button>}
        <button style={tabStyle(tab === 'system')} onClick={() => setTab('system')}><Monitor size={11} style={{ display: 'inline', marginRight: 4 }} />System</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {tab === 'windows' && (
          <>
            <input
              value={windowQuery}
              onChange={(e) => setWindowQuery(e.target.value)}
              placeholder="Search windows…"
              aria-label="Search windows"
              style={{ width: '100%', marginBottom: 8, fontSize: 11, padding: '4px 8px', borderRadius: 2, border: '1px solid var(--border-default)', background: 'var(--surface-sunken)', color: 'var(--text-primary)' }}
            />
          {windows.filter((w) => {
            const q = windowQuery.trim().toLowerCase();
            if (!q) return true;
            return w.title.toLowerCase().includes(q) || w.path.toLowerCase().includes(q);
          }).length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>
              {windows.length === 0
                ? 'No module windows open — open a CAD module from the Start menu to see it tracked here'
                : 'No windows match the search'}
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-default)' }}>Title</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-default)' }}>Path</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-default)' }}>Open</th>
                  <th style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-default)' }}></th>
                  <th style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-default)' }}></th>
                </tr>
              </thead>
              <tbody>
                {windows.filter((w) => {
                  const q = windowQuery.trim().toLowerCase();
                  if (!q) return true;
                  return w.title.toLowerCase().includes(q) || w.path.toLowerCase().includes(q);
                }).map(w => (
                  <tr key={w.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={{ padding: '4px 8px', color: 'var(--text-primary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--text-muted)', fontFamily: 'Arial, sans-serif', fontSize: 10 }}>{w.path}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{elapsed(w.id)}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <button
                        aria-label={`Focus ${w.title}`}
                        onClick={() => focusWindow(w.id)}
                        style={{ fontSize: 10, padding: '2px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-primary)' }}
                      >Focus</button>
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <button
                        aria-label={`Close ${w.title}`}
                        onClick={() => closeWindow(w.id)}
                        style={{ fontSize: 10, padding: '2px 8px', background: 'none', border: '1px solid var(--border-default)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)' }}
                      >×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </>
        )}

        {tab === 'sessions' && isAdmin && (
          sessionsLoading ? (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>Loading…</p>
          ) : sessions.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>No active sessions</p>
          ) : (
            <>
            <button
              type="button"
              onClick={() => downloadTextFile('sessions.csv', sessionsToCsv(sessions))}
              style={{ fontSize: 10, marginBottom: 8, padding: '3px 8px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
            >CSV</button>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-default)' }}>User</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-default)' }}>Role</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-default)' }}>Last Active</th>
                  <th style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-default)' }}></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={{ padding: '4px 8px', color: 'var(--text-primary)' }}>
                      {s.username}
                      <button type="button" aria-label={`Copy ${s.username}`} onClick={() => void copyToClipboard(s.username)} style={{ marginLeft: 8, fontSize: 9, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Copy</button>
                    </td>
                    <td style={{ padding: '4px 8px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{s.role}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{safeTimeStr(s.last_active)}</td>
                    <td style={{ padding: '4px 8px' }}>
                      {s.user_id !== undefined && (
                        <button
                          aria-label={`Force sign out ${s.username}`}
                          onClick={() => handleForceSignOut(s.id)}
                          style={{ fontSize: 10, padding: '2px 8px', background: 'none', border: '1px solid var(--sev-critical)', borderRadius: 2, cursor: 'pointer', color: 'var(--sev-critical)' }}
                        >Force sign out</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )
        )}

        {tab === 'system' && (
          <SystemTab />
        )}
      </div>
    </div>
  );
}

function SystemTab() {
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    apiFetch<{ services?: Record<string, unknown>; system?: Record<string, unknown> }>('/health')
      .then(d => setInfo(d as Record<string, unknown>))
      .catch(() => setInfo(null));
  }, []);

  const rows: [string, string][] = info
    ? Object.entries(info as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        .map(([k, v]) => [k, String(v)])
    : [];

  return (
    <div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>{info === null ? 'Loading…' : 'No system data available'}</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} style={{ borderBottom: '1px solid var(--border-default)' }}>
                <td style={{ padding: '4px 8px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', width: 140, fontWeight: 700 }}>{k}</td>
                <td style={{ padding: '4px 8px', color: 'var(--text-primary)', fontFamily: 'Arial, sans-serif', fontSize: 10 }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
