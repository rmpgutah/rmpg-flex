import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdminDownloadsTab from '../AdminDownloadsTab';

function stub(handlers: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    for (const path of Object.keys(handlers)) {
      if (url.includes(path)) {
        return Promise.resolve(new Response(JSON.stringify(handlers[path]), { status: 200 }));
      }
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }));
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('<AdminDownloadsTab>', () => {
  it('fetches /api/downloads/info and renders all present platforms', async () => {
    stub({
      '/api/downloads/info': {
        win: { filename: 'RMPG-Flex-Setup-5.8.4.zip', version: '5.8.4', size: '142 MB', bytes: 148897792 },
        mac: { filename: 'RMPG-Flex-5.8.4.dmg', version: '5.8.4', size: '138 MB', bytes: 144703488 },
        android: { filename: 'RMPG-Flex-5.8.4.apk.zip', version: '5.8.4', size: '45 MB', bytes: 47185920 },
      },
    });
    render(<AdminDownloadsTab />);
    await waitFor(() => expect(screen.getAllByText(/v5\.8\.4/)).toHaveLength(3));
    expect(screen.getByText(/142 MB/)).toBeInTheDocument();
    expect(screen.getByText(/138 MB/)).toBeInTheDocument();
    expect(screen.getByText(/45 MB/)).toBeInTheDocument();

    const winLink = screen.getByRole('link', { name: /windows/i });
    expect(winLink).toHaveAttribute('href', '/downloads/RMPG-Flex-Setup-5.8.4.zip');
    const macLink = screen.getByRole('link', { name: /macos/i });
    expect(macLink).toHaveAttribute('href', '/downloads/RMPG-Flex-5.8.4.dmg');
    const androidLink = screen.getByRole('link', { name: /android/i });
    expect(androidLink).toHaveAttribute('href', '/downloads/RMPG-Flex-5.8.4.apk.zip');
  });

  it('shows "Not available" for a platform missing from the response', async () => {
    stub({
      '/api/downloads/info': {
        win: { filename: 'RMPG-Flex-Setup-5.8.4.zip', version: '5.8.4', size: '142 MB', bytes: 148897792 },
        // mac and android omitted
      },
    });
    render(<AdminDownloadsTab />);
    await waitFor(() => expect(screen.getAllByText(/not available/i)).toHaveLength(2));
  });

  it('shows an error message when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<AdminDownloadsTab />);
    // With 3 retries at 2s/4s delay, wait up to 15s for error state
    await waitFor(() => expect(screen.getByText(/could not load download info/i)).toBeInTheDocument(), { timeout: 15000 });
  }, 20000);

  it('links out to the full public downloads page', async () => {
    stub({ '/api/downloads/info': {} });
    render(<AdminDownloadsTab />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    const fullPageLink = screen.getByRole('link', { name: /open full downloads page/i });
    expect(fullPageLink).toHaveAttribute('href', '/downloads');
  });
});
