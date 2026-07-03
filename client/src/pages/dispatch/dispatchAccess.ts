// Pure, framework-free role → route-access rule for /dispatch. No React, no
// DOM — keeps the rule unit-testable, same pattern as
// client/src/pages/dashboard/dashboardViews.ts.
//
// /dispatch renders the full Spillman-style CAD console — dispatcher/
// supervisor/admin/manager territory (undispatched-calls queue, dispatch-any-
// unit controls, the full unit status board). Two roles land somewhere else:
//   - officer already has a purpose-built terminal at /mdt (MdtPage.tsx).
//   - contract_manager/client_viewer/human_resources have no operational
//     need for a live CAD board at all.
//
// This is an explicit DENYLIST, not an allowlist: every role not named below
// (including any future/unrecognized role string) falls through to the full
// board, matching today's actual behavior (no route guard exists yet) for
// anything we didn't explicitly call out. Contrast with dashboardViews.ts's
// ROLE_DEFAULT, which is an allowlist with a fallback — that fits a page
// everyone is meant to use in some form; this page isn't that.

import type { UserRole } from '../../types';

export type DispatchAccess =
  | { mode: 'board' }
  | { mode: 'redirect'; to: string };

// Partial<Record<UserRole, ...>>, not Record<string, ...>: the redirect keys
// are checked against the real role union, so a renamed/removed UserRole
// member is caught at compile time instead of silently falling through to
// {mode: 'board'} unnoticed. The denylist fallback behavior is unchanged —
// any UserRole not listed here (or a future new role) still resolves to the
// board.
const REDIRECT_ROLES: Partial<Record<UserRole, string>> = {
  officer: '/mdt',
  contract_manager: '/',
  client_viewer: '/',
  human_resources: '/',
};

export function resolveDispatchAccess(role: UserRole | undefined): DispatchAccess {
  const to = role && REDIRECT_ROLES[role];
  return to ? { mode: 'redirect', to } : { mode: 'board' };
}
