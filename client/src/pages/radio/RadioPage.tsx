// ──────────────────────────────────────────────────────────────────
// RadioPage — minimal container wiring the leaf components in this
// directory into a live page.
//
// Scope today (2026-05-26):
//   - Fetches channel list from GET /api/radio-channels (legacy route)
//   - Tracks the officer's joined channel via the existing WebSocket
//     subscriptions (radio_channel_state / radio_channel_leave)
//   - Listen-only: PTT, recording, transcription, and the rich console
//     controls implied by ./constants.ts SETTINGS_KEYS are NOT wired up
//     — there is no /api/radio audio backend yet.
//   - Theme + 10-codes panel work locally via localStorage (./helpers.ts)
//
// When the audio backend lands, replace the "LISTEN-ONLY MODE" panel
// with the real transmission feed and add the right-side analytics
// (Sparkline / Heatmap from ./components.tsx).
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

interface RadioChannel {
  id: string;
  label: string;
  freq: string;
  sort_order: number;
}

export default function RadioPage() {
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
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

  // Fetch channels once on mount. Backend returns either an array of
  // channels or a 500 with `{error}`; treat both as "no channels".
  useEffect(() => {
    let cancelled = false;
    setLoadingChannels(true);
    apiFetch<RadioChannel[]>('/radio-channels')
      .then((rows) => { if (!cancelled) setChannels(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setChannels([]); })
      .finally(() => { if (!cancelled) setLoadingChannels(false); });
    return () => { cancelled = true; };
  }, []);

  // Track which channel (if any) the officer has actually joined. The
  // join event comes from the existing Layout subscription path — we
  // mirror the same wire format so this page stays accurate even if the
  // user joined a channel from another tab/window.
  useEffect(() => {
    const unsubJoin = subscribe('radio_channel_state', (msg) => {
      const payload = (msg.data ?? msg) as { radioChannel?: { id?: string } } | undefined;
      setActiveChannelId(payload?.radioChannel?.id ?? null);
    });
    const unsubLeave = subscribe('radio_channel_leave', () => setActiveChannelId(null));
    return () => { unsubJoin(); unsubLeave(); };
  }, [subscribe]);

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
                    <span className="text-[10px] font-mono font-bold tracking-wider truncate">{ch.label}</span>
                    <span className="text-[8px] font-mono" style={{ color: 'var(--rt-muted)' }}>{ch.freq} MHz</span>
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
                icon={<Antenna className="w-4 h-4" style={{ color: 'var(--rt-accent)' }} />}
                color="var(--rt-accent)"
                bg="rgba(212,160,23,0.06)"
              >
                <span style={{ color: 'var(--rt-accent)' }}>SELECTED:</span>
                <span style={{ color: 'var(--rt-text)' }}>{activeChannel.label}</span>
                <Sep />
                <span style={{ color: 'var(--rt-muted)' }}>{activeChannel.freq} MHz</span>
              </Banner>
              <div className="flex-1 flex items-center justify-center px-6 py-12 text-center">
                <div className="max-w-md">
                  <div
                    className="text-sm font-mono font-bold tracking-[0.3em] mb-2"
                    style={{ color: 'var(--rt-text)' }}
                  >
                    LISTEN-ONLY MODE
                  </div>
                  <div className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--rt-muted)' }}>
                    PTT, transcription, and recording are not wired up yet.
                    Channel join/leave events from other clients will appear
                    here as they arrive via WebSocket.
                  </div>
                </div>
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
