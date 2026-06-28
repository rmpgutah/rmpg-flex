import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { useFleetV2View } from '../useFleetV2Audit';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
});

function ViewHost({ route }: { route: string }) {
  useFleetV2View(route);
  return <div>host</div>;
}

describe('useFleetV2View', () => {
  it('POSTs FLEET_V2_VIEW to /api/audit-emit on mount with route + viewport_width', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    render(<ViewHost route="/fleet/v2/dashboard" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/audit-emit$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.action).toBe('FLEET_V2_VIEW');
    expect(body.entityType).toBe('fleet_ui_page');
    expect(body.details).toEqual({
      kind: 'FLEET_V2_VIEW',
      route: '/fleet/v2/dashboard',
      viewport_width: 1440,
    });
    cleanup();
  });

  it('swallows fetch errors silently (fire-and-forget)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(() => render(<ViewHost route="/x" />)).not.toThrow();
    cleanup();
  });
});
