// Form validation rules engine

type ValidationRule = (value: any) => string | null;

/** Create a required field validator */
export function required(fieldName: string): ValidationRule {
  return (value: any) => {
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      (typeof value === 'string' && !value.trim())
    ) {
      return `${fieldName} is required`;
    }
    return null;
  };
}

/** Create a minimum length validator */
export function minLength(fieldName: string, min: number): ValidationRule {
  return (value: any) => {
    if (typeof value === 'string' && value.length < min) {
      return `${fieldName} must be at least ${min} characters`;
    }
    return null;
  };
}

/** Create a maximum length validator */
export function maxLength(fieldName: string, max: number): ValidationRule {
  return (value: any) => {
    if (typeof value === 'string' && value.length > max) {
      return `${fieldName} must be at most ${max} characters`;
    }
    return null;
  };
}

/** Create an email validator */
export function email(fieldName = 'Email'): ValidationRule {
  return (value: any) => {
    if (!value) return null; // Use required() for required fields
    if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return `${fieldName} is not a valid email address`;
    }
    return null;
  };
}

/** Create a phone number validator */
export function phone(fieldName = 'Phone'): ValidationRule {
  return (value: any) => {
    if (!value) return null;
    if (typeof value !== 'string' || !/^[\d\s()+\-.*#]{3,25}$/.test(value)) {
      return `${fieldName} is not a valid phone number`;
    }
    return null;
  };
}

/** Create a numeric range validator */
export function numberRange(
  fieldName: string,
  min: number,
  max: number
): ValidationRule {
  return (value: any) => {
    const num = Number(value);
    if (isNaN(num)) return `${fieldName} must be a number`;
    if (num < min || num > max)
      return `${fieldName} must be between ${min} and ${max}`;
    return null;
  };
}

/** Create a pattern validator */
export function pattern(
  fieldName: string,
  regex: RegExp,
  message?: string
): ValidationRule {
  return (value: any) => {
    if (!value) return null;
    if (typeof value !== 'string' || !regex.test(value)) {
      return message || `${fieldName} format is invalid`;
    }
    return null;
  };
}

/** Validate a form data object against a set of rules */
export function validateForm(
  data: Record<string, any>,
  rules: Record<string, ValidationRule[]>
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [field, fieldRules] of Object.entries(rules)) {
    for (const rule of fieldRules) {
      const error = rule(data[field]);
      if (error) {
        errors[field] = error;
        break; // Stop at first error for this field
      }
    }
  }

  return errors;
}

/** Check if a form has any validation errors */
export function hasErrors(errors: Record<string, string>): boolean {
  return Object.keys(errors).length > 0;
}
