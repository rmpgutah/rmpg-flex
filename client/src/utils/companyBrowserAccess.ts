// Pure role-check for Company Browser access, extracted so it's unit-testable
// in isolation — same pattern as client/src/pages/dispatch/dispatchAccess.ts's
// resolveDispatchAccess(). Consumed by CompanyBrowserRoleGuard in App.tsx (the
// route-level gate) and by the nav-catalog launch path (windowManager.ts),
// so a blocked role can't reach the page by direct URL/bookmark OR by
// triggering the Electron launch call directly.
export function isCompanyBrowserBlockedRole(role: string | undefined): boolean {
  return role === 'client_viewer' || role === 'contract_manager';
}
