import React, { useEffect, useState, useCallback } from 'react';
import {
  Volume2, VolumeX, Play, AlertTriangle, Activity, Navigation,
  Phone, MapPin, Zap, RefreshCw, Bell,
} from 'lucide-react';
import {
  type AlertCategory,
  isAlertSoundEnabled,
  setAlertSoundEnabled,
  getAllAlertPrefs,
  subscribeAlertPrefs,
} from '../../utils/alertSoundPrefs';
import { playToneAsync, type ToneType } from '../../utils/dispatchTones';
import { flashAlert } from '../../utils/alertFlash';

// ============================================================
// Admin → Alert Sounds — per-category mute toggles + previews
// ============================================================
// Lets dispatchers individually silence alert categories without
// touching the global mute. Each row offers a Test button that
// fires the exact tone + flash the dispatch console would emit
// for that event in production, so the operator can audition
// before a real incident.
//
// Settings persist in localStorage (rmpg-alert-sound-prefs JSON);
// changes propagate cross-tab via the storage event so a dispatcher
// adjusting from the admin page sees the same state as their
// dispatch console.
// ============================================================

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface CategorySpec {
  category: AlertCategory;
  label: string;
  description: string;
  tone: ToneType;             // matching dispatchTones.ts profile
  flash?: 'warning' | 'critical' | 'pursuit' | 'info';
  voicePreview?: string;      // text to speak alongside the tone
  icon: React.ComponentType<{ className?: string }>;
  warnIfMuted?: boolean;      // show a callout if this gets disabled
  group: 'GPS' | 'Speed' | 'Calls' | 'Spatial' | 'Safety';
}

// Each category mirrors the wiring in WebSocketContext so previews
// match real-world behavior 1:1.
const CATEGORIES: CategorySpec[] = [
  // ── GPS ──
  {
    category: 'gps_gap_warning',
    label: 'GPS Gap — Warning',
    description: '5 minutes of OwnTracks silence on an active unit. Soft 2-pip A5.',
    tone: 'gps_warn', flash: 'warning', icon: Navigation, group: 'GPS',
  },
  {
    category: 'gps_gap_critical',
    label: 'GPS Gap — Critical',
    description: '15+ minutes silent. Descending 3-pip + voice "Unit XXXX GPS lost".',
    tone: 'gps_lost', flash: 'critical', voicePreview: 'Unit S19 GPS lost.',
    icon: AlertTriangle, group: 'GPS',
  },
  {
    category: 'gps_recovered',
    label: 'GPS Restored',
    description: 'Stale unit reported again. Brief ascending chime.',
    tone: 'gps_restored', voicePreview: 'Unit S19 GPS restored.',
    icon: Activity, group: 'GPS',
  },

  // ── Speed ──
  {
    category: 'pursuit_speed',
    label: 'Pursuit Speed (≥100 mph)',
    description: 'Critical-tier speed alert. APX-style warble + voice.',
    tone: 'pursuit_alert', flash: 'pursuit',
    voicePreview: 'Pursuit speed alert. Unit S19. 105 miles per hour.',
    icon: Zap, group: 'Speed',
  },
  {
    category: 'speed_alert',
    label: 'High Speed (80–99 mph)',
    description: 'Sub-pursuit speed alert. Standard warning tone + amber flash.',
    tone: 'warning', flash: 'warning', icon: Activity, group: 'Speed',
  },

  // ── Calls ──
  {
    category: 'p1_call',
    label: 'Priority 1 Call',
    description: 'New / updated P1 call. Two-tone square wave 880+1100 Hz + red flash.',
    tone: 'p1_alert', flash: 'critical', icon: Phone, group: 'Calls',
  },
  {
    category: 'p2_call',
    label: 'Priority 2 Call',
    description: 'New / updated P2 call. 660 Hz triangle wave + amber flash.',
    tone: 'caution', flash: 'warning', icon: Phone, group: 'Calls',
  },

  // ── Spatial ──
  {
    category: 'beat_breach',
    label: 'Unit Outside Assigned Beat',
    description: 'Unit drifted across its assigned beat polygon. Single notch tone (no voice).',
    tone: 'beat_breach', icon: MapPin, group: 'Spatial',
  },

  // ── Safety ──
  {
    category: 'panic',
    label: 'Panic Button',
    description: 'Officer panic activation. ALARM SOUND + voice + red flash.',
    tone: 'panic_continuous', flash: 'critical',
    voicePreview: 'Panic alert. Officer needs immediate assistance.',
    icon: Bell, group: 'Safety', warnIfMuted: true,
  },
];

const GROUP_ORDER: CategorySpec['group'][] = ['Safety', 'GPS', 'Speed', 'Calls', 'Spatial'];

export default function AdminAlertSoundsTab({ LoadingSpinner }: Props) {
  // Track every category's enabled state. Initialized from prefs and
  // updated optimistically when the dispatcher toggles.
  const [prefs, setPrefs] = useState<Record<AlertCategory, boolean>>(() => getAllAlertPrefs());
  const [globalMuted, setGlobalMuted] = useState<boolean>(() => localStorage.getItem('rmpg-sound') === 'false');
  const [testingCategory, setTestingCategory] = useState<AlertCategory | null>(null);

  // Cross-tab + same-tab change subscription so toggling in another
  // window updates this view live.
  useEffect(() => {
    return subscribeAlertPrefs(() => setPrefs(getAllAlertPrefs()));
  }, []);

  // Same listener for the global mute toggle (changed via the menu bar).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'rmpg-sound') setGlobalMuted(e.newValue === 'false');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback((cat: AlertCategory) => {
    const next = !isAlertSoundEnabled(cat);
    setAlertSoundEnabled(cat, next);
    setPrefs(p => ({ ...p, [cat]: next }));
  }, []);

  // Test a category's audio + visual output exactly as production fires it.
  // Includes the visual flash so dispatchers can verify the strobe color
  // matches their environment (e.g. evening shift glare on the screen).
  const testCategory = useCallback(async (spec: CategorySpec) => {
    setTestingCategory(spec.category);
    try {
      // Always preview, regardless of mute state — this is a deliberate
      // test action, not a normal alert. Bypass via direct playToneAsync.
      if (spec.flash) flashAlert(spec.flash);
      await playToneAsync(spec.tone);
      // Voice preview is best-effort; if speech synthesis fails we
      // don't surface the error since the tone preview was the point.
      if (spec.voicePreview && 'speechSynthesis' in window) {
        try {
          const u = new SpeechSynthesisUtterance(spec.voicePreview);
          u.rate = 1.05;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } catch { /* ignore */ }
      }
    } finally {
      setTimeout(() => setTestingCategory(null), 600);
    }
  }, []);

  const grouped = GROUP_ORDER.map(g => ({
    group: g,
    items: CATEGORIES.filter(c => c.group === g),
  }));

  const mutedCount = (Object.values(prefs).filter(v => v === false)).length;

  return (
    <div className="p-4 space-y-4">
      {/* Header callout */}
      <div className="flex items-start gap-3 p-3 border border-[#222] bg-surface-raised" style={{ borderRadius: 2 }}>
        <Volume2 className="w-5 h-5 text-[#d4a017] flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-white mb-1">Alert Sound Preferences</h2>
          <p className="text-[12px] text-[#aaa] leading-relaxed">
            Fine-grained control over which alert categories play audio + visual cues.
            Settings are <strong className="text-white">per-browser</strong> (localStorage)
            and propagate live to other tabs. The global mute toggle in the menu bar
            silences every category at once and overrides these settings.
          </p>
          {globalMuted && (
            <div className="mt-2 px-2 py-1 bg-[#3a1818] border border-red-700/50 text-red-300 text-[11px]" style={{ borderRadius: 2 }}>
              <VolumeX className="inline w-3 h-3 mr-1" />
              Global sound is currently MUTED. Per-category settings below have no effect until you re-enable sounds.
            </div>
          )}
          {mutedCount > 0 && !globalMuted && (
            <div className="mt-2 text-[11px] text-amber-400">
              {mutedCount} {mutedCount === 1 ? 'category' : 'categories'} silenced.
            </div>
          )}
        </div>
      </div>

      {/* Grouped category list */}
      {grouped.map(({ group, items }) => (
        <div key={group} className="border border-[#222] bg-surface-raised" style={{ borderRadius: 2 }}>
          <div className="px-3 py-2 border-b border-[#222] bg-surface-base">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#d4a017]">{group}</h3>
          </div>
          {items.map(spec => {
            const enabled = prefs[spec.category];
            const Icon = spec.icon;
            const isTesting = testingCategory === spec.category;
            return (
              <div
                key={spec.category}
                className="flex items-center gap-3 px-3 py-2 border-b border-[#1a1a1a] last:border-b-0 hover:bg-[#141414]"
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${enabled ? 'text-white' : 'text-[#555]'}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] font-medium ${enabled ? 'text-white' : 'text-[#888]'}`}>
                    {spec.label}
                    {spec.warnIfMuted && !enabled && (
                      <span className="ml-2 px-1.5 py-0.5 bg-red-900/40 border border-red-700/50 text-red-300 text-[9px] uppercase tracking-wide" style={{ borderRadius: 2 }}>
                        Safety risk
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#777] truncate">{spec.description}</div>
                </div>

                {/* Test button — fires real tone + flash + voice preview */}
                <button
                  type="button"
                  onClick={() => testCategory(spec)}
                  disabled={isTesting}
                  className="px-2 py-1 text-[11px] font-mono bg-surface-base border border-[#2e2e2e] hover:border-[#d4a017] hover:text-[#d4a017] text-[#aaa] disabled:opacity-50 flex items-center gap-1"
                  style={{ borderRadius: 2 }}
                  title="Preview this alert's tone + flash + voice"
                >
                  {isTesting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Test
                </button>

                {/* Mute / unmute toggle. Panic shows a confirmation. */}
                <button
                  type="button"
                  onClick={() => {
                    if (spec.warnIfMuted && enabled) {
                      const ok = window.confirm(
                        `Mute ${spec.label}?\n\nThis is a safety-critical alert. ` +
                        `Muting it means you will not hear panic activations from this browser. ` +
                        `The visual flash will still fire.\n\nProceed?`
                      );
                      if (!ok) return;
                    }
                    toggle(spec.category);
                  }}
                  className={`px-2 py-1 text-[11px] font-mono flex items-center gap-1 border ${
                    enabled
                      ? 'bg-green-900/30 border-green-700/50 text-green-400'
                      : 'bg-[#1a1a1a] border-[#444] text-[#888]'
                  }`}
                  style={{ borderRadius: 2 }}
                  aria-label={enabled ? `Mute ${spec.label}` : `Unmute ${spec.label}`}
                >
                  {enabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                  {enabled ? 'On' : 'Muted'}
                </button>
              </div>
            );
          })}
        </div>
      ))}

      {/* Bulk actions */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Re-enable all alert sounds?')) {
              CATEGORIES.forEach(c => setAlertSoundEnabled(c.category, true));
              setPrefs(getAllAlertPrefs());
            }
          }}
          className="px-3 py-1.5 text-[12px] font-mono border border-[#2e2e2e] hover:border-[#d4a017] hover:text-[#d4a017] text-[#aaa]"
          style={{ borderRadius: 2 }}
        >
          Reset all to default
        </button>
        <span className="text-[10px] text-[#666]">Defaults: every category enabled.</span>
      </div>

      {/* Suppress unused-import warning for LoadingSpinner — included for prop
         contract consistency with sibling tabs. */}
      <span className="hidden"><LoadingSpinner /></span>
    </div>
  );
}
