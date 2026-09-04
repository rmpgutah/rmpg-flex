import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SettingsPage from '../SettingsPage';

// Hold a ref so individual tests can override the response per-call if needed.
const apiFetchMock = vi.fn(async (_path: string, _init?: RequestInit) => {
  return [] as unknown;
});

vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...(args as [string, RequestInit?])),
}));

vi.mock('../../hooks/useVoicePersona', () => ({
  useVoicePersona: () => ({
    persona: { voiceId: 'aria-en-us', rate: 1, pitch: 0, terseness: 'standard' },
    setPersona: vi.fn(),
  }),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'officer' } }),
}));

vi.mock('../../context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ prefs: { font_scale: 1.0 } }),
}));

// edgeTTS preview shouldn't try to play audio in jsdom.
vi.mock('../../utils/edgeTTS', () => ({
  speak: vi.fn(),
  clearQueue: vi.fn(),
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    document.title = 'RMPG Flex';
    window.history.replaceState(null, '', '/');
  });

  it('renders the Display & Theme section with all three theme choices', async () => {
    await act(async () => { render(<MemoryRouter><SettingsPage /></MemoryRouter>); });
    expect(screen.getByText('DISPLAY & THEME')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Auto/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Night/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Day/i })).toBeInTheDocument();
  });

  it('persists the theme override to localStorage when a manual theme is picked', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^Day/i }));

    await waitFor(() => {
      const raw = localStorage.getItem('rmpg_theme_override');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.theme).toBe('light');
      expect(parsed.active).toBe(true);
    });

    // Best-effort server sync of theme_preference.
    const calls = apiFetchMock.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('/user/preferences'),
    );
    expect(calls.length).toBeGreaterThan(0);
  });

  it('clears the override when Auto is chosen', async () => {
    localStorage.setItem('rmpg_theme_override', JSON.stringify({ theme: 'light', active: true }));
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^Auto/i }));

    await waitFor(() => {
      const raw = localStorage.getItem('rmpg_theme_override');
      const parsed = raw ? JSON.parse(raw) : null;
      // Auto = stored but inactive (matches UserProfileModal behavior).
      expect(parsed?.active).toBe(false);
    });
  });

  it('toggles the legacy black kill-switch via localStorage', async () => {
    await act(async () => { render(<MemoryRouter><SettingsPage /></MemoryRouter>); });
    const toggle = screen.getByRole('switch', { name: /Legacy pure-black mode/i });
    expect(localStorage.getItem('rmpg_theme_legacy')).toBeNull();
    fireEvent.click(toggle);
    expect(localStorage.getItem('rmpg_theme_legacy')).toBe('1');
    fireEvent.click(toggle);
    expect(localStorage.getItem('rmpg_theme_legacy')).toBeNull();
  });

  it('scrolls to the requested section when ?section= is set', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    // Mount raw rAF synchronously so the effect's rAF callback fires in the same tick.
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    // Capture the MemoryRouter's location after the section param is consumed.
    // useSearchParams / setSearchParams update the router's in-memory location;
    // they do NOT touch window.location.search (MemoryRouter is sandboxed).
    let capturedSearch: string | null = null;
    function LocationSpy() {
      const [sp] = useSearchParams();
      capturedSearch = sp.toString();
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/settings?section=tones']}>
        <SettingsPage />
        <LocationSpy />
      </MemoryRouter>,
    );

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    // The param should be stripped from the router URL after consumption.
    await waitFor(() => expect(capturedSearch).toBe(''));

    rafSpy.mockRestore();
  });

  it('ignores unknown ?section= values without scrolling', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    let capturedSearch: string | null = null;
    function LocationSpy() {
      const [sp] = useSearchParams();
      capturedSearch = sp.toString();
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/settings?section=bogus']}>
        <SettingsPage />
        <LocationSpy />
      </MemoryRouter>,
    );

    expect(scrollSpy).not.toHaveBeenCalled();
    // Unknown param is kept (we only strip whitelisted ones).
    await waitFor(() => expect(capturedSearch).toBe('section=bogus'));

    rafSpy.mockRestore();
  });
});
