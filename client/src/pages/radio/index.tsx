// ──────────────────────────────────────────────────────────────────
// RadioPage — top-level shell for the 6-tab radio console.
// Tabs: Live · Channels · Recordings · References · Stats · Settings.
// Theme is driven by --rt-* CSS vars (see THEME_VARS in constants.ts).
// Tab state persists in localStorage under 'radio_last_page' (key
// already in SETTINGS_KEYS) so a reload lands you on the same tab.
// Keyboard: 1..6 jump to a tab when no input is focused.
// ──────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Radio, Antenna, Bookmark, BookOpen, BarChart3, Settings as SettingsIcon } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { ls } from './helpers';
import { THEME_VARS, type Theme, THEMES, FONT_SCALES, type FontScale } from './constants';
import { TAB_KEYS, TAB_LABELS, type TabKey } from './types';
import LiveTab from './tabs/LiveTab';
import ChannelsTab from './tabs/ChannelsTab';
import RecordingsTab from './tabs/RecordingsTab';
import ReferencesTab from './tabs/ReferencesTab';
import StatsTab from './tabs/StatsTab';
import SettingsTab from './tabs/SettingsTab';

const TAB_ICONS: Record<TabKey, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  live: Antenna,
  channels: Radio,
  recordings: Bookmark,
  references: BookOpen,
  stats: BarChart3,
  settings: SettingsIcon,
};

function isTabKey(v: string | null): v is TabKey {
  return !!v && (TAB_KEYS as string[]).includes(v);
}

export default function RadioPage() {
  const [tab, setTab] = useState<TabKey>(() => {
    const v = ls.get('radio_last_page');
    return isTabKey(v) ? v : 'live';
  });

  const [theme, setTheme] = useState<Theme>(() => {
    const v = ls.get('radio_theme');
    return v && (THEMES as readonly string[]).includes(v) ? (v as Theme) : 'onyx';
  });

  const [fontScale, setFontScale] = useState<FontScale>(() => {
    const v = ls.get('radio_font_scale');
    return v === 'sm' || v === 'lg' ? v : 'md';
  });

  // Selected channel propagates from ChannelsTab → LiveTab via shared state
  // (lives in the page, not a global store — only two tabs care).
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(() => {
    const v = ls.get('radio_pinned_channel');
    return v ? parseInt(v, 10) || null : null;
  });

  useEffect(() => { ls.set('radio_last_page', tab); }, [tab]);
  useEffect(() => { ls.set('radio_theme', theme); }, [theme]);
  useEffect(() => { ls.set('radio_font_scale', fontScale); }, [fontScale]);
  useEffect(() => {
    if (selectedChannelId == null) return;
    ls.set('radio_pinned_channel', String(selectedChannelId));
  }, [selectedChannelId]);

  // Keyboard tab switching — 1..6, suppressed when an input is focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const idx = parseInt(e.key, 10) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < TAB_KEYS.length) {
        setTab(TAB_KEYS[idx]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // CSS-var-based theming — applied to the page root so every --rt-*
  // var resolves correctly inside the leaf components (which all read
  // these vars instead of hardcoded hex).
  const themeStyle = useMemo<React.CSSProperties>(
    () => ({ ...THEME_VARS[theme], fontSize: `${FONT_SCALES[fontScale] * 100}%` } as React.CSSProperties),
    [theme, fontScale],
  );

  return (
    <div className="h-full flex flex-col" style={themeStyle}>
      <PanelTitleBar title="RADIO CONSOLE" icon={Radio} />

      {/* Tab strip — Spillman dark-mode, --rt-* themed.
          aria-selected + role=tab so screenreaders treat the row as
          a real tablist. tab-index swap keeps roving focus correct. */}
      <div role="tablist" aria-label="Radio sections"
        className="flex items-stretch gap-px"
        style={{ background: 'var(--rt-bg)', borderBottom: '1px solid var(--rt-border)' }}>
        {TAB_KEYS.map((k, i) => {
          const Icon = TAB_ICONS[k];
          const active = k === tab;
          return (
            <button key={k} type="button" role="tab" aria-selected={active}
              id={`radio-tab-${k}`} aria-controls={`radio-panel-${k}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(k)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold tracking-[0.2em]"
              style={{
                background: active ? 'var(--rt-panel)' : 'transparent',
                color: active ? 'var(--rt-accent)' : 'var(--rt-muted)',
                borderTop: `2px solid ${active ? 'var(--rt-accent)' : 'transparent'}`,
                borderRight: '1px solid var(--rt-border)',
              }}>
              <Icon className="w-3 h-3" />
              <span>{TAB_LABELS[k]}</span>
              <span className="opacity-50">{i + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Panel area. role=tabpanel is on the inner div so the tab nav
          can target it via aria-controls. Only the active panel is
          mounted — tab switching unmounts the others to keep the
          live-data subscriptions in LiveTab from running in the bg. */}
      <div className="flex-1 min-h-0 overflow-hidden"
        role="tabpanel" id={`radio-panel-${tab}`} aria-labelledby={`radio-tab-${tab}`}
        style={{ background: 'var(--rt-bg)', color: 'var(--rt-text)' }}>
        {tab === 'live' && (
          <LiveTab
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
          />
        )}
        {tab === 'channels' && (
          <ChannelsTab
            selectedChannelId={selectedChannelId}
            onSelectChannel={(id) => { setSelectedChannelId(id); setTab('live'); }}
          />
        )}
        {tab === 'recordings' && <RecordingsTab />}
        {tab === 'references' && <ReferencesTab />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'settings' && (
          <SettingsTab
            theme={theme} onTheme={setTheme}
            fontScale={fontScale} onFontScale={setFontScale}
          />
        )}
      </div>
    </div>
  );
}
