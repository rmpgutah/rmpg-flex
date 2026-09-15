import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WebCompanyBrowserPage from './WebCompanyBrowserPage';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ sessionId: 'test-session-id' }),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1; // OPEN
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
    // Clear saved tabs so we start fresh each test
    localStorage.removeItem('rmpg_browser_saved_tabs');
    // Mock ResizeObserver
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('creates a session and opens a WebSocket to it', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0].url).toContain('sessionId=test-session-id');
  });

  it('sends an authenticate frame once the socket opens', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => { FakeWebSocket.instances[0].onopen?.(); });
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
    act(() => { FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'error', message: 'Navigation failed' }) }); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Navigation failed'));
  });

  it('shows a session-ended state on a session_ended message', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => { FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'session_ended', reason: 'idle_timeout' }) }); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/session ended/i));
  });

  it('shows an inline error banner when the WebSocket itself errors', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => { FakeWebSocket.instances[0].onerror?.(); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to start browser session, try again.'));
  });

  it('shows an inline error banner when the socket closes before any message is received', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].readyState = 3; // CLOSED
    act(() => { FakeWebSocket.instances[0].onclose?.(); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to start browser session, try again.'));
  });

  it('does not show an error banner on a graceful close after session_ended', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => { FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'session_ended', reason: 'idle_timeout' }) }); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/session ended/i));
    act(() => { FakeWebSocket.instances[0].onclose?.(); });
    const alerts = screen.queryAllByRole('alert');
    expect(alerts).toHaveLength(1);
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
    // Drive the tab to a real URL so the canvas appears (not the new-tab page)
    act(() => { FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'url_changed', url: 'https://example.com' }) }); });
    await waitFor(() => {});
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return;
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
    act(() => { FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'url_changed', url: 'https://example.com' }) }); });
    await waitFor(() => {});
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    fireEvent.keyDown(canvas, { key: 'a' });
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'type', text: 'a' });
  });

  it('sends a scroll message on wheel', async () => {
    const { container } = render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => { FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'url_changed', url: 'https://example.com' }) }); });
    await waitFor(() => {});
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    fireEvent.wheel(canvas, { deltaX: 12, deltaY: 34 });
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'scroll', dx: 12, dy: 34 });
  });

  it('routes search queries to the RMPG search endpoint', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'who is on patrol' } });
    fireEvent.submit(addressBar.closest('form')!);
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    const navMsg = sent.find((m: any) => m.type === 'navigate');
    expect(navMsg).toBeDefined();
    expect(navMsg!.url).toContain('/api/browser-search?q=');
    expect(navMsg!.url).toContain('who');
  });

  it('updates the address bar when a url_changed message is received', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => { FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'url_changed', url: 'https://google.com' }) }); });
    await waitFor(() => {
      const addressBar = screen.getByRole('textbox', { name: /address/i });
      expect((addressBar as HTMLInputElement).value).toBe('https://google.com');
    });
  });

  it('sends navigate_back when Back button is clicked', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'navigate_back' });
  });

  it('sends navigate_forward when Forward button is clicked', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /^forward$/i }));
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'navigate_forward' });
  });

  it('sends navigate message to rmpgutah.us when Home is clicked', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /home/i }));
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'navigate', url: 'https://rmpgutah.us' });
  });

  it('opens a new tab when the + button is clicked', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
  });

  it('shows the shortcuts modal when the ? button is clicked', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /shortcuts/i }));
    await waitFor(() => expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument());
  });

  it('prepends https:// to bare hostname input', async () => {
    render(<WebCompanyBrowserPage />);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'example.com' } });
    fireEvent.submit(addressBar.closest('form')!);
    const sent = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'navigate', url: 'https://example.com' });
  });
});
