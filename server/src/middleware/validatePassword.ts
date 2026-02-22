import config from '../config';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  const { minLength, requireUppercase, requireLowercase, requireNumber, requireSpecial } = config.password;

  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['Password is required'] };
  }

  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters`);
  }

  if (requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (requireNumber && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (requireSpecial && !/[!@#$%^&*()_+\-=\[\]{}|;':",.<>?/`~]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Common password check
  const commonPasswords = [
    'password', '12345678', 'qwerty', 'admin123', 'pass123',
    'letmein', 'welcome', 'monkey', 'dragon', 'master',
    'password1', 'abc123', '111111', 'iloveyou', 'trustno1',
  ];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('Password is too common. Please choose a more unique password.');
  }

  return { valid: errors.length === 0, errors };
}

export function getPasswordPolicyDescription(): string {
  const rules: string[] = [];
  const { minLength, requireUppercase, requireLowercase, requireNumber, requireSpecial } = config.password;

  rules.push(`At least ${minLength} characters`);
  if (requireUppercase) rules.push('At least one uppercase letter');
  if (requireLowercase) rules.push('At least one lowercase letter');
  if (requireNumber) rules.push('At least one number');
  if (requireSpecial) rules.push('At least one special character');

  return rules.join(', ');
}
