import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VendorsRoute } from '../routes/VendorsRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, name: 'Maverik #5', brand: 'Maverik', location: 'SLC', current_price_per_gallon: 3.49, last_updated: '2026-06-21' },
    { id: 2, name: 'Sinclair I-15', brand: 'Sinclair', location: 'Murray', current_price_per_gallon: 3.55, last_updated: '2026-06-20' },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<VendorsRoute>', () => {
  it('renders vendor rows sorted by price', async () => {
    render(<VendorsRoute />);
    await screen.findByText('Maverik #5', {}, { timeout: 3000 });
    expect(screen.getByText('Sinclair I-15')).toBeInTheDocument();
    expect(screen.getByText(/\$3\.490/)).toBeInTheDocument();
  });

  it('search filters by name', async () => {
    render(<VendorsRoute />);
    await screen.findByText('Maverik #5', {}, { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: 'sinclair' } });
    expect(screen.queryByText('Maverik #5')).toBeNull();
    expect(screen.getByText('Sinclair I-15')).toBeInTheDocument();
  });
});
