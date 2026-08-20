import { describe, it, expect } from 'vitest';
import { validatePassword, DEFAULT_SECURITY_POLICY } from '../src/utils/securityPolicy';

describe('personnel.ts password policy integration', () => {
  it('an 8-character password with no complexity fails the default policy', () => {
    // Before this task, personnel.ts accepted this password (length-only check).
    // After this task, the create-user and reset-password routes must reject it.
    expect(validatePassword('12345678', DEFAULT_SECURITY_POLICY)).not.toBeNull();
  });
});
