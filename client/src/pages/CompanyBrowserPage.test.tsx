import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CompanyBrowserPage from './CompanyBrowserPage';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ browser_bookmarks_json: null, browser_history_json: null }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));

describe('CompanyBrowserPage', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('starts with one tab on the new-tab page', () => {
    render(<CompanyBrowserPage />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('opens a new tab on new-tab button click', () => {
    render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('closes a tab, keeping at least one open', () => {
    render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    const closeButtons = screen.getAllByRole('button', { name: /close tab/i });
    fireEvent.click(closeButtons[0]);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('navigates the active tab when the address bar is submitted, normalizing a bare domain to https', () => {
    render(<CompanyBrowserPage />);
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'example.com' } });
    fireEvent.submit(addressBar.closest('form')!);
    const webview = document.querySelector('webview');
    expect(webview?.getAttribute('src')).toBe('https://example.com');
  });

  it('blocks a disallowed scheme entered in the address bar without navigating the webview', () => {
    render(<CompanyBrowserPage />);
    const webview = document.querySelector('webview');
    const srcBefore = webview?.getAttribute('src');

    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'file:///etc/passwd' } });
    fireEvent.submit(addressBar.closest('form')!);

    expect(document.querySelector('webview')?.getAttribute('src')).toBe(srcBefore);
    expect(screen.getByText(/only http\/https urls can be opened/i)).toBeInTheDocument();
  });

  it('adds and removes a bookmark for the active tab URL', () => {
    render(<CompanyBrowserPage />);
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'https://example.com' } });
    fireEvent.submit(addressBar.closest('form')!);

    fireEvent.click(screen.getByRole('button', { name: /add bookmark/i }));
    expect(screen.getByRole('link', { name: /example\.com/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove bookmark/i }));
    expect(screen.queryByRole('link', { name: /example\.com/i })).not.toBeInTheDocument();
  });

  it('shows an inline error on a fatal did-fail-load (e.g. DNS failure)', () => {
    render(<CompanyBrowserPage />);
    const webview = document.querySelector('webview')!;
    const event = new Event('did-fail-load') as Event & {
      errorCode?: number; errorDescription?: string; isMainFrame?: boolean;
    };
    event.errorCode = -105; // NAME_NOT_RESOLVED — fatal
    event.errorDescription = 'ERR_NAME_NOT_RESOLVED';
    event.isMainFrame = true;
    fireEvent(webview, event);
    expect(screen.getByRole('alert')).toHaveTextContent('ERR_NAME_NOT_RESOLVED');
  });

  it('shows no inline error on a non-fatal did-fail-load (e.g. ABORTED)', () => {
    render(<CompanyBrowserPage />);
    const webview = document.querySelector('webview')!;
    const event = new Event('did-fail-load') as Event & {
      errorCode?: number; errorDescription?: string; isMainFrame?: boolean;
    };
    event.errorCode = -3; // ABORTED — non-fatal, deliberately excluded
    event.errorDescription = 'ERR_ABORTED';
    event.isMainFrame = true;
    fireEvent(webview, event);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the ownership footer line', () => {
    render(<CompanyBrowserPage />);
    expect(screen.getByText(/© 2026 Rocky Mountain Protective Group, LLC/i)).toBeInTheDocument();
    expect(screen.getByText(/Internal Use Only, Authorized Personnel Only/i)).toBeInTheDocument();
  });

  it('shows the first-launch proprietary notice modal when no ack is stored for this user', () => {
    render(<CompanyBrowserPage />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/proprietary/i)).toBeInTheDocument();
  });

  it('dismisses the modal on "I Understand" and does not show it again after remount', () => {
    const { unmount } = render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    render(<CompanyBrowserPage />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the modal again for a different user id (per-user, not global)', async () => {
    const { unmount } = render(<CompanyBrowserPage />);
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
    render(<CompanyBrowserPageReloaded />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
