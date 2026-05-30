import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, RotateCcw, Bot, Mic, SlidersHorizontal, Radio as RadioIcon, Volume2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';

// ============================================================
// Admin → Radio → Settings
// ============================================================
// Org-wide radio + AI-dispatcher control panel. Reads/writes
// /api/radio/settings (system_config category 'radio_settings').
// The worker (VoiceHubDO + aiDispatcher) reads these on each
// dispatch, so every change here is LIVE on the next transmission.
// ============================================================

interface RadioSettings {
  ai_dispatcher_enabled: boolean;
  ai_respond_mode: 'all' | 'addressed';
  ai_voice: string;
  ai_dispatch_callsign: string;
  ai_persona: string;
  ai_temperature: number;
  ai_max_reply_chars: number;
  auto_record: boolean;
  auto_transcribe: boolean;
  recording_retention_days: number;
  default_channel_id: number | null;
  default_operator_tab: string;
  notif_enabled_default: boolean;
  notif_sound_default: string;
  quiet_start_default: string;
  quiet_end_default: string;
  haze_intensity: 'clean' | 'light' | 'standard' | 'heavy';
  noise_bed_level: number;
  tts_over_radio: boolean;
}

interface ChannelOpt { id: number; name: string; archived_at: string | null }

// Dropdown options come from the server (GET /radio/settings → `options`), so
// the worker stays the single source of truth for voices/tabs/sounds/etc.
interface SettingOption { id: string; label: string }
type OptionsMap = {
  ai_voice: SettingOption[];
  ai_respond_mode: SettingOption[];
  default_operator_tab: SettingOption[];
  notif_sound_default: SettingOption[];
  haze_intensity: SettingOption[];
};
const EMPTY_OPTIONS: OptionsMap = {
  ai_voice: [], ai_respond_mode: [], default_operator_tab: [], notif_sound_default: [], haze_intensity: [],
};

// ── Reusable field primitives (match the Admin dark theme) ──
function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div>
        <div className="text-[11px] text-gray-300">{label}</div>
        {hint && <div className="text-[10px] text-gray-600">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-sm transition-colors flex-shrink-0"
        style={{
          background: checked ? 'rgba(212,160,23,0.12)' : '#0c0c0c',
          border: `1px solid ${checked ? '#d4a017' : '#222'}`,
          color: checked ? '#d4a017' : '#888',
        }}
      >
        {checked ? 'On' : 'Off'}
      </button>
    </div>
  );
}

function Segmented({ value, options, onChange, label }: { value: string; options: SettingOption[]; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="text-[11px] text-gray-300">{label}</div>
      <div className="flex gap-1 flex-wrap justify-end">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-wider rounded-sm"
            style={{
              border: `1px solid ${value === o.id ? '#d4a017' : '#222'}`,
              color: value === o.id ? '#d4a017' : '#888',
              background: value === o.id ? 'rgba(212,160,23,0.10)' : 'transparent',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GroupCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#141414] border border-[#181818] rounded-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#181818]">
        {icon}
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-300">{title}</h3>
      </div>
      <div className="p-3 space-y-1.5">{children}</div>
    </section>
  );
}

const inputCls =
  'bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm px-2 py-1 text-[11px] text-gray-200 focus:border-[#d4a017] outline-none';

export default function AdminRadioSettings() {
  const [settings, setSettings] = useState<RadioSettings | null>(null);
  const [defaults, setDefaults] = useState<RadioSettings | null>(null);
  const [options, setOptions] = useState<OptionsMap>(EMPTY_OPTIONS);
  const [channels, setChannels] = useState<ChannelOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, ch] = await Promise.all([
        apiFetch<{ settings: RadioSettings; defaults: RadioSettings; options?: Partial<OptionsMap> }>('/radio/settings'),
        apiFetch<ChannelOpt[]>('/radio/channels'),
      ]);
      setSettings(s.settings);
      setDefaults(s.defaults);
      setOptions({ ...EMPTY_OPTIONS, ...(s.options ?? {}) });
      setChannels(asArray<ChannelOpt>(ch).filter((c) => !c.archived_at));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load radio settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // One typed setter for every field.
  const set = useCallback(<K extends keyof RadioSettings>(key: K, value: RadioSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSavedAt(null);
  }, []);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ settings: RadioSettings }>('/radio/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(res.settings);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const resetDefaults = useCallback(() => {
    if (defaults) { setSettings({ ...defaults }); setSavedAt(null); }
  }, [defaults]);

  const dirty = useMemo(() => savedAt == null, [savedAt]);

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-16">
        {error ? <span className="text-xs text-red-400">{error}</span> : <Loader2 className="animate-spin text-gray-500" size={20} />}
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-3xl">
      {/* Action bar */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3 flex items-center justify-between gap-3 sticky top-0 z-10">
        <div>
          <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wide">Radio Settings</h2>
          <p className="text-[11px] text-gray-500">
            Org-wide. The AI dispatcher reads these live — changes apply on the next transmission.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-[10px] text-emerald-400">Saved ✓</span>}
          <button onClick={resetDefaults} className="flex items-center gap-1.5 text-gray-400 hover:text-gray-200 text-[11px] px-2 py-1.5" title="Reset all to defaults">
            <RotateCcw size={12} /> Defaults
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 bg-[#d4a017] hover:bg-[#a16207] disabled:opacity-50 text-black px-3 py-1.5 rounded-sm text-xs font-semibold transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-[#1a0a0a] border border-[#3d1414] text-red-400 text-xs px-3 py-2 rounded-sm">{error}</div>
      )}

      {/* ── AI Dispatcher ── */}
      <GroupCard icon={<Bot size={14} className="text-[#d4a017]" />} title="AI Dispatcher">
        <Toggle label="AI dispatcher enabled" hint="Master switch. When off, the radio still records but never speaks back." checked={settings.ai_dispatcher_enabled} onChange={(v) => set('ai_dispatcher_enabled', v)} />
        <Segmented label="Respond mode" value={settings.ai_respond_mode} options={options.ai_respond_mode} onChange={(v) => set('ai_respond_mode', v as RadioSettings['ai_respond_mode'])} />
        <div className="text-[10px] text-gray-600 -mt-1">“all” answers every transmission; “addressed” only when a unit calls dispatch (or asks for a lookup/log).</div>
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="text-[11px] text-gray-300">Dispatcher voice</div>
          <select aria-label="Dispatcher voice" className={inputCls} value={settings.ai_voice} onChange={(e) => set('ai_voice', e.target.value)}>
            {options.ai_voice.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="text-[11px] text-gray-300">Dispatcher call-sign</div>
          <input aria-label="Dispatcher call-sign" className={`${inputCls} w-40 font-mono`} value={settings.ai_dispatch_callsign} maxLength={32} onChange={(e) => set('ai_dispatch_callsign', e.target.value)} />
        </div>
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="text-[11px] text-gray-300">Reasoning temperature <span className="text-gray-600">({settings.ai_temperature.toFixed(2)})</span></div>
          <input aria-label="Reasoning temperature" type="range" min={0} max={1} step={0.05} value={settings.ai_temperature} onChange={(e) => set('ai_temperature', Number(e.target.value))} className="w-40" />
        </div>
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="text-[11px] text-gray-300">Max reply length (chars)</div>
          <input aria-label="Max reply length" type="number" min={40} max={1200} className={`${inputCls} w-24 font-mono`} value={settings.ai_max_reply_chars} onChange={(e) => set('ai_max_reply_chars', parseInt(e.target.value, 10) || 0)} />
        </div>
        <div className="pt-1">
          <label className="block text-[11px] text-gray-300 mb-1">Persona / extra directives</label>
          <textarea
            aria-label="Persona directives"
            className={`${inputCls} w-full h-24 resize-y leading-relaxed`}
            placeholder="Optional. Appended to the built-in dispatcher policy — e.g. 'Address units as Officer <name>. Always advise weather on Code 3 calls.'"
            value={settings.ai_persona}
            onChange={(e) => set('ai_persona', e.target.value)}
          />
          <div className="text-[10px] text-gray-600 mt-0.5">Refines tone/behavior; the core radio procedure + 10-codes always stay in effect.</div>
        </div>
      </GroupCard>

      {/* ── Recording & Transcription ── */}
      <GroupCard icon={<Mic size={14} className="text-[#d4a017]" />} title="Recording & Transcription">
        <Toggle label="Record transmissions" hint="When off, transmissions are still logged but no audio is kept." checked={settings.auto_record} onChange={(v) => set('auto_record', v)} />
        <Toggle label="Auto-transcribe (Whisper)" hint="Transcribe clips that arrive without a client transcript." checked={settings.auto_transcribe} onChange={(v) => set('auto_transcribe', v)} />
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="text-[11px] text-gray-300">Recording retention <span className="text-gray-600">(days, 0 = forever)</span></div>
          <input aria-label="Recording retention days" type="number" min={0} max={3650} className={`${inputCls} w-24 font-mono`} value={settings.recording_retention_days} onChange={(e) => set('recording_retention_days', parseInt(e.target.value, 10) || 0)} />
        </div>
        <div className="text-[10px] text-gray-600 -mt-1">Old recordings + audio are purged on the 4-hourly cron.</div>
      </GroupCard>

      {/* ── Channel defaults & operator UX ── */}
      <GroupCard icon={<SlidersHorizontal size={14} className="text-[#d4a017]" />} title="Channel Defaults & Operator UX">
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="text-[11px] text-gray-300">Default channel</div>
          <select aria-label="Default channel" className={inputCls} value={settings.default_channel_id ?? ''} onChange={(e) => set('default_channel_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— none —</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <Segmented label="Operator landing tab" value={settings.default_operator_tab} options={options.default_operator_tab} onChange={(v) => set('default_operator_tab', v)} />
        <Toggle label="Desktop notifications (default)" checked={settings.notif_enabled_default} onChange={(v) => set('notif_enabled_default', v)} />
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="text-[11px] text-gray-300">Notification sound (default)</div>
          <select aria-label="Default notification sound" className={inputCls} value={settings.notif_sound_default} onChange={(e) => set('notif_sound_default', e.target.value)}>
            {options.notif_sound_default.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="text-[11px] text-gray-300">Quiet hours (default)</div>
          <div className="flex items-center gap-1">
            <input aria-label="Quiet hours start" type="time" className={`${inputCls} font-mono`} value={settings.quiet_start_default} onChange={(e) => set('quiet_start_default', e.target.value)} />
            <span className="text-gray-600 text-[10px]">to</span>
            <input aria-label="Quiet hours end" type="time" className={`${inputCls} font-mono`} value={settings.quiet_end_default} onChange={(e) => set('quiet_end_default', e.target.value)} />
          </div>
        </div>
        <div className="text-[10px] text-gray-600 -mt-1">Seed values for new devices — operators can still override locally on their console.</div>
      </GroupCard>

      {/* ── Radio audio / P25 effect ── */}
      <GroupCard icon={<RadioIcon size={14} className="text-[#d4a017]" />} title="Radio Audio / P25 Effect">
        <Toggle label="Apply radio “haze” to speech" hint="Run dispatcher/alert TTS through the P25 effect chain." checked={settings.tts_over_radio} onChange={(v) => set('tts_over_radio', v)} />
        <Segmented label="Haze intensity" value={settings.haze_intensity} options={options.haze_intensity} onChange={(v) => set('haze_intensity', v as RadioSettings['haze_intensity'])} />
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="text-[11px] text-gray-300 flex items-center gap-1"><Volume2 size={11} className="text-gray-600" /> Noise-bed level <span className="text-gray-600">({Math.round(settings.noise_bed_level * 100)}%)</span></div>
          <input aria-label="Noise bed level" type="range" min={0} max={1} step={0.05} value={settings.noise_bed_level} onChange={(e) => set('noise_bed_level', Number(e.target.value))} className="w-40" />
        </div>
      </GroupCard>

      <p className="text-[10px] text-gray-600 italic pb-2">
        AI dispatcher, recording, transcription, retention, and default channel apply server-side immediately.
        Audio/haze + operator-UX defaults are read by each operator console.
      </p>
    </div>
  );
}
