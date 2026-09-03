// ============================================================
// RMPG Flex — Unified Settings (Page 34 of full-app frontend pass)
// Voice (dispatcher persona + alerts), Map (GPS / mapper), and
// Display (day/night theme + font) prefs.
// All controls write to localStorage via existing helpers, so they
// take effect without any server round-trip (voice persona also
// best-effort syncs to /api/voice-persona via useVoicePersona;
// theme + font_scale sync via /api/user/preferences).
//
// Deep-link contract: /settings?section=<id> scrolls the matching
// SectionCard into view on mount and strips the param so a refresh
// doesn't re-trigger the scroll. Section IDs:
//   voice | alerts | tones | ptt | display | map | overlays | gps | markers
//
// Keyboard shortcuts (v1135):
//   N          — admin/manager: trigger "Save as org default"
//   Escape     — cascade: close ConfirmDialog → cancel key capture
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Mic, Map as MapIcon, Volume2, Gauge, SlidersHorizontal,
  Play, RotateCcw, Radio, Crosshair, MapPin, RadioTower,
  Monitor, CheckCircle2, Zap,
} from 'lucide-react';
import {
  playSound, resetToneMap, getSlotSound, setSlotSound,
  SOUND_LIBRARY, TONE_SLOTS, type SoundId,
} from '../utils/dispatchTones';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useVoicePersona } from '../hooks/useVoicePersona';
import { VOICE_CATALOG } from '../utils/voiceCatalog';
import {
  getVoiceAlertsEnabled, setVoiceAlertsEnabled,
  getEventEnabled, setEventEnabled, type VoiceEventCategory,
} from '../utils/voiceAlerts';
import type { AlertSeverity } from '../utils/alertSeverity';
import {
  getMapPreferences, setMapPreferences, resetMapPreferences,
  type MapPreferences,
} from '../utils/mapPreferences';
import { MAP_STYLE_LABELS, MAP_STYLE_DESCRIPTIONS, type MapStyleId } from './map/utils/mapConstants';
import { apiFetch } from '../hooks/useApi';
import { asArray } from '../utils/asArray';
import type { RadioChannel } from './radio/types';
import { getPttPrefs, setPttPrefs, keyCodeLabel, type PttPreferences } from '../utils/pttPreferences';
import { saveAsOrgDefault } from '../utils/settingsSync';
import { useAuth } from '../context/AuthContext';
import {
  applyThemePreference, normalizeThemePreference, writeThemeOverride,
  resolveCurrentTheme, readThemeOverride, isLegacyBlackForced,
  LEGACY_FLAG_KEY, isBlueSilverForced, BLUE_SILVER_FLAG_KEY,
} from '../utils/theme';
import { useUserPreferences } from '../context/UserPreferencesContext';
import AutomationRuleEditor from '../components/AutomationRuleEditor';
import { importWithRetry } from '../utils/importWithRetry';

// ─── Reusable controls ──────────────────────────────────────

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="w-full flex items-center justify-between gap-4 px-3 py-2 text-left border-b border-border-default hover:bg-white/[0.02] transition-colors"
    >
      <span className="min-w-0">
        <span className="block text-[11px] text-rmpg-100">{label}</span>
        {description && <span className="block text-[10px] text-fg-muted mt-0.5">{description}</span>}
      </span>
      <span
        className="shrink-0 w-9 h-5 flex items-center px-0.5 transition-colors"
        style={{ background: checked ? 'var(--brand-gold)' : 'var(--border-default)', borderRadius: 2 }}
      >
        <span
          className="w-4 h-4 transition-transform"
          style={{
            background: 'var(--surface-overlay)',
            borderRadius: 1,
            transform: checked ? 'translateX(16px)' : 'translateX(0)',
          }}
        />
      </span>
    </button>
  );
}

function SliderRow({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="px-3 py-2 border-b border-border-default">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-rmpg-100">{label}</span>
        <span className="text-[10px] font-mono text-fg-muted">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: 'var(--brand-gold)' }}
        aria-label={label}
      />
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="px-3 py-2 border-b border-border-default">
      <span className="block text-[11px] text-rmpg-100 mb-1.5">{label}</span>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="flex-1 px-2 py-1 text-[10px] uppercase tracking-wide border transition-colors"
            style={{
              background: value === opt.value ? 'var(--brand-gold)' : 'var(--surface-base)',
              color: value === opt.value ? 'var(--surface-overlay)' : 'var(--text-muted)',
              borderColor: value === opt.value ? 'var(--brand-gold)' : 'var(--border-default)',
              borderRadius: 2,
            }}
            aria-pressed={value === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SoundAssignRow({ label, desc, value, onPick }: {
  label: string; desc: string; value: SoundId; onPick: (s: SoundId) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-rmpg-100 truncate">{label}</span>
        <span className="block text-[9px] text-fg-muted truncate">{desc}</span>
      </span>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value as SoundId)}
        className="shrink-0 w-[150px] bg-surface-base border border-border-default text-[10px] text-rmpg-100 px-1.5 py-1"
        style={{ borderRadius: 2 }}
        aria-label={`Sound for ${label}`}
      >
        {SOUND_CATEGORIES.map((cat) => (
          <optgroup key={cat} label={cat}>
            {SOUND_LIBRARY.filter((s) => s.category === cat).map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        onClick={() => playSound(value)}
        className="shrink-0 p-1.5 border border-border-default text-fg-muted hover:text-text-primary transition-colors"
        style={{ borderRadius: 2 }}
        aria-label={`Preview ${label} sound`}
      >
        <Play className="w-3 h-3" />
      </button>
    </div>
  );
}

function SectionCard({ id, title, icon, children }: {
  id?: string; title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      data-settings-section={id}
      className="panel-beveled scroll-mt-20"
      style={{ background: 'var(--surface-sunken)' }}
    >
      <PanelTitleBar title={title} icon={icon} />
      <div>{children}</div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────

const MIN_TIER_KEY = 'rmpg-alert-min-tier';
const ENGINE_KEY = 'rmpg-voice-engine';

// Sound-library categories rendered as <optgroup>s, in display order.
const SOUND_CATEGORIES = ['Dispatch', 'Alert', 'Status', 'Radio', 'Noise'] as const;

const EVENT_LABELS: { cat: VoiceEventCategory; label: string; desc: string }[] = [
  { cat: 'new_call', label: 'New calls for service', desc: 'Announce when a new call is created' },
  { cat: 'panic', label: 'Panic / officer-down', desc: 'Emergency assistance alerts' },
  { cat: 'bolo', label: 'BOLO alerts', desc: 'Be-on-the-lookout broadcasts' },
  { cat: 'status', label: 'Unit status changes', desc: 'En route, on scene, cleared' },
  { cat: 'notification', label: 'Notification alerts', desc: 'Spoken in the automated PA voice, separate from the dispatcher. Muting this keeps the alert tone.' },
];

// Sections that ?section= can deep-link to. Anchors map 1:1 to the
// `id` on each SectionCard below. Keeping the list in one place avoids
// drift and gives us a safe whitelist for the URL param.
const SECTION_IDS = [
  'display', 'voice', 'alerts', 'tones', 'ptt',
  'map', 'overlays', 'gps', 'markers', 'automations',
] as const;
type SectionId = typeof SECTION_IDS[number];

function isSectionId(v: string | null): v is SectionId {
  return v != null && (SECTION_IDS as readonly string[]).includes(v);
}

interface AutomationRule {
  id: number;
  name: string;
  scope: 'global' | 'unit' | 'user';
  trigger_type: string;
  action_type: string;
  enabled: number;
}

function MyAutomationsPanel() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [globalRules, setGlobalRules] = useState<AutomationRule[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);

  const fetchRules = useCallback(async () => {
    const data = await apiFetch<{ rules: AutomationRule[] }>('/automation-rules').catch(() => null);
    const all = data?.rules ?? [];
    setGlobalRules(all.filter((r) => r.scope === 'global'));
    setRules(all.filter((r) => r.scope === 'user'));
  }, []);

  useEffect(() => { void fetchRules(); }, [fetchRules]);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this rule?')) return;
    await apiFetch(`/automation-rules/${id}`, { method: 'DELETE' }).catch(() => {});
    void fetchRules();
  };

  if (creating || editing) {
    return (
      <AutomationRuleEditor
        rule={editing ?? undefined}
        adminMode={false}
        onSaved={() => { setCreating(false); setEditing(null); void fetchRules(); }}
        onCancel={() => { setCreating(false); setEditing(null); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* System rules — read-only, scope='global' */}
      <div className="space-y-1">
        <div className="px-3 pb-1">
          <p className="text-[10px] font-semibold text-fg-secondary uppercase tracking-wide">System rules</p>
          <p className="text-[10px] text-fg-muted">Applied to all officers by dispatch</p>
        </div>
        {globalRules.length === 0 ? (
          <p className="text-[10px] text-fg-muted px-3">No system rules configured.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-surface-border">
                <th className="font-semibold text-[9px] text-fg-muted py-[3px] px-3 uppercase">Name</th>
                <th className="font-semibold text-[9px] text-fg-muted py-[3px] px-2 uppercase">Trigger</th>
                <th className="font-semibold text-[9px] text-fg-muted py-[3px] px-2 uppercase">Action</th>
                <th className="font-semibold text-[9px] text-fg-muted py-[3px] px-2 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {globalRules.map((r) => (
                <tr key={r.id} className="border-b border-surface-border last:border-0">
                  <td className="text-[11px] text-text-primary py-[2px] px-3 truncate max-w-[140px]">{r.name}</td>
                  <td className="text-[11px] text-fg-secondary py-[2px] px-2">{r.trigger_type.replace(/_/g, ' ')}</td>
                  <td className="text-[11px] text-fg-secondary py-[2px] px-2">{r.action_type.replace(/_/g, ' ')}</td>
                  <td className="py-[2px] px-2">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${r.enabled ? 'bg-sev-ok' : 'bg-surface-border'}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* My rules — editable, scope='user' */}
      <div className="space-y-2">
        <p className="text-[10px] text-fg-muted px-3 pb-1">
          Personal rules only fire for you. Set up proximity alerts or personal welfare reminders.
        </p>
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between bg-surface-raised border border-surface-border px-3 py-[3px]" style={{ borderRadius: 2 }}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.enabled ? 'bg-sev-ok' : 'bg-rmpg-600'}`} />
              <span className="text-[11px] text-text-primary truncate">{r.name}</span>
              <span className="text-[10px] text-fg-muted flex-shrink-0">
                {r.trigger_type.replace(/_/g, ' ')} → {r.action_type.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="flex gap-2 flex-shrink-0 pl-3">
              <button onClick={() => setEditing(r)} className="text-[10px] text-fg-muted hover:text-text-primary">Edit</button>
              <button onClick={() => void handleDelete(r.id)} className="text-[10px] text-fg-muted hover:text-sev-critical">Delete</button>
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-[10px] text-fg-muted px-3">No personal rules yet.</p>
        )}
        <button
          onClick={() => setCreating(true)}
          className="text-[11px] text-fg-muted hover:text-text-primary px-3 pt-1 flex items-center gap-1"
        >
          + Add personal rule
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { persona, setPersona } = useVoicePersona();
  const { user } = useAuth();
  const { prefs: userPrefs } = useUserPreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [orgSaveOk, setOrgSaveOk] = useState<null | boolean>(null);
  const [orgSaveMsg, setOrgSaveMsg] = useState('');
  const [orgSaving, setOrgSaving] = useState(false);

  // ConfirmDialog state for destructive resets
  const [confirmResetTones, setConfirmResetTones] = useState(false);
  const [confirmResetMap, setConfirmResetMap] = useState(false);

  async function publishOrgDefaults() {
    if (orgSaving) return;
    setOrgSaving(true);
    setOrgSaveOk(null);
    setOrgSaveMsg('Saving…');
    try {
      const ok = await saveAsOrgDefault();
      setOrgSaveOk(ok);
      setOrgSaveMsg(ok ? 'Published to all users' : 'Save failed');
      setTimeout(() => { setOrgSaveMsg(''); setOrgSaveOk(null); }, 4000);
    } finally {
      setOrgSaving(false);
    }
  }

  // Voice — alerts master + engine + severity
  const [voiceAlerts, setVoiceAlertsState] = useState(getVoiceAlertsEnabled);
  const [engine, setEngine] = useState<'edge-tts' | 'browser'>(
    () => (localStorage.getItem(ENGINE_KEY) as 'edge-tts' | 'browser') || 'edge-tts',
  );
  const [minTier, setMinTier] = useState<AlertSeverity>(
    () => (localStorage.getItem(MIN_TIER_KEY) as AlertSeverity) || 'minor',
  );
  const [events, setEvents] = useState<Record<VoiceEventCategory, boolean>>(() => ({
    new_call: getEventEnabled('new_call'),
    panic: getEventEnabled('panic'),
    bolo: getEventEnabled('bolo'),
    status: getEventEnabled('status'),
    notification: getEventEnabled('notification'),
  }));
  const [previewing, setPreviewing] = useState(false);

  // Sound profile — per-function tone assignments
  const readSlots = () => {
    const m: Record<string, SoundId> = {};
    for (const { slot } of TONE_SLOTS) m[slot] = getSlotSound(slot);
    return m;
  };
  const [toneMap, setToneMap] = useState<Record<string, SoundId>>(readSlots);

  // Radio PTT preferences
  const [ptt, setPtt] = useState<PttPreferences>(getPttPrefs);
  const [pttChannels, setPttChannels] = useState<RadioChannel[]>([]);
  const [pttChannelsLoading, setPttChannelsLoading] = useState(true);
  const [capturingKey, setCapturingKey] = useState(false);
  const patchPtt = (p: Partial<PttPreferences>) => { setPttPrefs(p); setPtt(getPttPrefs()); };

  // Ref for N-shortcut focus target (voice selector — non-admin users).
  const voiceSelectRef = useRef<HTMLSelectElement>(null);

  // Display & theme — keep local state in sync with the actual override
  // so the Auto/Day/Night picker reflects what's stored regardless of
  // which surface (here, UserProfileModal, Layout) last wrote it.
  const readThemeChoice = (): 'auto' | 'dark' | 'light' => {
    const o = readThemeOverride();
    return o?.active ? o.theme : 'auto';
  };
  const [themeChoice, setThemeChoice] = useState<'auto' | 'dark' | 'light'>(readThemeChoice);
  const [legacyBlack, setLegacyBlack] = useState<boolean>(isLegacyBlackForced);
  const [blueSilver, setBlueSilver] = useState<boolean>(isBlueSilverForced);
  const [fontScale, setFontScale] = useState<number>(() => {
    const fromPrefs = userPrefs?.font_scale;
    return typeof fromPrefs === 'number' && fromPrefs > 0 ? fromPrefs : 1.0;
  });
  // Hydrate font scale from server-side user preferences once they load.
  useEffect(() => {
    const fromPrefs = userPrefs?.font_scale;
    if (typeof fromPrefs === 'number' && fromPrefs > 0) setFontScale(fromPrefs);
  }, [userPrefs?.font_scale]);

  function setTheme(choice: 'auto' | 'dark' | 'light') {
    setThemeChoice(choice);
    if (choice === 'auto') {
      writeThemeOverride({ theme: 'dark', active: false });
      applyThemePreference(resolveCurrentTheme(), { persist: false });
    } else {
      const theme = normalizeThemePreference(choice);
      writeThemeOverride({ theme, active: true });
      applyThemePreference(theme);
      // Best-effort cross-device sync via the same API UserProfileModal uses.
      apiFetch('/user/preferences', {
        method: 'PUT',
        body: JSON.stringify({ theme_preference: theme }),
      }).catch(() => { /* offline / unauth — local override still applies */ });
    }
  }

  function toggleLegacyBlack(on: boolean) {
    setLegacyBlack(on);
    try {
      if (on) localStorage.setItem(LEGACY_FLAG_KEY, '1');
      else localStorage.removeItem(LEGACY_FLAG_KEY);
    } catch { /* storage unavailable */ }
    // Legacy and Blue & Silver are both full-override themes — mutually
    // exclusive, same as flipping a radio. Turning legacy on switches
    // Blue & Silver off (legacy already wins in isBlueSilverForced()'s own
    // check, but keep the UI toggle in sync so it doesn't look stuck on).
    if (on && blueSilver) {
      setBlueSilver(false);
      // Blue & Silver defaults ON (isBlueSilverForced() treats an absent key
      // as on) — write an explicit '0' here, not removeItem, or switching to
      // legacy would leave the flag unset and Blue & Silver would silently
      // stay in effect underneath it.
      try { localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0'); } catch { /* storage unavailable */ }
    }
    // Re-resolve so the change is visible immediately.
    applyThemePreference(resolveCurrentTheme(), { persist: false });
  }

  function toggleBlueSilver(on: boolean) {
    setBlueSilver(on);
    try {
      // Blue & Silver is the app-wide default (isBlueSilverForced() treats an
      // absent/'1' key as on) — write explicit '1'/'0' rather than
      // setItem/removeItem so "off" actually opts out instead of reverting
      // to "unset", which the default-on polarity would treat as still on.
      localStorage.setItem(BLUE_SILVER_FLAG_KEY, on ? '1' : '0');
    } catch { /* storage unavailable */ }
    if (on && legacyBlack) {
      setLegacyBlack(false);
      try { localStorage.removeItem(LEGACY_FLAG_KEY); } catch { /* storage unavailable */ }
    }
    applyThemePreference(resolveCurrentTheme(), { persist: false });
  }

  function changeFontScale(v: number) {
    const clamped = Math.max(0.8, Math.min(1.4, v));
    setFontScale(clamped);
    document.documentElement.style.setProperty('--user-font-scale', String(clamped));
    document.documentElement.style.fontSize = `${clamped * 100}%`;
    apiFetch('/user/preferences', {
      method: 'PUT',
      body: JSON.stringify({ font_scale: clamped }),
    }).catch(() => { /* offline — local style still applies */ });
  }

  useEffect(() => {
    let cancelled = false;
    setPttChannelsLoading(true);
    apiFetch<RadioChannel[]>('/radio/channels')
      .then((data) => { if (!cancelled) setPttChannels(asArray<RadioChannel>(data)); })
      .catch(() => { /* offline */ })
      .finally(() => { if (!cancelled) setPttChannelsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Capture the next key press to rebind the PTT key.
  // Esc cancels capture without binding (matches the smart-cascade
  // contract on the other pages: Esc dismisses the most local interaction).
  useEffect(() => {
    if (!capturingKey) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code !== 'Escape') patchPtt({ keyCode: e.code });
      setCapturingKey(false);
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [capturingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map preferences
  const [mapPrefs, setMapPrefs] = useState<MapPreferences>(getMapPreferences);

  // Push map pref changes to storage + invalidate config cache so the
  // marker/GPS overrides re-apply on the next map mount.
  function patchMap(patch: Partial<MapPreferences>) {
    setMapPreferences(patch); // emits 'map' on the settings bus → live-applies
    setMapPrefs(getMapPreferences());
  }

  async function previewVoice() {
    setPreviewing(true);
    try {
      const { speak, clearQueue } = await importWithRetry(() => import('../utils/edgeTTS'));
      clearQueue();
      const opt = VOICE_CATALOG.find((v) => v.id === persona.voiceId);
      const sample = `Dispatch test. This is ${opt?.label ?? 'the dispatcher'}. ` +
        `Unit S19, en route to a priority 2 welfare check at 3392 Mockingbird Way.`;
      await speak(sample, undefined, 'conversational', true);
    } catch {
      /* TTS unavailable — preview is best-effort */
    } finally {
      setPreviewing(false);
    }
  }

  function resetMap() {
    resetMapPreferences(); // emits 'map' → live-applies
    setMapPrefs(getMapPreferences());
  }

  // Keep the document title aligned with the rest of the app.
  useEffect(() => { document.title = 'Settings — RMPG Flex'; return () => { document.title = 'RMPG Flex'; }; }, []);

  // URL deep-link contract: /settings?section=<id> scrolls the matching
  // SectionCard into view on mount, then strips the param via setSearchParams
  // so a refresh doesn't re-trigger the scroll. Mirrors the v1047/v1048
  // contract used by Intel Portal + Serve. Section IDs whitelist-validated.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current) return;
    const section = searchParams.get('section');
    if (!isSectionId(section)) return;
    scrolledRef.current = true;
    // Run after paint so the SectionCard has been laid out.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-settings-section="${section}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Strip the param with router-aware setSearchParams (no window.history.replaceState).
    setSearchParams((prev) => {
      prev.delete('section');
      return prev;
    }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts:
  //   N          — admin/manager only: publish org defaults (same role check as the button).
  //   Escape     — smart cascade: close ConfirmDialogs first, then cancel key capture.
  const isTypingTarget = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmResetTones) { e.stopPropagation(); setConfirmResetTones(false); return; }
        if (confirmResetMap) { e.stopPropagation(); setConfirmResetMap(false); return; }
        if (capturingKey) { e.stopPropagation(); setCapturingKey(false); return; }
        return;
      }
      if ((e.key === 'n' || e.key === 'N')
          && isAdmin
          && !e.ctrlKey && !e.metaKey && !e.altKey
          && !isTypingTarget(e.target)) {
        e.preventDefault();
        publishOrgDefaults();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAdmin, confirmResetTones, confirmResetMap, capturingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const femaleVoices = VOICE_CATALOG.filter((v) => v.gender === 'female');
  const maleVoices = VOICE_CATALOG.filter((v) => v.gender === 'male');

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <PanelTitleBar title="SETTINGS" icon={SlidersHorizontal}>
        {isAdmin && (
          <div className="ml-auto flex items-center gap-2">
            {orgSaveMsg && (
              <span
                className="text-[10px] inline-flex items-center gap-1"
                style={{ color: orgSaveOk === false ? 'var(--sev-critical)' : 'var(--brand-gold)' }}
              >
                {orgSaveOk === true && <CheckCircle2 className="w-3 h-3" />}
                {orgSaveMsg}
              </span>
            )}
            <button
              type="button"
              onClick={publishOrgDefaults}
              disabled={orgSaving}
              title="Publish your current voice / tone / map / PTT settings as the default for all users (they can still override). Shortcut: N"
              className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                borderColor: 'var(--brand-gold)',
                color: 'var(--brand-gold)',
                borderRadius: 2,
              }}
            >
              <RadioTower className="w-3 h-3" /> Save as org default
            </button>
          </div>
        )}
      </PanelTitleBar>

      {/* ── ConfirmDialogs for destructive resets ── */}
      <ConfirmDialog
        isOpen={confirmResetTones}
        onClose={() => setConfirmResetTones(false)}
        onConfirm={() => { resetToneMap(); setToneMap(readSlots()); setConfirmResetTones(false); }}
        title="Reset Tone Assignments"
        message="Reset all dispatch tone slots to Motorola factory defaults? Your current assignments will be lost."
        confirmLabel="Reset"
        confirmVariant="warning"
      />
      <ConfirmDialog
        isOpen={confirmResetMap}
        onClose={() => setConfirmResetMap(false)}
        onConfirm={() => { resetMap(); setConfirmResetMap(false); }}
        title="Reset Map Settings"
        message="Reset all map preferences (style, layers, overlays, GPS, markers) to defaults?"
        confirmLabel="Reset"
        confirmVariant="warning"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* ── LEFT COLUMN: VOICE + AUDIO ── */}
        <div className="space-y-4">
          <SectionCard id="display" title="DISPLAY & THEME" icon={Monitor}>
            <Segmented
              label="Theme"
              value={themeChoice}
              options={[
                { value: 'auto', label: 'Auto (shift)' },
                { value: 'dark', label: 'Night' },
                { value: 'light', label: 'Day' },
              ]}
              onChange={(v) => setTheme(v)}
            />
            <SliderRow
              label="Font scale"
              value={fontScale}
              min={0.8}
              max={1.4}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={changeFontScale}
            />
            <ToggleRow
              label="Legacy pure-black mode"
              description="Restores the pre-Spillman black palette. Use only if the new theme is unreadable."
              checked={legacyBlack}
              onChange={toggleLegacyBlack}
            />
            <ToggleRow
              label="Blue & Silver mode (default)"
              description="Deep navy-blue surfaces with a silver accent — the app's default theme as of 2026-07-04. Turn off to use the retired gold Auto/Night/Day schedule instead."
              checked={blueSilver}
              onChange={toggleBlueSilver}
            />
            <p className="px-3 py-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Auto (shift) follows the duty schedule: Day 06:00–18:00, Night 18:00–06:00.
              Manual picks override the schedule until you set it back to Auto.
            </p>
          </SectionCard>

          <SectionCard id="voice" title="DISPATCHER VOICE" icon={Mic}>
            {/* Voice picker — primary N-shortcut target for non-admin users */}
            <div className="px-3 py-2 border-b border-border-default">
              <span className="block text-[11px] text-rmpg-100 mb-1.5">Voice</span>
              <select
                ref={voiceSelectRef}
                value={persona.voiceId}
                onChange={(e) => setPersona({ voiceId: e.target.value })}
                className="w-full bg-surface-base border border-border-default text-[11px] text-rmpg-100 px-2 py-1.5"
                style={{ borderRadius: 2 }}
                aria-label="Dispatcher voice"
              >
                <optgroup label="Female">
                  {femaleVoices.map((v) => (
                    <option key={v.id} value={v.id}>{v.label} ({v.accent}) — {v.description}</option>
                  ))}
                </optgroup>
                <optgroup label="Male">
                  {maleVoices.map((v) => (
                    <option key={v.id} value={v.id}>{v.label} ({v.accent}) — {v.description}</option>
                  ))}
                </optgroup>
              </select>
              <button
                type="button"
                onClick={previewVoice}
                disabled={previewing}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide border transition-colors disabled:opacity-50"
                style={{
                  borderColor: 'var(--brand-gold)',
                  color: 'var(--brand-gold)',
                  borderRadius: 2,
                }}
              >
                <Play className="w-3 h-3" /> {previewing ? 'Speaking…' : 'Test voice'}
              </button>
            </div>

            <SliderRow
              label="Speaking rate" value={persona.rate} min={0.5} max={1.5} step={0.05}
              format={(v) => `${Math.round((v - 1) * 100) >= 0 ? '+' : ''}${Math.round((v - 1) * 100)}%`}
              onChange={(v) => setPersona({ rate: v })}
            />
            <SliderRow
              label="Pitch" value={persona.pitch} min={-20} max={20} step={1}
              format={(v) => `${v >= 0 ? '+' : ''}${v} Hz`}
              onChange={(v) => setPersona({ pitch: v })}
            />
            <Segmented
              label="Phrasing"
              value={persona.terseness}
              options={[
                { value: 'terse', label: 'Terse' },
                { value: 'standard', label: 'Standard' },
                { value: 'narrative', label: 'Narrative' },
              ]}
              onChange={(v) => setPersona({ terseness: v })}
            />
            <Segmented
              label="Synthesis engine"
              value={engine}
              options={[
                { value: 'edge-tts', label: 'Neural AI' },
                { value: 'browser', label: 'Browser' },
              ]}
              onChange={(v) => { setEngine(v); localStorage.setItem(ENGINE_KEY, v); }}
            />
          </SectionCard>

          <SectionCard id="alerts" title="VOICE ALERTS" icon={Volume2}>
            <ToggleRow
              label="Voice alerts enabled"
              description="Master switch for all spoken dispatch alerts"
              checked={voiceAlerts}
              onChange={(v) => { setVoiceAlertsState(v); setVoiceAlertsEnabled(v); }}
            />
            <Segmented
              label="Minimum severity to speak"
              value={minTier}
              options={[
                { value: 'minor', label: 'All' },
                { value: 'moderate', label: 'Important' },
                { value: 'major', label: 'Emergency' },
              ]}
              onChange={(v) => { setMinTier(v); localStorage.setItem(MIN_TIER_KEY, v); }}
            />
            <div className="px-3 pt-2 pb-1">
              <span className="text-[10px] uppercase tracking-wide text-fg-muted flex items-center gap-1">
                <Radio className="w-3 h-3" /> Announce these events
              </span>
            </div>
            {EVENT_LABELS.map(({ cat, label, desc }) => (
              <ToggleRow
                key={cat}
                label={label}
                description={desc}
                checked={events[cat]}
                onChange={(v) => { setEventEnabled(cat, v); setEvents((p) => ({ ...p, [cat]: v })); }}
              />
            ))}
          </SectionCard>

          <SectionCard id="tones" title="SOUND PROFILE — MOTOROLA TONES" icon={RadioTower}>
            <div className="px-3 pt-2 pb-1">
              <span className="block text-[10px] text-fg-muted">
                Assign a Motorola tone to each dispatch function. Changes apply everywhere instantly.
                Preview with <Play className="inline w-2.5 h-2.5 -mt-0.5" /> (respects the master Sound toggle).
              </span>
            </div>
            {TONE_SLOTS.map(({ slot, label, desc }) => (
              <SoundAssignRow
                key={slot}
                label={label}
                desc={desc}
                value={toneMap[slot]}
                onPick={(sound) => {
                  setSlotSound(slot, sound);
                  setToneMap((p) => ({ ...p, [slot]: sound }));
                  playSound(sound);
                }}
              />
            ))}
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => setConfirmResetTones(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide border border-border-default text-fg-muted hover:text-text-primary transition-colors"
                style={{ borderRadius: 2 }}
              >
                <RotateCcw className="w-3 h-3" /> Reset to Motorola defaults
              </button>
            </div>
          </SectionCard>

          <SectionCard id="ptt" title="RADIO PTT — PUSH-TO-TALK" icon={Radio}>
            <ToggleRow
              label="Enable global PTT key"
              description="Hold the key on any page to key the mic on the radio channel"
              checked={ptt.enabled}
              onChange={(v) => patchPtt({ enabled: v })}
            />
            <div className="px-3 py-2 border-b border-border-default flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-[11px] text-rmpg-100">PTT key</span>
                <span className="block text-[10px] text-fg-muted mt-0.5">
                  {capturingKey ? 'Press any key to bind, or Esc to cancel' : 'Press to bind any key'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setCapturingKey(true)}
                className="shrink-0 min-w-[120px] px-3 py-1.5 text-[11px] font-mono border transition-colors"
                style={{
                  borderRadius: 2,
                  background: capturingKey
                    ? 'rgb(var(--sev-critical-rgb) / 0.15)'
                    : 'var(--surface-base)',
                  borderColor: capturingKey ? 'var(--sev-critical)' : 'var(--border-default)',
                  color: capturingKey ? 'var(--sev-critical-soft)' : 'var(--text-primary)',
                }}
              >
                {capturingKey ? 'Press a key…' : keyCodeLabel(ptt.keyCode)}
              </button>
            </div>
            <div className="px-3 py-2 border-b border-border-default">
              <span className="block text-[11px] text-rmpg-100 mb-1.5">Transmit channel</span>
              {pttChannelsLoading ? (
                <p className="text-[10px] text-fg-muted py-1">Loading channels…</p>
              ) : (
                <select
                  value={ptt.channelId == null ? '' : String(ptt.channelId)}
                  onChange={(e) => patchPtt({ channelId: e.target.value === '' ? null : Number(e.target.value) })}
                  className="w-full bg-surface-base border border-border-default text-[11px] text-rmpg-100 px-2 py-1.5"
                  style={{ borderRadius: 2 }}
                  aria-label="PTT transmit channel"
                >
                  <option value="">Auto — first active channel</option>
                  {pttChannels.length === 0 ? (
                    <option disabled value="">No channels configured</option>
                  ) : pttChannels.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
            <p className="px-3 py-2 text-[10px] text-fg-muted">
              Every transmission is relayed to everyone on the channel and recorded to
              <span className="text-fg-muted"> Radio → Recordings</span> automatically. An on-air
              indicator appears bottom-right while keyed.
            </p>
          </SectionCard>
        </div>

        {/* ── RIGHT COLUMN: GPS MAPPER ── */}
        <div className="space-y-4">
          <SectionCard id="map" title="MAP — DEFAULT VIEW" icon={MapIcon}>
            <div className="px-3 py-2 border-b border-border-default">
              <span className="block text-[11px] text-rmpg-100 mb-1.5">Default map style</span>
              <select
                value={mapPrefs.defaultStyle}
                onChange={(e) => patchMap({ defaultStyle: e.target.value as MapStyleId })}
                className="w-full bg-surface-base border border-border-default text-[11px] text-rmpg-100 px-2 py-1.5"
                style={{ borderRadius: 2 }}
                aria-label="Default map style"
              >
                {(Object.keys(MAP_STYLE_LABELS) as MapStyleId[]).map((id) => (
                  <option key={id} value={id}>{MAP_STYLE_LABELS[id]} — {MAP_STYLE_DESCRIPTIONS[id]}</option>
                ))}
              </select>
            </div>
            <div className="px-3 pt-2 pb-1">
              <span className="text-[10px] uppercase tracking-wide text-fg-muted">Base layers shown on load</span>
            </div>
            <ToggleRow label="Units" checked={mapPrefs.layers.units}
              onChange={(v) => patchMap({ layers: { ...mapPrefs.layers, units: v } })} />
            <ToggleRow label="Incidents / calls" checked={mapPrefs.layers.incidents}
              onChange={(v) => patchMap({ layers: { ...mapPrefs.layers, incidents: v } })} />
            <ToggleRow label="Properties" checked={mapPrefs.layers.properties}
              onChange={(v) => patchMap({ layers: { ...mapPrefs.layers, properties: v } })} />
          </SectionCard>

          <SectionCard id="overlays" title="MAP — ANALYTICS OVERLAYS" icon={MapPin}>
            <ToggleRow label="Incident heatmap" description="Density overlay on by default"
              checked={mapPrefs.overlays.heatmap}
              onChange={(v) => patchMap({ overlays: { ...mapPrefs.overlays, heatmap: v } })} />
            <ToggleRow label="Unit breadcrumb trails" description="Recent GPS track history"
              checked={mapPrefs.overlays.breadcrumbs}
              onChange={(v) => patchMap({ overlays: { ...mapPrefs.overlays, breadcrumbs: v } })} />
          </SectionCard>

          <SectionCard id="gps" title="MAP — GPS TRACKING" icon={Crosshair}>
            <ToggleRow label="High-accuracy positioning" description="Tighter fix, more battery use"
              checked={mapPrefs.gps.highAccuracy}
              onChange={(v) => patchMap({ gps: { ...mapPrefs.gps, highAccuracy: v } })} />
            <ToggleRow label="Auto-center on my unit" description="Recenter the map when a fix arrives"
              checked={mapPrefs.gps.autoCenterOnUnit}
              onChange={(v) => patchMap({ gps: { ...mapPrefs.gps, autoCenterOnUnit: v } })} />
            <SliderRow label="GPS upload interval" value={mapPrefs.gps.batchIntervalMs}
              min={1000} max={30000} step={1000} format={(v) => `${v / 1000}s`}
              onChange={(v) => patchMap({ gps: { ...mapPrefs.gps, batchIntervalMs: v } })} />
          </SectionCard>

          <SectionCard id="markers" title="MAP — MARKERS" icon={Gauge}>
            <ToggleRow label="Unit marker pulse" checked={mapPrefs.markers.unitPulse}
              onChange={(v) => patchMap({ markers: { ...mapPrefs.markers, unitPulse: v } })} />
            <ToggleRow label="Call marker pulse" checked={mapPrefs.markers.callPulse}
              onChange={(v) => patchMap({ markers: { ...mapPrefs.markers, callPulse: v } })} />
            <ToggleRow label="Cluster nearby markers" description="Group markers at low zoom"
              checked={mapPrefs.markers.clusteringEnabled}
              onChange={(v) => patchMap({ markers: { ...mapPrefs.markers, clusteringEnabled: v } })} />
            <SliderRow label="Marker label size" value={mapPrefs.markers.fontSize}
              min={7} max={16} step={1} format={(v) => `${v} px`}
              onChange={(v) => patchMap({ markers: { ...mapPrefs.markers, fontSize: v } })} />
            <SliderRow label="Cluster radius" value={mapPrefs.markers.clusterRadius}
              min={20} max={120} step={5} format={(v) => `${v} px`}
              onChange={(v) => patchMap({ markers: { ...mapPrefs.markers, clusterRadius: v } })} />
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => setConfirmResetMap(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide border border-border-default text-fg-muted hover:text-text-primary transition-colors"
                style={{ borderRadius: 2 }}
              >
                <RotateCcw className="w-3 h-3" /> Reset map settings
              </button>
            </div>
          </SectionCard>

          <p className="text-[10px] text-fg-muted px-1">
            Map changes apply live — to an open Map page and other tabs — no reload needed.
          </p>

          <SectionCard id="automations" title="MY AUTOMATIONS" icon={Zap}>
            <MyAutomationsPanel />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
