import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// ─── Per-user mailbox connect-gate (Phase 3 cutover) ───────────────────
// EmailPage now gates on GET /email/connect/status before mounting the
// inbox UI and its data-fetching effects (see task-6-brief.md). Mirrors
// the path-keyed apiFetch mock + direct hook mocks used by MdtPage.test.tsx
// rather than wrapping real context providers — EmailPage pulls in
// WebSocketContext/AuthContext/react-router's useSearchParams the same way.
const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...a: any[]) => mockApiFetch(...a),
  apiFetchBlob: vi.fn(),
}));
vi.mock('../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: () => () => {} }),
}));
vi.mock('../../hooks/useLiveSync', () => ({ useLiveSync: () => {} }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 42, username: 'jdoe', role: 'officer' } }),
}));
vi.mock('../../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

let connectStatus: { connected: boolean; mailbox: string | null; azureConfigured?: boolean } = { connected: false, mailbox: null };

function installApiMock() {
  mockApiFetch.mockImplementation(async (path: string, _opts?: any) => {
    if (path === '/email/connect/status') return connectStatus;
    if (path === '/email/connect/authorize') return { url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?foo=bar' };
    if (path === '/email/folders') return [];
    if (path.startsWith('/email/messages')) return { messages: [], hasMore: false };
    return {};
  });
}

describe('EmailPage connect-gate', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    connectStatus = { connected: false, mailbox: null, azureConfigured: true };
  });

  it('shows Azure-not-configured message and disables Connect when azureConfigured is false', async () => {
    connectStatus = { connected: false, mailbox: null, azureConfigured: false };
    installApiMock();
    const { default: EmailPage } = await import('../EmailPage');
    render(<EmailPage />);

    await waitFor(() => expect(screen.getByText(/Azure AD app registration is not configured yet/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Connect Microsoft 365/i })).toBeDisabled();
  });

  it('renders a "Connect your mailbox" prompt when the mailbox is not connected', async () => {
    connectStatus = { connected: false, mailbox: null };
    installApiMock();
    const { default: EmailPage } = await import('../EmailPage');
    render(<EmailPage />);

    await waitFor(() => expect(screen.getByText(/Connect Your Mailbox/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Connect Microsoft 365/i })).toBeInTheDocument();
  });

  it('renders the inbox UI (not the connect prompt) when the mailbox is connected', async () => {
    connectStatus = { connected: true, mailbox: 'officer@rmpgutah.us' };
    installApiMock();
    const { default: EmailPage } = await import('../EmailPage');
    render(<EmailPage />);

    // The compose button only mounts once the connect-gate has passed and
    // the real inbox shell renders. Two "Compose"-labelled buttons exist
    // (expanded + collapsed folder-panel variants), so assert on presence
    // rather than a single match.
    await waitFor(() => expect(screen.getAllByText(/Compose/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Connect Your Mailbox/i)).not.toBeInTheDocument();
  });

  it('clicking Connect fetches the authorize URL and navigates the browser to it', async () => {
    connectStatus = { connected: false, mailbox: null };
    installApiMock();
    const { default: EmailPage } = await import('../EmailPage');
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<EmailPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Connect Microsoft 365/i })).toBeInTheDocument());

    // jsdom's window.location.href setter doesn't actually navigate, but it
    // IS assignable and observable — redefine just the property so the
    // assignment in handleConnectMailbox (window.location.href = data.url)
    // can be captured without jsdom's "not implemented: navigation" noise.
    let capturedHref = '';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, set href(v: string) { capturedHref = v; }, get href() { return capturedHref; } },
      writable: true,
    });

    await userEvent.click(screen.getByRole('button', { name: /Connect Microsoft 365/i }));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/email/connect/authorize'));
    await waitFor(() => expect(capturedHref).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?foo=bar'));
  });
});
