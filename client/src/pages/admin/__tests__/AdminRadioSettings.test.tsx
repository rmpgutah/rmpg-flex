import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the API layer — the component reads /radio/settings (settings + the
// server-canonical option lists) and /radio/channels, and writes via PUT.
const apiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import AdminRadioSettings from '../AdminRadioSettings';

const SETTINGS = {
  ai_dispatcher_enabled: true, ai_respond_mode: 'all', ai_voice: 'asteria',
  ai_dispatch_callsign: 'DISPATCH', ai_persona: '', ai_temperature: 0.3, ai_max_reply_chars: 400,
  auto_record: true, auto_transcribe: true, recording_retention_days: 0,
  safety_alerts_enabled: true, stress_monitoring_enabled: true, duress_code: '',
  default_channel_id: null, default_operator_tab: 'live', notif_enabled_default: true,
  notif_sound_default: 'chime', quiet_start_default: '', quiet_end_default: '',
  haze_intensity: 'standard', noise_bed_level: 0.15, tts_over_radio: true,
};

// The option lists the worker now owns and returns via GET — the UI must
// render its dropdowns from THESE, not a hardcoded client copy.
const OPTIONS = {
  ai_voice: [
    { id: 'asteria', label: 'Asteria — Female, calm (default)' },
    { id: 'orion', label: 'Orion — Male, approachable' },
  ],
  ai_respond_mode: [{ id: 'all', label: 'all' }, { id: 'addressed', label: 'addressed' }],
  default_operator_tab: [{ id: 'live', label: 'live' }, { id: 'stats', label: 'stats' }],
  notif_sound_default: [{ id: 'chime', label: 'chime' }, { id: 'beep', label: 'beep' }],
  haze_intensity: [{ id: 'clean', label: 'clean' }, { id: 'standard', label: 'standard' }],
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path === '/radio/settings' && opts?.method === 'PUT') return Promise.resolve({ settings: SETTINGS });
    if (path === '/radio/settings') return Promise.resolve({ settings: SETTINGS, defaults: SETTINGS, options: OPTIONS });
    if (path === '/radio/channels') return Promise.resolve([]);
    return Promise.resolve(null);
  });
});

describe('AdminRadioSettings', () => {
  it('renders dropdowns from the server-provided options (single source of truth)', async () => {
    render(<AdminRadioSettings />);
    // The voice option label comes ONLY from the GET response's `options`.
    expect(await screen.findByRole('option', { name: 'Orion — Male, approachable' })).toBeInTheDocument();
    // A group header proves the panel mounted.
    expect(screen.getByText('AI Dispatcher')).toBeInTheDocument();
  });

  it('saves via PUT /radio/settings with the current settings', async () => {
    render(<AdminRadioSettings />);
    const saveBtn = await screen.findByRole('button', { name: /^Save$/ });
    await userEvent.click(saveBtn);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/radio/settings', expect.objectContaining({ method: 'PUT' })),
    );
    const putCall = apiFetch.mock.calls.find((c) => c[0] === '/radio/settings' && c[1]?.method === 'PUT');
    expect(putCall).toBeTruthy();
    expect(JSON.parse(putCall![1].body)).toMatchObject({ ai_voice: 'asteria', ai_respond_mode: 'all' });
  });
});
