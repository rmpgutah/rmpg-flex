// ============================================================
// Voice Persona Settings — user-facing tab inside UserProfileModal.
// Lets an officer/dispatcher pick a dispatcher voice, adjust rate/pitch,
// choose a terseness mode, and preview the result.
// Backed by useVoicePersona (localStorage + /api/voice-persona).
//
// ⚠️ Voices come from utils/voiceCatalog — do NOT reintroduce a local list.
// This component used to carry its own 4-entry array of Edge-TTS ids
// ('en-US-JennyNeural', …) which differed from the SettingsPage list AND
// was invalid for the Aura-2 server, so every pick here silently coerced to
// the default. One catalog, one source of truth.
// ============================================================

import { Volume2 } from 'lucide-react';
import { useVoicePersona } from '../../hooks/useVoicePersona';
import { speak } from '../../utils/edgeTTS';
import { VOICE_CATALOG } from '../../utils/voiceCatalog';

const VOICES: Array<{ id: string; label: string }> = VOICE_CATALOG.map((v) => ({
  id: v.id,
  label: `${v.gender === 'female' ? 'Female' : 'Male'} — ${v.label}`,
}));

const SAMPLE_LINE =
  'Priority one domestic at 123 Main Street, Delta 2-14, 3 Adam responding.';

export default function VoicePersonaSettings() {
  const { persona, setPersona } = useVoicePersona();

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Volume2 style={{ width: 11, height: 11, color: 'var(--text-muted)' }} />
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Voice Persona
        </span>
      </div>

      <div
        className="space-y-3"
        style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', padding: '10px 12px' }}
      >
        {/* Voice picker */}
        <label className="block">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Dispatcher voice
          </span>
          <select id="ff-voicepersonasettings-0"
            value={persona.voiceId}
            onChange={(e) => setPersona({ voiceId: e.target.value })}
            className="mt-1 w-full text-xs p-1"
            style={{
              background: 'var(--surface-overlay)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              borderRadius: 2,
            }}
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        {/* Terseness radio */}
        <div>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Terseness
          </span>
          <div className="flex gap-2 mt-1">
            {(['narrative', 'standard', 'terse'] as const).map((t) => {
              const active = persona.terseness === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPersona({ terseness: t })}
                  className="px-3 py-1 text-[11px] uppercase tracking-wider"
                  style={{
                    background: active ? 'var(--surface-raised)' : 'var(--surface-overlay)',
                    border: `1px solid ${active ? 'var(--accent-silver-400)' : 'var(--border-subtle)'}`,
                    color: active ? 'var(--accent-silver-400)' : 'var(--text-muted)',
                    borderRadius: 2,
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rate slider */}
        <label className="block">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Rate: {persona.rate.toFixed(2)}x
          </span>
          <input id="ff-voicepersonasettings-1"
            type="range"
            min="0.7"
            max="1.4"
            step="0.05"
            value={persona.rate}
            onChange={(e) => setPersona({ rate: Number(e.target.value) })}
            className="mt-1 w-full"
          />
        </label>

        {/* Pitch slider */}
        <label className="block">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Pitch: {persona.pitch > 0 ? '+' : ''}{persona.pitch}
          </span>
          <input id="ff-voicepersonasettings-2"
            type="range"
            min="-20"
            max="20"
            step="1"
            value={persona.pitch}
            onChange={(e) => setPersona({ pitch: Number(e.target.value) })}
            className="mt-1 w-full"
          />
        </label>

        {/* Preview */}
        <button
          type="button"
          onClick={() => { speak(SAMPLE_LINE).catch(() => { /* best-effort */ }); }}
          className="px-3 py-1 text-[11px] uppercase tracking-wider"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--accent-silver-400)',
            color: 'var(--accent-silver-400)',
            borderRadius: 2,
          }}
        >
          Preview
        </button>
      </div>

      {/* Dispatcher Brain master switch — Phase 2 kill switch */}
      <div className="mt-4">
        <div className="flex items-center gap-1.5 mb-2">
          <Volume2 style={{ width: 11, height: 11, color: 'var(--text-muted)' }} />
          <span
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            Dispatcher Brain (Beta)
          </span>
        </div>
        <div
          className="flex items-center justify-between"
          style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', padding: '10px 12px' }}
        >
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Proactive coaching + event announcements
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={persona.brainEnabled}
            onClick={() => setPersona({ brainEnabled: !persona.brainEnabled })}
            className="px-3 py-1 text-[11px] uppercase tracking-wider"
            style={{
              background: persona.brainEnabled ? 'var(--surface-raised)' : 'var(--surface-overlay)',
              border: `1px solid ${persona.brainEnabled ? 'var(--accent-silver-400)' : 'var(--border-subtle)'}`,
              color: persona.brainEnabled ? 'var(--accent-silver-400)' : 'var(--text-muted)',
              borderRadius: 2,
            }}
          >
            {persona.brainEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        <p className="text-[10px] mt-1 text-fg-muted">
          When off, no coaching or event-driven speech. New calls & alerts still announce as usual.
        </p>
      </div>
    </div>
  );
}
