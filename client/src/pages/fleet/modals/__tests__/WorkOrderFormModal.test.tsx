import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkOrderFormModal from '../WorkOrderFormModal';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const VEHICLES = [{ id: 5, vehicle_number: 'U-5', vehicle_name: null }];

describe('WorkOrderFormModal', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    // Default mock for VmrsPicker's data loading
    mockedApiFetch.mockImplementation((endpoint: string) => {
      if (endpoint === '/ref-data/vmrs-systems') return Promise.resolve([]);
      if (endpoint === '/ref-data/vmrs-assemblies') return Promise.resolve([]);
      if (endpoint === '/ref-data/vmrs-components') return Promise.resolve([]);
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  it('requires a vehicle before saving', async () => {
    const onCreated = vi.fn();
    render(<WorkOrderFormModal vehicles={VEHICLES} onClose={vi.fn()} onCreated={onCreated} />);
    // Wait for VmrsPicker to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      expect(screen.getByText(/vehicle is required/i)).toBeInTheDocument();
    });
    // Count only POST calls to /work-orders, not ref-data calls
    const workOrderCalls = mockedApiFetch.mock.calls.filter((call) => call[0] === '/work-orders');
    expect(workOrderCalls).toHaveLength(0);
  });

  it('POSTs the form and calls onCreated on success', async () => {
    mockedApiFetch.mockImplementation((endpoint: string, options?: any) => {
      if (endpoint === '/ref-data/vmrs-systems') return Promise.resolve([]);
      if (endpoint === '/ref-data/vmrs-assemblies') return Promise.resolve([]);
      if (endpoint === '/ref-data/vmrs-components') return Promise.resolve([]);
      if (endpoint === '/work-orders') return Promise.resolve({ data: { id: 1 } });
      return Promise.reject(new Error('Unknown endpoint'));
    });
    const onCreated = vi.fn();
    render(<WorkOrderFormModal vehicles={VEHICLES} onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/vehicle \*/i), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText(/short one-liner/i), { target: { value: 'Brake check' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const workOrderCalls = mockedApiFetch.mock.calls.filter((call) => call[0] === '/work-orders');
    expect(workOrderCalls).toHaveLength(1);
    expect(workOrderCalls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((workOrderCalls[0][1] as { body: string }).body);
    expect(body).toMatchObject({ vehicle_id: 5, summary: 'Brake check', status: 'open' });
  });

  it('shows an error message when the create request fails', async () => {
    mockedApiFetch.mockImplementation((endpoint: string, options?: any) => {
      if (endpoint === '/ref-data/vmrs-systems') return Promise.resolve([]);
      if (endpoint === '/ref-data/vmrs-assemblies') return Promise.resolve([]);
      if (endpoint === '/ref-data/vmrs-components') return Promise.resolve([]);
      if (endpoint === '/work-orders') return Promise.reject(new Error('boom'));
      return Promise.reject(new Error('Unknown endpoint'));
    });
    render(<WorkOrderFormModal vehicles={VEHICLES} onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/vehicle \*/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });
});
