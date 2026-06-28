import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// God Mode fires a burst of read-only loads on mount and writes via apiFetch.
// Mock the API layer so the only behavior under test is WHICH endpoint the
// "Force Close ALL Open Calls" button targets — the bug was that it posted to
// /admin/calls/force-close-all, which no Worker route serves (404, dead button).
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
// RichTextArea wraps a rich editor; a plain textarea is enough for this test.
vi.mock('../../../components/RichTextArea', () => ({
  default: (props: Record<string, unknown>) => <textarea {...props} />,
}));

import AdminGodModeTab from '../AdminGodModeTab';

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string) => {
    // Accept either the old (dead) or new path so the test fails on the ASSERTION
    // (wrong endpoint) rather than erroring on an unhandled mock call.
    if (path.endsWith('/calls/force-close-all')) {
      return Promise.resolve({ success: true, closed: 3 });
    }
    // Every mount-time read degrades to an empty/null payload.
    return Promise.resolve(null);
  });
});

describe('AdminGodModeTab — Force Close ALL Open Calls', () => {
  it('posts to the real dispatch handler with the chosen disposition', async () => {
    render(<AdminGodModeTab />);
    const btn = await screen.findByRole('button', { name: /Force Close ALL Open Calls/i });
    await userEvent.click(btn);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/dispatch/calls/force-close-all',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = apiFetch.mock.calls.find((c) => c[0] === '/dispatch/calls/force-close-all');
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toEqual({ disposition: 'Closed by Admin' });

    // The dead admin path must never be used again.
    expect(apiFetch).not.toHaveBeenCalledWith('/admin/calls/force-close-all', expect.anything());
  });

  it('surfaces the closed count from the server response', async () => {
    render(<AdminGodModeTab />);
    const btn = await screen.findByRole('button', { name: /Force Close ALL Open Calls/i });
    await userEvent.click(btn);
    expect(await screen.findByText(/Force-closed 3 open calls/i)).toBeInTheDocument();
  });
});
