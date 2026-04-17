// ============================================================
// Voice Persona Settings — user-facing tab inside UserProfileModal.
// Lets an officer/dispatcher pick from 4 curated Edge-TTS voices,
// adjust rate/pitch, choose a terseness mode, and preview the result.
// Backed by useVoicePersona (localStorage + /api/voice-persona).
// ============================================================

import { Volume2 } from 'lucide-react';
import { useVoicePersona } from '../../hooks/useVoicePersona';
import { speak } from '../../utils/edgeTTS';

const VOICES: Array<{ id: string; label: string }> = [
  { id: 'en-US-JennyNeural', label: 'Female — Calm' },
  { id: 'en-US-AriaNeural',  label: 'Female — Crisp' },
  { id: 'en-US-GuyNeural',   label: 'Male — Baritone' },
  { id: 'en-US-DavisNeural', label: 'Male — Tactical' },
];

const SAMPLE_LINE =
  'Priority one domestic at 123 Main Street, Delta 2-14, 3 Adam responding.';

export default function VoicePersonaSettings() {
  const { persona, setPersona } = useVoicePersona();

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Volume2 style={{ width: 11, height: 11, color: '#888888' }} />
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: '#888888' }}
        >
          Voice Persona
        </span>
      </div>

      <div
        className="space-y-3"
        style={{ background: '#050505', border: '1px solid #242424', padding: '10px 12px' }}
      >
        {/* Voice picker */}
        <label className="block">
          <span className="text-[11px]" style={{ color: '#888888' }}>
            Dispatcher voice
          </span>
          <select
            value={persona.voiceId}
            onChange={(e) => setPersona({ voiceId: e.target.value })}
            className="mt-1 w-full text-xs p-1"
            style={{
              background: '#0a0a0a',
              border: '1px solid #222222',
              color: '#dddddd',
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
          <span className="text-[11px]" style={{ color: '#888888' }}>
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
                    background: active ? '#1a1a1a' : '#0a0a0a',
                    border: `1px solid ${active ? '#d4a017' : '#222222'}`,
                    color: active ? '#d4a017' : '#888888',
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
          <span className="text-[11px]" style={{ color: '#888888' }}>
            Rate: {persona.rate.toFixed(2)}x
          </span>
          <input
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
          <span className="text-[11px]" style={{ color: '#888888' }}>
            Pitch: {persona.pitch > 0 ? '+' : ''}{persona.pitch}
          </span>
          <input
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
            background: '#1a1a1a',
            border: '1px solid #d4a017',
            color: '#d4a017',
            borderRadius: 2,
          }}
        >
          Preview
        </button>
      </div>
    </div>
  );
}
