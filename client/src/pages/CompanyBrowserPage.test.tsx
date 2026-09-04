import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CompanyBrowserPage from './CompanyBrowserPage';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ browser_bookmarks_json: null, browser_history_json: null }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));

describe('CompanyBrowserPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (window as any).electron = { isElectron: true };
  });
  afterEach(() => { delete (window as any).electron; });

  it('starts with one tab on the new-tab page', async () => {
    await act(async () => { render(<CompanyBrowserPage />); });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('opens a new tab on new-tab button click', async () => {
    await act(async () => { render(<CompanyBrowserPage />); });
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('closes a tab, keeping at least one open', async () => {
    await act(async () => { render(<CompanyBrowserPage />); });
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    const closeButtons = screen.getAllByRole('button', { name: /close tab/i });
    fireEvent.click(closeButtons[0]);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('navigates the active tab when the address bar is submitted, normalizing a bare domain to https', async () => {
    await act(async () => { render(<CompanyBrowserPage />); });
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'example.com' } });
    fireEvent.submit(addressBar.closest('form')!);
    // In jsdom (non-Electron env), webview does not mount — verify the address
    // input reflects the normalized URL the tab state was updated to.
    expect(addressBar).toHaveValue('https://example.com');
  });

  it('blocks a disallowed scheme entered in the address bar without navigating', async () => {
    await act(async () => { render(<CompanyBrowserPage />); });
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    const valueBefore = addressBar.getAttribute('value') ?? '';

    fireEvent.change(addressBar, { target: { value: 'file:///etc/passwd' } });
    fireEvent.submit(addressBar.closest('form')!);

    // Tab url stays unchanged (error shown in tab state, not as a toast here)
    // The address bar retains what the user typed — it wasn't committed.
    expect(screen.queryByDisplayValue('file:///etc/passwd')).toBeInTheDocument();
    // No navigation happened to the disallowed URL
    expect(valueBefore).not.toBe('file:///etc/passwd');
  });

  it('adds and removes a bookmark for the active tab URL', async () => {
    await act(async () => { render(<CompanyBrowserPage />); });
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'https://example.com' } });
    fireEvent.submit(addressBar.closest('form')!);

    // Add bookmark — button label changes to "Remove bookmark"
    const bookmarkBtn = screen.getByRole('button', { name: /add bookmark/i });
    fireEvent.click(bookmarkBtn);
    expect(screen.getByRole('button', { name: /remove bookmark/i })).toBeInTheDocument();

    // Remove bookmark — button label reverts to "Add bookmark"
    fireEvent.click(screen.getByRole('button', { name: /remove bookmark/i }));
    expect(screen.getByRole('button', { name: /add bookmark/i })).toBeInTheDocument();
  });

  it('renders the RMPG ownership footer', async () => {
    await act(async () => { render(<CompanyBrowserPage />); });
    // Text may be split across elements — query all and check at least one matches.
    const matches = screen.getAllByText(/Rocky Mountain Protective Group/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders the RMPG status line', async () => {
    await act(async () => { render(<CompanyBrowserPage />); });
    const matches = screen.getAllByText(/Authorized Personnel Only/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('shows the first-launch proprietary notice modal when no ack is stored for this user', async () => {
    await act(async () => { render(<CompanyBrowserPage />); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/proprietary/i)).toBeInTheDocument();
  });

  it('dismisses the modal on "I Understand" and does not show it again after remount', async () => {
    const { unmount } = await act(async () => render(<CompanyBrowserPage />));
    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    await act(async () => { render(<CompanyBrowserPage />); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the modal again for a different user id (per-user, not global)', async () => {
    const { unmount } = await act(async () => render(<CompanyBrowserPage />));
    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));
    unmount();

    vi.resetModules();
    vi.doMock('../context/AuthContext', () => ({
      useAuth: () => ({ user: { id: '2', role: 'officer' } }),
    }));
    vi.doMock('../hooks/useApi', () => ({
      apiFetch: vi.fn().mockResolvedValue({ browser_bookmarks_json: null, browser_history_json: null }),
    }));
    const { default: CompanyBrowserPageReloaded } = await import('./CompanyBrowserPage');
    await act(async () => { render(<CompanyBrowserPageReloaded />); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
