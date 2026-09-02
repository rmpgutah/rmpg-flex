/**
 * Shared requireRole() helper for route handlers.
 * Returns null if the user has one of the required roles, or an error message string.
 *
 * This replaces the 39+ local copies scattered across route files.
 * The middleware version in src/middleware/auth.ts is a Hono middleware;
 * this version is for use inside route handlers where you need the
 * error message to return as a JSON response.
 */
export function requireRole(
  c: { get: (k: 'user') => { role: string } | undefined },
  ...roles: string[]
): string | null {
  const user = c.get('user');
  if (!user || !roles.includes(user.role)) {
    return 'Insufficient permissions';
  }
  return null;
}
