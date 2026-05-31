import type { User } from '../types';

// Resolve an operator's printable display name from a User record.
// User.full_name is OPTIONAL on the interface and unpopulated on a
// meaningful fraction of seeded user rows on live D1, so naive
// `user?.full_name` collapses the audit footer to "Printed by: Unknown"
// even when the operator is clearly logged in. The ladder mirrors the
// historical resolution order: full_name -> first+last -> username.
export function displayUserName(user: User | null | undefined): string | undefined {
  if (!user) return undefined;
  const composed = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return user.full_name || composed || user.username || undefined;
}
