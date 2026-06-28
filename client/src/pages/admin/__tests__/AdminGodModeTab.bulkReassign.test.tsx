import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// God Mode fires a burst of read-only loads on mount and writes via apiFetch.
// Mock the API layer so the only behavior under test is WHICH endpoint the
// "Reassign Calls" button targets, and WITH WHAT BODY — the bug was that it
// posted to /admin/calls/bulk-reassign (no Worker route → 404, dead button)
// and sent { target_officer_id } where the dispatch handler reads { unit_id }.
const apiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

// Context-menu plumbing is irrelevant to this smoke test — stub the two hooks
// the tab pulls in at module scope so it mounts without a real provider tree.
vi.mock('../../../context/ContextMenuContext', () => ({
  useContextMenu: () => ({ openMenu: vi.fn() }),
}));
vi.mock('../../../utils/contextMenuActions', () => ({
  useMenuActions: () => ({
    copy: () => ({}), copyId: () => ({}), action: () => ({}), separator: () => ({}),
  }),
}));
// RichTextArea wraps a rich editor; a plain textarea is enough for this test
// (the call-ids field is a RichTextArea).
vi.mock('../../../components/RichTextArea', () => ({
  default: (props: Record<string, unknown>) => <textarea {...props} />,
}));

import AdminGodModeTab from '../AdminGodModeTab';

// One row that satisfies BOTH the old "Target officer" dropdown (mapped from
// /personnel, needs id+role+name) AND the new "Target unit" dropdown (mapped
// from /dispatch/units, needs id+call_sign+officer_name+status). This makes the
// test render + click identically before and after the fix, so it fails on the
// ENDPOINT/BODY assertion (a real RED) rather than erroring on missing options.
const ROW = {
  id: 7, role: 'officer', full_name: 'Smith, J.',
  call_sign: 'D19', officer_name: 'Smith, J.', status: 'available', badge_number: 'B7',
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string) => {
    // Populate whichever dropdown the component reads from.
    if (path === '/personnel' || path === '/dispatch/units') {
      return Promise.resolve([ROW]);
    }
    // Accept either the old (dead) or new path so the test fails on the
    // ASSERTION (wrong endpoint/body) rather than erroring on an unhandled
    // mock call. Server adds `target` (the unit call-sign) to its response.
    if (path.endsWith('/calls/bulk-reassign')) {
      return Promise.resolve({ success: true, updated: 2, total: 2, target: 'D19' });
    }
    // Every other mount-time read degrades to an empty/null payload.
    return Promise.resolve(null);
  });
});

async function fillAndSubmit() {
  const callIds = await screen.findByPlaceholderText(/Call IDs/i);
  await userEvent.type(callIds, '101, 102');

  const reassignBtn = screen.getByRole('button', { name: /Reassign Calls/i });
  const panel = reassignBtn.closest('div') as HTMLElement;
  const unitSelect = within(panel).getByRole('combobox');
  await userEvent.selectOptions(unitSelect, '7');

  await userEvent.click(reassignBtn);
}

describe('AdminGodModeTab — Bulk Reassign Calls', () => {
  it('posts to the real dispatch handler with { call_ids, unit_id }', async () => {
    render(<AdminGodModeTab />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/dispatch/calls/bulk-reassign',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = apiFetch.mock.calls.find((c) => c[0] === '/dispatch/calls/bulk-reassign');
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toEqual({ call_ids: [101, 102], unit_id: 7 });

    // The dead admin path must never be used again, and the officer-id field
    // (the body-shape mismatch) must be gone.
    expect(apiFetch).not.toHaveBeenCalledWith('/admin/calls/bulk-reassign', expect.anything());
    const dispatchBody = JSON.parse(call![1].body);
    expect(dispatchBody).not.toHaveProperty('target_officer_id');
  });

  it('surfaces the reassigned count and target unit from the server response', async () => {
    render(<AdminGodModeTab />);
    await fillAndSubmit();
    expect(await screen.findByText(/Reassigned 2 calls to D19/i)).toBeInTheDocument();
  });
});
