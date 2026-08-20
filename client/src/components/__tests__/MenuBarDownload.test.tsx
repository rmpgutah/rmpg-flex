import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import MenuBar from '../MenuBar';

// MenuBar calls useNavigate() and useLocation() (MenuBar.tsx:102-103), so it
// throws outside a Router. There was no existing MenuBar test to copy a
// wrapper from — this is the first one.
const renderMenuBar = () =>
  render(
    <MemoryRouter>
      <MenuBar
        isAdmin={false}
        isConnected
        onLogout={() => {}}
        onSearch={() => {}}
        onShowShortcuts={() => {}}
        onRefreshData={() => {}}
      />
    </MemoryRouter>,
  );

const WIN_URL = 'https://api.rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.6.zip';

const apiFetchMock = vi.fn();

vi.mock('../../hooks/useApi', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useApi')>('../../hooks/useApi');
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args) };
});

/** Open the Help menu, where both installer entries live (MenuBar.tsx:883). */
async function openHelpMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: /help menu/i }));
  return user;
}

describe('MenuBar desktop installer link', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    vi.stubGlobal('open', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens the currently published artifact, not a hardcoded version', async () => {
    apiFetchMock.mockResolvedValue({
      win: { filename: 'RMPG-Flex-Setup-5.8.6.zip', version: '5.8.6', size: '98.0 MB', bytes: 102790778, url: WIN_URL },
    });
    renderMenuBar();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    const user = await openHelpMenu();
    await user.click(screen.getByRole('menuitem', { name: /download installer \(windows\)/i }));

    // The previous code opened a literal
    // https://rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.1.exe — the wrong
    // origin (Pages, which returns the app shell) AND a filename five releases
    // stale that no longer exists in the bucket.
    expect(window.open).toHaveBeenCalledWith(WIN_URL, '_blank', 'noopener,noreferrer');
  });

  it('does not open a direct file URL when the installer list has not loaded', async () => {
    apiFetchMock.mockRejectedValue(new Error('offline'));
    renderMenuBar();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    const user = await openHelpMenu();
    await user.click(screen.getByRole('menuitem', { name: /download installer \(windows\)/i }));

    // Falls back to the downloads page rather than guessing a URL. Opening a
    // guessed URL is what produced the 11 KB HTML "installer" in the field.
    expect(window.open).not.toHaveBeenCalled();
  });
});
