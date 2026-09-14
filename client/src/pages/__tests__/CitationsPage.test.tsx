// A live traffic citation with speed_recorded = 0 (never set) rendered a bare
// "0" text node floating below the empty "Traffic Details" box. Root cause:
// `{(c as any).speed_recorded && (<div>...)}` — 0 is falsy, but JS `&&` short-
// circuits to the falsy OPERAND itself (0), not `false`, and React renders a
// literal `0` for that (unlike `false`/`null`/`undefined`, which render
// nothing). Same class of bug existed one level up on the section wrapper
// (`... || (c as any).dui_related`, a D1 0/1 integer column) and on the Bond
// section wrapper (`... || (c as any).appearance_required`). Fixed by
// comparing numeric fields with `> 0` and boolean-flag columns with
// `Boolean(...)` instead of relying on truthiness directly.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router';
import CitationsPage from '../CitationsPage';
import { ToastProvider } from '../../components/ToastProvider';

const listCitation = {
  id: 1, citation_number: 'CIT-2026-0002', type: 'traffic', status: 'issued',
  person_name: 'Test, QA Audit', statute_citation: '41-22-12.5', violation_date: '2026-07-14',
};
const fullCitation = {
  ...listCitation,
  speed_recorded: 0, speed_limit: 0, bac_level: 0, dui_related: 0, appearance_required: 0, bond_amount: 0,
};

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path === '/citations/1') return { data: fullCitation };
    if (path.startsWith('/citations?')) return { data: [listCitation], pagination: { totalPages: 1 } };
    if (path === '/citations/stats') return { data: {} };
    // No backend route exists for /citations/:id/completeness (dead frontend
    // fetch — the page's own catch block always sets completeness to null),
    // so match production rather than fabricating a response shape that
    // can never occur live.
    if (path.includes('/completeness')) throw new Error('404 Not Found');
    return { data: null };
  }),
  apiPostForm: vi.fn(),
  authedImageUrl: (u: string) => u,
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', full_name: 'Test Admin', username: 'testadmin' } }),
}));
vi.mock('../../hooks/useLiveSync', () => ({ useLiveSync: () => {} }));

describe('CitationsPage — traffic details with all-zero numeric fields', () => {
  it('never renders a bare "0" for unset speed/BAC/bond fields', async () => {
    render(<MemoryRouter><ToastProvider><CitationsPage /></ToastProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('CIT-2026-0002')).toBeInTheDocument());
    fireEvent.click(screen.getByText('CIT-2026-0002'));

    const heading = await screen.findByText('Traffic Details');
    const section = heading.closest('section') as HTMLElement;
    expect(section).toBeTruthy();
    expect(within(section).queryByText('0', { exact: true })).not.toBeInTheDocument();

    // The Bond/Bail section wrapper had the same bug via `appearance_required`.
    expect(screen.queryByText('Bond', { exact: false })).not.toBeInTheDocument();
  });
});
