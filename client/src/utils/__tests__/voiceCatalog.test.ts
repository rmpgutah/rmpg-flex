// Guards the invariant that broke the picker: every catalog id must be a
// real Aura-2 speaker, or resolveAura2Voice() silently coerces it to the
// default and the user's choice does nothing.
import { describe, it, expect } from 'vitest';
import { VOICE_CATALOG, DEFAULT_VOICE_ID, getVoiceOption } from '../voiceCatalog';

// Mirrors AURA2_EN_VOICES in src/utils/aiDispatcher.ts (40 speakers).
// Intentionally duplicated: the client cannot import from the Worker tree.
const AURA2_EN_VOICES = new Set([
  'amalthea', 'andromeda', 'apollo', 'arcas', 'aries', 'asteria', 'athena', 'atlas',
  'aurora', 'callista', 'cora', 'cordelia', 'delia', 'draco', 'electra', 'harmonia',
  'helena', 'hera', 'hermes', 'hyperion', 'iris', 'janus', 'juno', 'jupiter', 'luna',
  'mars', 'minerva', 'neptune', 'odysseus', 'ophelia', 'orion', 'orpheus', 'pandora',
  'phoebe', 'pluto', 'saturn', 'thalia', 'theia', 'vesta', 'zeus',
]);

describe('voiceCatalog', () => {
  it('offers only real Aura-2 speakers', () => {
    const bad = VOICE_CATALOG.filter((v) => !AURA2_EN_VOICES.has(v.id));
    expect(bad.map((v) => v.id)).toEqual([]);
  });

  it('defaults to harmonia', () => {
    expect(DEFAULT_VOICE_ID).toBe('harmonia');
    expect(VOICE_CATALOG.some((v) => v.id === 'harmonia')).toBe(true);
  });

  it('never offers selene — it is not in the Aura-2 allowlist', () => {
    expect(VOICE_CATALOG.some((v) => v.id === 'selene')).toBe(false);
  });

  it('does not label athena female — it measured 145 Hz, male register', () => {
    const athena = VOICE_CATALOG.find((v) => v.id === 'athena');
    if (athena) expect(athena.gender).toBe('male');
  });

  it('has unique ids and non-empty labels', () => {
    const ids = VOICE_CATALOG.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(VOICE_CATALOG.every((v) => v.label.length > 0)).toBe(true);
  });

  it('coerces an unknown or stale Edge-TTS id to the default', () => {
    expect(getVoiceOption('en-US-JennyNeural').id).toBe('harmonia');
    expect(getVoiceOption(null).id).toBe('harmonia');
    expect(getVoiceOption(undefined).id).toBe('harmonia');
  });
});
