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

export type DispatchAccess =
  | { mode: 'board' }
  | { mode: 'redirect'; to: string };

const REDIRECT_ROLES: Record<string, string> = {
  officer: '/mdt',
  contract_manager: '/',
  client_viewer: '/',
  human_resources: '/',
};

export function resolveDispatchAccess(role: string | undefined): DispatchAccess {
  if (role && role in REDIRECT_ROLES) {
    return { mode: 'redirect', to: REDIRECT_ROLES[role] };
  }
  return { mode: 'board' };
}
