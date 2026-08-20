import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import AdminSystemTab from '../AdminSystemTab';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn((path: string) => {
    if (path.startsWith('/statutes')) {
      return Promise.resolve({
        data: [{ id: 1, citation: '76-5-102', short_title: 'Assault', category: 'criminal', offense_level: 'MB', subcategory: 'Assault' }],
        pagination: { total: 1, totalPages: 1 },
      });
    }
    if (path === '/admin/config-items') return Promise.resolve({});
    if (path === '/admin/call-templates') return Promise.resolve([]);
    if (path === '/dispatch/units') return Promise.resolve([]);
    return Promise.resolve({});
  }),
}));

vi.mock('../../../context/ContextMenuContext', () => ({
  useContextMenu: () => ({ openMenu: vi.fn() }),
}));

vi.mock('../../../utils/contextMenuActions', () => ({
  useMenuActions: () => ({
    action: (label: string) => ({ label }),
    separator: () => ({ separator: true }),
    copy: (label: string) => ({ label }),
    copyId: (_id: unknown, label: string) => ({ label }),
  }),
}));

vi.mock('../../../hooks/useUnsavedChanges', () => ({ useUnsavedChanges: vi.fn() }));

const LoadingSpinner = () => <div>loading</div>;

const renderTab = () => render(
  <MemoryRouter>
    <AdminSystemTab users={[]} error={null} setError={vi.fn()} LoadingSpinner={LoadingSpinner} />
  </MemoryRouter>,
);

const statuteCallCount = async () => {
  const { apiFetch } = await import('../../../hooks/useApi');
  return (apiFetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((args) => String(args[0]).startsWith('/statutes')).length;
};

beforeEach(() => {
  vi.clearAllMocks();
  // The tab persists its active section; pin it to Criminal Codes.
  localStorage.setItem('rmpg_admin_sections', JSON.stringify('criminal_codes'));
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('AdminSystemTab — Criminal Codes', () => {
  it('fetches statutes once on open instead of looping', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('76-5-102')).toBeInTheDocument());

    const afterOpen = await statuteCallCount();
    expect(afterOpen).toBe(1);

    // Settle across two successive windows, each meaningfully longer than the
    // 300ms debounce. A reintroduced unstable dependency re-fires the effect on
    // every render (~3.3 req/s), which a single ~100ms window is too short to
    // ever catch — two 500ms windows give it two full chances to show up.
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(await statuteCallCount()).toBe(1);

    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(await statuteCallCount()).toBe(1);
  }, 10000);

  it('debounces typing into one request per burst', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderTab();
    await waitFor(() => expect(screen.getByText('76-5-102')).toBeInTheDocument());
    const baseline = await statuteCallCount();

    const input = screen.getByLabelText(/search statutes/i);
    for (const value of ['a', 'as', 'ass', 'assa', 'assau']) {
      fireEvent.change(input, { target: { value } });
    }

    // Before the debounce window elapses, nothing new has been requested.
    expect(await statuteCallCount()).toBe(baseline);

    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(async () => expect(await statuteCallCount()).toBe(baseline + 1));
  });

  it('renders the citation as a Law Book deep link', async () => {
    renderTab();
    const link = await screen.findByRole('link', { name: /76-5-102/ });
    expect(link).toHaveAttribute('href', '/law-book?statute_id=1');
  });
});
