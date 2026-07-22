import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WebCompanyBrowserPage from './WebCompanyBrowserPage';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ sessionId: 'test-session-id' }),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }
}

describe('WebCompanyBrowserPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWebSocket.instances = [];
    (globalThis as any).WebSocket = FakeWebSocket;
    localStorage.setItem('rmpg_token', 'fake-jwt-token');
  });

  it('creates a session and opens a WebSocket to it', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0].url).toContain('sessionId=test-session-id');
  });

  it('sends an authenticate frame once the socket opens', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onopen?.();
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'authenticate', token: 'fake-jwt-token' });
  });

  it('sends a navigate message when the address bar is submitted', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'https://example.com' } });
    fireEvent.submit(addressBar.closest('form')!);
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'navigate', url: 'https://example.com' });
  });

  it('shows an inline error banner on an error message', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'error', message: 'Navigation failed' }) });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Navigation failed'));
  });

  it('shows a session-ended state on a session_ended message', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'session_ended', reason: 'idle_timeout' }) });
    await waitFor(() => expect(screen.getByText(/session ended/i)).toBeInTheDocument());
  });
});
