import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminInspectionTemplatesTab from '../AdminInspectionTemplatesTab';

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

describe('<AdminInspectionTemplatesTab>', () => {
  it('fetches /inspection-templates and renders the template list', async () => {
    stub({
      '/inspection-templates': {
        data: [
          { id: 1, name: 'Pre-trip', description: null, active: 1, version: 1, parent_template_id: null, vehicle_type_code: 'PATROL', created_at: '2026-06-21 10:00:00' },
          { id: 2, name: 'Maintenance', description: 'Quarterly', active: 0, version: 3, parent_template_id: 1, vehicle_type_code: null, created_at: '2026-06-15 09:00:00' },
        ],
      },
    });
    render(<AdminInspectionTemplatesTab />);
    await waitFor(() => expect(screen.getByText('Pre-trip')).toBeInTheDocument());
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('PATROL')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('shows empty state when no templates exist', async () => {
    stub({ '/inspection-templates': { data: [] } });
    render(<AdminInspectionTemplatesTab />);
    await waitFor(() => expect(screen.getByText(/no templates yet/i)).toBeInTheDocument());
  });

  it('opens the New Template modal on button click', async () => {
    stub({ '/inspection-templates': { data: [] } });
    render(<AdminInspectionTemplatesTab />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /new template/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/New Template/);
    expect(dialog.textContent).toMatch(/Name \*/);
    expect(dialog.textContent).toMatch(/Items/);
  });
});
