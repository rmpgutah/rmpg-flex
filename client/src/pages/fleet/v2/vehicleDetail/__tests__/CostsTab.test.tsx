import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostsTab } from '../CostsTab';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    if (url.includes('/insurance')) return Promise.resolve(new Response(JSON.stringify([{ id: 1, cost: 1200, description: 'Annual policy', vendor: 'State Farm' }]), { status: 200 }));
    if (url.includes('/cost-per-mile')) return Promise.resolve(new Response(JSON.stringify({ cost_per_mile: 0.42 }), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<CostsTab>', () => {
  it('renders cost-per-mile header + insurance section', async () => {
    render(<CostsTab vehicleId={42} />);
    await screen.findByText(/cost \/ mile/i, {}, { timeout: 3000 });
    expect(screen.getByText(/\$0\.42/)).toBeInTheDocument();
    expect(screen.getByText(/insurance/i)).toBeInTheDocument();
    expect(screen.getByText(/annual policy/i)).toBeInTheDocument();
  });

  it('renders empty state when no costs at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    render(<CostsTab vehicleId={42} />);
    await screen.findByText(/no costs/i, {}, { timeout: 3000 });
  });
});
