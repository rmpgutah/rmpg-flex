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
  onerror: (() => void) | null = null;
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

  it('shows an inline error banner when the WebSocket itself errors', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onerror?.();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to start browser session, try again.'));
  });

  it('shows an inline error banner when the socket closes before any message is received', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onclose?.();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to start browser session, try again.'));
  });

  it('does not show an error banner on a graceful close after session_ended', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'session_ended', reason: 'idle_timeout' }) });
    await waitFor(() => expect(screen.getByText(/session ended/i)).toBeInTheDocument());
    FakeWebSocket.instances[0].onclose?.();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not show an error banner when unmount triggers the close before any message is received', async () => {
    const { unmount } = render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    unmount();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('scales click coordinates from CSS-displayed size to intrinsic canvas pixel size', async () => {
    const { container } = render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'width', { value: 800, configurable: true });
    Object.defineProperty(canvas, 'height', { value: 600, configurable: true });
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => {},
    });
    fireEvent.click(canvas, { clientX: 100, clientY: 50 });
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'click', x: 200, y: 100 });
  });

  it('sends a type message on key down for a printable character', async () => {
    const { container } = render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.keyDown(canvas, { key: 'a' });
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'type', text: 'a' });
  });

  it('sends a scroll message on wheel', async () => {
    const { container } = render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.wheel(canvas, { deltaX: 12, deltaY: 34 });
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'scroll', dx: 12, dy: 34 });
  });
});
