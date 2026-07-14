// client/src/pages/warrants/__tests__/WarrantsListTab.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import WarrantsListTab from '../WarrantsListTab';
import * as useApiModule from '../../../hooks/useApi';
import type { User } from '../../../types';

vi.mock('../../../components/ToastProvider', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock('../../../context/ContextMenuContext', () => ({
  useContextMenu: () => ({ openMenu: vi.fn() }),
}));
vi.mock('../../../hooks/useLiveSync', () => ({ useLiveSync: () => {} }));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', username: 'testofficer', first_name: 'Test', last_name: 'Officer', role: 'admin' } }),
}));
vi.mock('../../../utils/contextMenuActions', () => ({
  useMenuActions: () => ({
    action: (label: string, onClick: () => void) => ({ label, onClick }),
    go: (label: string, to: string) => ({ label, to }),
    copy: (label: string, value: unknown) => ({ label, value }),
    copyId: (id: unknown) => ({ label: 'Copy ID', value: id }),
    separator: () => ({ separator: true }),
  }),
}));

const testUser: User = {
  id: '1',
  username: 'testofficer',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'Officer',
  full_name: 'Test Officer',
  role: 'admin',
  badge_number: '1A',
};

const baseProps = {
  isVisible: true,
  user: testUser,
  isAdminOrManager: true,
  isGodMode: true,
  canManageWarrants: true,
  isMobile: false,
  navigate: vi.fn(),
  initialPersonId: null,
  initialWarrantId: null,
  formOpen: false,
  onOpenNewForm: vi.fn(),
  onOpenEditForm: vi.fn(),
  onOpenPersonProfile: vi.fn(),
};

function renderTab(props: Partial<typeof baseProps> = {}) {
  return render(
    <MemoryRouter>
      <WarrantsListTab {...baseProps} {...props} />
    </MemoryRouter>,
  );
}

describe('WarrantsListTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(useApiModule, 'apiFetch').mockResolvedValue({ warrants: [], total: 0 });
  });

  it('renders without crashing and fetches the list on mount', async () => {
    renderTab();
    await waitFor(() => {
      expect(useApiModule.apiFetch).toHaveBeenCalledWith(expect.stringContaining('/warrants/unified'));
    });
  });

  it('debounces the search box — typing does not fire a request per keystroke', async () => {
    renderTab();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(2));
    const search = screen.getByPlaceholderText(/search by name, warrant #, or charge/i);
    await userEvent.type(search, 'Turley');
    // Immediately after typing, no new request yet (debounce window hasn't elapsed).
    expect(useApiModule.apiFetch).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(3), { timeout: 1000 });
    expect(useApiModule.apiFetch).toHaveBeenLastCalledWith(expect.stringContaining('subject_name=Turley'));
  });

  it('calls onOpenNewForm when the New Warrant button is clicked', async () => {
    renderTab();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(2));
    // The empty-state panel also renders a "New Warrant" action button when
    // the list is empty (as it is here, per the mocked apiFetch response),
    // so target the toolbar's primary button specifically (first match).
    const [newWarrantButton] = screen.getAllByRole('button', { name: /new warrant/i });
    await userEvent.click(newWarrantButton);
    expect(baseProps.onOpenNewForm).toHaveBeenCalled();
  });

  it('is hidden (display: none) when isVisible is false', async () => {
    const { container } = renderTab({ isVisible: false });
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledTimes(2));
    expect(container.firstChild).toHaveStyle({ display: 'none' });
  });
});
