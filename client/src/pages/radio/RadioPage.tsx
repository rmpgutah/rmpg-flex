// ──────────────────────────────────────────────────────────────────
// RadioPage — container wiring the leaf components in this directory
// into a live page backed by the /api/radio/* subsystem.
//
// Scope as of PR #661:
//   - Channels: GET /api/radio/channels (real backend; supports
//     soft-delete + sort_order + per-channel color).
//   - Channel-join state: still listens to WS radio_channel_state /
//     radio_channel_leave events from existing infra (other clients can
//     drive channel-join from MDT panels).
//   - Live transmission feed: subscribes to WS 'radio_update' with
//     action='transmission_logged' to surface new tx in real time.
//   - Recordings (bookmarks) are exposed via /api/radio/recordings — UI
//     for them is deferred to a follow-up commit.
//   - PTT, audio capture, and transcription remain backend concerns
//     handled outside this page.
//
// Theme + 10-codes panel are local UI sugar via localStorage (./helpers).
// ──────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { Antenna, Radio as RadioIcon, Settings, BookOpen } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useWebSocket } from '../../context/WebSocketContext';
import PanelTitleBar from '../../components/PanelTitleBar';
import {
  Banner, EmptyConsole, ModeToggle, SectionHeader, Sep, Stat, ToolbarBtn,
} from './components';
import {
  TEN_CODES, STATUS_QUICKSET, THEMES, THEME_VARS, type Theme,
} from './constants';
import { ls } from './helpers';

// Shape returned by GET /api/radio/channels (src/routes/radio.ts).
interface RadioChannel {
  id: number;
  name: string;
  description: string | null;
  frequency: string | null;
  talkgroup: string | null;
  color: string | null;
  is_default: number;
  sort_order: number;
  archived_at: string | null;
}

// Shape returned by GET /api/radio/transmissions (joined with users + channel).
interface RadioTransmission {
  id: number;
  channel_id: number | null;
  user_id: number | null;
  unit_label: string | null;
  transmitted_at: string;
  duration_seconds: number;
  transcript: string | null;
  audio_url: string | null;
  priority: number;
  user_name?: string | null;
  channel_name?: string | null;
  channel_color?: string | null;
}

export default function RadioPage() {
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [transmissions, setTransmissions] = useState<RadioTransmission[]>([]);
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = ls.get('radio_theme') as Theme | null;
    return stored && (THEMES as readonly string[]).includes(stored) ? stored : 'onyx';
  });
  const [showCodes, setShowCodes] = useState<boolean>(() => ls.get('radio_show_codes') === '1');
  const { subscribe, isConnected } = useWebSocket();
  const containerRef = useRef<HTMLDivElement>(null);

  // Apply theme CSS vars scoped to this container — the leaf components
  // all read from var(--rt-*), so this is the only place that needs to
  // know about THEME_VARS.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    for (const [k, v] of Object.entries(THEME_VARS[theme])) {
      root.style.setProperty(k, v);
    }
    ls.set('radio_theme', theme);
  }, [theme]);

  useEffect(() => { ls.set('radio_show_codes', showCodes ? '1' : '0'); }, [showCodes]);

  // Fetch active channels once on mount. The new endpoint excludes
  // archived rows server-side (use include_archived=true for admin views).
  // Auto-selects the channel marked is_default so the page is usable
  // without a manual pick on first load.
  useEffect(() => {
    let cancelled = false;
    setLoadingChannels(true);
    apiFetch<RadioChannel[]>('/radio/channels')
      .then((rows) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        setChannels(list);
        // Auto-select the default channel if there isn't one selected yet.
        setActiveChannelId((prev) => {
          if (prev != null) return prev;
          const def = list.find(c => c.is_default === 1);
          return def?.id ?? list[0]?.id ?? null;
        });
      })
      .catch(() => { if (!cancelled) setChannels([]); })
      .finally(() => { if (!cancelled) setLoadingChannels(false); });
    return () => { cancelled = true; };
  }, []);

  // Pull the recent transmission feed for the selected channel. Refetches
  // when the user picks a different channel.
  useEffect(() => {
    if (activeChannelId == null) { setTransmissions([]); return; }
    let cancelled = false;
    apiFetch<RadioTransmission[]>(`/radio/transmissions?channel_id=${activeChannelId}&limit=50`)
      .then((rows) => { if (!cancelled) setTransmissions(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setTransmissions([]); });
    return () => { cancelled = true; };
  }, [activeChannelId]);

  // Track which channel (if any) the officer has joined via the existing
  // WebSocket plumbing — kept so a join initiated from MDT (or another
  // tab) is reflected here. Channel-join is separate from "I'm viewing
  // this channel"; the latter is the user's local pick.
  useEffect(() => {
    const unsubJoin = subscribe('radio_channel_state', (msg) => {
      const payload = (msg.data ?? msg) as { radioChannel?: { id?: number | string } } | undefined;
      const id = payload?.radioChannel?.id;
      setActiveChannelId(id != null ? Number(id) : null);
    });
    const unsubLeave = subscribe('radio_channel_leave', () => setActiveChannelId(null));
    return () => { unsubJoin(); unsubLeave(); };
  }, [subscribe]);

  // Live tx feed via WS — when a new transmission lands on the channel
  // we're viewing, prepend it. Matches the broadcastAll('radio_update')
  // shape emitted by src/routes/radio.ts.
  useEffect(() => {
    const unsub = subscribe('radio_update', (msg) => {
      const payload = (msg.data ?? msg) as {
        action?: string; transmission?: RadioTransmission;
      } | undefined;
      if (payload?.action !== 'transmission_logged' || !payload.transmission) return;
      // Only prepend if it's for the channel we're currently viewing —
      // otherwise the user gets noise from chatter on unrelated channels.
      setTransmissions(prev =>
        payload.transmission!.channel_id === activeChannelId
          ? [payload.transmission!, ...prev].slice(0, 50)
          : prev,
      );
    });
    return () => unsub();
  }, [subscribe, activeChannelId]);

  const activeChannel = channels.find(c => c.id === activeChannelId) || null;

  return (
    <div ref={containerRef} className="flex flex-col h-full" style={{ background: 'var(--rt-bg, #0a0a0a)' }}>
      <PanelTitleBar title="RADIO" icon={RadioIcon} />

      {/* Toolbar — theme switcher + 10-codes toggle + status indicator */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 flex-wrap"
        style={{ background: 'var(--rt-panel)', borderBottom: '1px solid var(--rt-border)' }}
      >
        <ToolbarBtn
          onClick={() => setShowCodes(s => !s)}
          active={showCodes}
          title="Toggle 10-codes reference panel"
        >
          <BookOpen className="w-3 h-3" /> 10-CODES
        </ToolbarBtn>
        <Sep />
        <span className="text-[9px] font-mono tracking-wider" style={{ color: 'var(--rt-muted)' }}>THEME</span>
        {THEMES.map(t => (
          <ModeToggle
            key={t}
            active={theme === t}
            onClick={() => setTheme(t)}
            icon={null}
            label={t.toUpperCase()}
          />
        ))}
        <div className="flex-1" />
        <Stat label="CHANNELS" value={String(channels.length)} />
        <Stat label="LINK" value={isConnected ? 'ONLINE' : 'OFFLINE'} />
      </div>

      {/* Body: 3-column layout — channel list | console | side panel */}
      <div className="flex-1 grid grid-cols-[240px_1fr_240px] min-h-0">
        {/* Channels */}
        <div className="flex flex-col border-r min-h-0" style={{ borderColor: 'var(--rt-border)' }}>
          <SectionHeader icon={<Antenna className="w-3 h-3" style={{ color: 'var(--rt-accent)' }} />} label="CHANNELS" />
          <div className="flex-1 overflow-auto">
            {loadingChannels && (
              <div className="px-3 py-2 text-[10px] font-mono" style={{ color: 'var(--rt-muted)' }}>Loading…</div>
            )}
            {!loadingChannels && channels.length === 0 && (
              <div className="px-3 py-3 text-[10px] font-mono leading-relaxed" style={{ color: 'var(--rt-muted)' }}>
                No channels available.
                <br />
                Configure radio channels in Admin → Radio Channels.
              </div>
            )}
            {channels.map(ch => {
              const isActive = ch.id === activeChannelId;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setActiveChannelId(ch.id)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-left"
                  style={{
                    background: isActive ? 'rgba(212,160,23,0.10)' : 'transparent',
                    borderBottom: '1px solid var(--rt-border)',
                    color: isActive ? 'var(--rt-accent)' : 'var(--rt-text)',
                  }}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-mono font-bold tracking-wider truncate" style={ch.color ? { color: ch.color } : undefined}>
                      {ch.name}
                      {ch.is_default === 1 && <span className="ml-1 text-[8px] opacity-60">★</span>}
                    </span>
                    <span className="text-[8px] font-mono" style={{ color: 'var(--rt-muted)' }}>
                      {ch.frequency || ch.talkgroup || '—'}
                    </span>
                  </div>
                  {isActive && <Antenna className="w-3 h-3 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Console */}
        <div className="flex flex-col min-h-0">
          {activeChannel ? (
            <>
              <Banner
                icon={<Antenna className="w-4 h-4" style={{ color: activeChannel.color || 'var(--rt-accent)' }} />}
                color={activeChannel.color || 'var(--rt-accent)'}
                bg="rgba(212,160,23,0.06)"
              >
                <span style={{ color: activeChannel.color || 'var(--rt-accent)' }}>SELECTED:</span>
                <span style={{ color: 'var(--rt-text)' }}>{activeChannel.name}</span>
                <Sep />
                <span style={{ color: 'var(--rt-muted)' }}>
                  {activeChannel.frequency || activeChannel.talkgroup || '—'}
                </span>
              </Banner>
              {/* Live transmission feed for this channel — newest first.
                  WS `radio_update` (action='transmission_logged') prepends
                  new tx in real time. */}
              <div className="flex-1 overflow-auto">
                {transmissions.length === 0 ? (
                  <div className="flex items-center justify-center px-6 py-12 text-center h-full">
                    <div className="max-w-md">
                      <div className="text-sm font-mono font-bold tracking-[0.3em] mb-2" style={{ color: 'var(--rt-text)' }}>
                        NO TRANSMISSIONS YET
                      </div>
                      <div className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--rt-muted)' }}>
                        Waiting for radio chatter on this channel. New
                        transmissions will appear here as they arrive.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    {transmissions.map((tx) => (
                      <div
                        key={tx.id}
                        className="border-b px-3 py-2"
                        style={{ borderColor: 'var(--rt-border)' }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {tx.priority > 0 && (
                            <span
                              className="text-[8px] font-mono font-bold px-1.5 py-0.5"
                              style={{
                                color: tx.priority >= 2 ? '#ef4444' : '#f59e0b',
                                border: `1px solid ${tx.priority >= 2 ? '#ef4444' : '#f59e0b'}55`,
                              }}
                            >
                              {tx.priority >= 2 ? 'EMERGENCY' : 'URGENT'}
                            </span>
                          )}
                          <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--rt-text)' }}>
                            {tx.unit_label || tx.user_name || `User ${tx.user_id ?? '?'}`}
                          </span>
                          <span className="text-[9px] font-mono ml-auto" style={{ color: 'var(--rt-muted)' }}>
                            {tx.transmitted_at.slice(11, 19)} · {tx.duration_seconds.toFixed(1)}s
                          </span>
                        </div>
                        {tx.transcript && (
                          <div className="text-[10px] font-mono leading-snug" style={{ color: 'var(--rt-muted)' }}>
                            {tx.transcript}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <EmptyConsole isConnected={isConnected} channels={channels.length} />
          )}
        </div>

        {/* Side panel — status quickset + (optional) 10-codes reference */}
        <div className="flex flex-col border-l min-h-0" style={{ borderColor: 'var(--rt-border)' }}>
          <SectionHeader icon={<Settings className="w-3 h-3" style={{ color: 'var(--rt-accent)' }} />} label="STATUS" />
          <div className="grid grid-cols-2 gap-1 p-2">
            {STATUS_QUICKSET.map(s => (
              <button
                key={s.code}
                type="button"
                className="px-2 py-1.5 text-left"
                style={{ border: `1px solid ${s.color}55`, background: 'transparent' }}
                title={`${s.code} — ${s.label}`}
              >
                <div className="text-[10px] font-mono font-bold tracking-wider" style={{ color: s.color }}>
                  {s.code}
                </div>
                <div className="text-[8px] font-mono" style={{ color: 'var(--rt-muted)' }}>
                  {s.label}
                </div>
              </button>
            ))}
          </div>
          {showCodes && (
            <>
              <SectionHeader icon={<BookOpen className="w-3 h-3" style={{ color: 'var(--rt-accent)' }} />} label="10-CODES" />
              <div className="flex-1 overflow-auto">
                {TEN_CODES.map(c => (
                  <div
                    key={c.code}
                    className="px-3 py-1 text-[9px] font-mono flex justify-between"
                    style={{ borderBottom: '1px solid var(--rt-border)' }}
                  >
                    <span style={{ color: 'var(--rt-accent)' }}>{c.code}</span>
                    <span className="text-right" style={{ color: 'var(--rt-muted)' }}>{c.meaning}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
