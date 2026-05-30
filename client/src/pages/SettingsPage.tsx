// ============================================================
// RMPG Flex — Unified Settings
// Voice (dispatcher persona + alerts) and Map (GPS / mapper) prefs.
// All controls write to localStorage via existing helpers, so they
// take effect without any server round-trip (voice persona also
// best-effort syncs to /api/voice-persona via useVoicePersona).
// ============================================================

import { useEffect, useState } from 'react';
import {
  Mic, Map as MapIcon, Volume2, Gauge, SlidersHorizontal,
  Play, RotateCcw, Radio, Crosshair, MapPin, RadioTower,
} from 'lucide-react';
import {
  playSound, resetToneMap, getSlotSound, setSlotSound,
  SOUND_LIBRARY, TONE_SLOTS, type SoundId,
} from '../utils/dispatchTones';
import PanelTitleBar from '../components/PanelTitleBar';
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
import type { RadioChannel } from './radio/types';
import { getPttPrefs, setPttPrefs, keyCodeLabel, type PttPreferences } from '../utils/pttPreferences';
import { saveAsOrgDefault } from '../utils/settingsSync';
import { useAuth } from '../context/AuthContext';

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
      className="w-full flex items-center justify-between gap-4 px-3 py-2 text-left border-b border-[#1a1a1a] hover:bg-white/[0.02] transition-colors"
    >
      <span className="min-w-0">
        <span className="block text-[11px] text-white">{label}</span>
        {description && <span className="block text-[10px] text-rmpg-400 mt-0.5">{description}</span>}
      </span>
      <span
        className="shrink-0 w-9 h-5 flex items-center px-0.5 transition-colors"
        style={{ background: checked ? '#d4a017' : '#2e2e2e', borderRadius: 2 }}
      >
        <span
          className="w-4 h-4 bg-black transition-transform"
          style={{ borderRadius: 1, transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
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
    <div className="px-3 py-2 border-b border-[#1a1a1a]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-white">{label}</span>
        <span className="text-[10px] font-mono text-brand-400">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#d4a017]"
        aria-label={label}
      />
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="px-3 py-2 border-b border-[#1a1a1a]">
      <span className="block text-[11px] text-white mb-1.5">{label}</span>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="flex-1 px-2 py-1 text-[10px] uppercase tracking-wide border transition-colors"
            style={{
              background: value === opt.value ? '#d4a017' : '#141414',
              color: value === opt.value ? '#000' : '#888',
              borderColor: value === opt.value ? '#d4a017' : '#222',
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
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a1a]">
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-white truncate">{label}</span>
        <span className="block text-[9px] text-rmpg-500 truncate">{desc}</span>
      </span>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value as SoundId)}
        className="shrink-0 w-[150px] bg-[#141414] border border-[#222] text-[10px] text-white px-1.5 py-1"
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
        className="shrink-0 p-1.5 border border-[#222] text-rmpg-400 hover:text-brand-400 hover:border-[#d4a017] transition-colors"
        style={{ borderRadius: 2 }}
        aria-label={`Preview ${label} sound`}
      >
        <Play className="w-3 h-3" />
      </button>
    </div>
  );
}

function SectionCard({ title, icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="panel-beveled" style={{ background: '#0a0a0a' }}>
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
];

export default function SettingsPage() {
  const { persona, setPersona } = useVoicePersona();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [orgSaveMsg, setOrgSaveMsg] = useState('');
  async function publishOrgDefaults() {
    setOrgSaveMsg('Saving…');
    const ok = await saveAsOrgDefault();
    setOrgSaveMsg(ok ? 'Published to all users ✓' : 'Save failed');
    setTimeout(() => setOrgSaveMsg(''), 4000);
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
  const [capturingKey, setCapturingKey] = useState(false);
  const patchPtt = (p: Partial<PttPreferences>) => { setPttPrefs(p); setPtt(getPttPrefs()); };

  useEffect(() => {
    apiFetch<RadioChannel[]>('/radio/channels').then(setPttChannels).catch(() => { /* offline */ });
  }, []);

  // Capture the next key press to rebind the PTT key.
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
      const { speak, clearQueue } = await import('../utils/edgeTTS');
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

  const femaleVoices = VOICE_CATALOG.filter((v) => v.gender === 'female');
  const maleVoices = VOICE_CATALOG.filter((v) => v.gender === 'male');

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <PanelTitleBar title="SETTINGS" icon={SlidersHorizontal}>
        {isAdmin && (
          <div className="ml-auto flex items-center gap-2">
            {orgSaveMsg && <span className="text-[10px] text-brand-400">{orgSaveMsg}</span>}
            <button
              type="button"
              onClick={publishOrgDefaults}
              title="Publish your current voice / tone / map / PTT settings as the default for all users (they can still override)."
              className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide border border-[#d4a017] text-brand-400 hover:bg-[#d4a017] hover:text-black transition-colors"
              style={{ borderRadius: 2 }}
            >
              <RadioTower className="w-3 h-3" /> Save as org default
            </button>
          </div>
        )}
      </PanelTitleBar>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* ── DISPATCHER VOICE ── */}
        <div className="space-y-4">
          <SectionCard title="DISPATCHER VOICE" icon={Mic}>
            {/* Voice picker */}
            <div className="px-3 py-2 border-b border-[#1a1a1a]">
              <span className="block text-[11px] text-white mb-1.5">Voice</span>
              <select
                value={persona.voiceId}
                onChange={(e) => setPersona({ voiceId: e.target.value })}
                className="w-full bg-[#141414] border border-[#222] text-[11px] text-white px-2 py-1.5"
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
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide border border-[#d4a017] text-brand-400 hover:bg-[#d4a017] hover:text-black transition-colors disabled:opacity-50"
                style={{ borderRadius: 2 }}
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

          <SectionCard title="VOICE ALERTS" icon={Volume2}>
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
              <span className="text-[10px] uppercase tracking-wide text-rmpg-500 flex items-center gap-1">
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

          <SectionCard title="SOUND PROFILE — MOTOROLA TONES" icon={RadioTower}>
            <div className="px-3 pt-2 pb-1">
              <span className="block text-[10px] text-rmpg-400">
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
                onClick={() => { resetToneMap(); setToneMap(readSlots()); }}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide border border-[#222] text-rmpg-400 hover:text-white hover:border-[#2e2e2e] transition-colors"
                style={{ borderRadius: 2 }}
              >
                <RotateCcw className="w-3 h-3" /> Reset to Motorola defaults
              </button>
            </div>
          </SectionCard>

          <SectionCard title="RADIO PTT — PUSH-TO-TALK" icon={Radio}>
            <ToggleRow
              label="Enable global PTT key"
              description="Hold the key on any page to key the mic on the radio channel"
              checked={ptt.enabled}
              onChange={(v) => patchPtt({ enabled: v })}
            />
            <div className="px-3 py-2 border-b border-[#1a1a1a] flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-[11px] text-white">PTT key</span>
                <span className="block text-[10px] text-rmpg-400 mt-0.5">Press to bind any key</span>
              </span>
              <button
                type="button"
                onClick={() => setCapturingKey(true)}
                className="shrink-0 min-w-[120px] px-3 py-1.5 text-[11px] font-mono border transition-colors"
                style={{
                  borderRadius: 2,
                  background: capturingKey ? '#3a0d0d' : '#141414',
                  borderColor: capturingKey ? '#ef4444' : '#222',
                  color: capturingKey ? '#fca5a5' : '#fff',
                }}
              >
                {capturingKey ? 'Press a key…' : keyCodeLabel(ptt.keyCode)}
              </button>
            </div>
            <div className="px-3 py-2 border-b border-[#1a1a1a]">
              <span className="block text-[11px] text-white mb-1.5">Transmit channel</span>
              <select
                value={ptt.channelId == null ? '' : String(ptt.channelId)}
                onChange={(e) => patchPtt({ channelId: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full bg-[#141414] border border-[#222] text-[11px] text-white px-2 py-1.5"
                style={{ borderRadius: 2 }}
                aria-label="PTT transmit channel"
              >
                <option value="">Auto — first active channel</option>
                {pttChannels.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
            </div>
            <p className="px-3 py-2 text-[10px] text-rmpg-500">
              Every transmission is relayed to everyone on the channel and recorded to
              <span className="text-rmpg-400"> Radio → Recordings</span> automatically. An on-air
              indicator appears bottom-right while keyed.
            </p>
          </SectionCard>
        </div>

        {/* ── GPS MAPPER ── */}
        <div className="space-y-4">
          <SectionCard title="MAP — DEFAULT VIEW" icon={MapIcon}>
            <div className="px-3 py-2 border-b border-[#1a1a1a]">
              <span className="block text-[11px] text-white mb-1.5">Default map style</span>
              <select
                value={mapPrefs.defaultStyle}
                onChange={(e) => patchMap({ defaultStyle: e.target.value as MapStyleId })}
                className="w-full bg-[#141414] border border-[#222] text-[11px] text-white px-2 py-1.5"
                style={{ borderRadius: 2 }}
                aria-label="Default map style"
              >
                {(Object.keys(MAP_STYLE_LABELS) as MapStyleId[]).map((id) => (
                  <option key={id} value={id}>{MAP_STYLE_LABELS[id]} — {MAP_STYLE_DESCRIPTIONS[id]}</option>
                ))}
              </select>
            </div>
            <div className="px-3 pt-2 pb-1">
              <span className="text-[10px] uppercase tracking-wide text-rmpg-500">Base layers shown on load</span>
            </div>
            <ToggleRow label="Units" checked={mapPrefs.layers.units}
              onChange={(v) => patchMap({ layers: { ...mapPrefs.layers, units: v } })} />
            <ToggleRow label="Incidents / calls" checked={mapPrefs.layers.incidents}
              onChange={(v) => patchMap({ layers: { ...mapPrefs.layers, incidents: v } })} />
            <ToggleRow label="Properties" checked={mapPrefs.layers.properties}
              onChange={(v) => patchMap({ layers: { ...mapPrefs.layers, properties: v } })} />
          </SectionCard>

          <SectionCard title="MAP — ANALYTICS OVERLAYS" icon={MapPin}>
            <ToggleRow label="Incident heatmap" description="Density overlay on by default"
              checked={mapPrefs.overlays.heatmap}
              onChange={(v) => patchMap({ overlays: { ...mapPrefs.overlays, heatmap: v } })} />
            <ToggleRow label="Unit breadcrumb trails" description="Recent GPS track history"
              checked={mapPrefs.overlays.breadcrumbs}
              onChange={(v) => patchMap({ overlays: { ...mapPrefs.overlays, breadcrumbs: v } })} />
          </SectionCard>

          <SectionCard title="MAP — GPS TRACKING" icon={Crosshair}>
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

          <SectionCard title="MAP — MARKERS" icon={Gauge}>
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
                onClick={resetMap}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide border border-[#222] text-rmpg-400 hover:text-white hover:border-[#2e2e2e] transition-colors"
                style={{ borderRadius: 2 }}
              >
                <RotateCcw className="w-3 h-3" /> Reset map settings
              </button>
            </div>
          </SectionCard>

          <p className="text-[10px] text-rmpg-500 px-1">
            Map changes apply live — to an open Map page and other tabs — no reload needed.
          </p>
        </div>
      </div>
    </div>
  );
}
