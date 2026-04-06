import { useState, useCallback } from 'react';
import { validateField, type ValidationResult } from '../utils/validate';

type FieldRules = {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (v: string) => boolean;
  customMessage?: string;
};

type ValidationSchema = Record<string, FieldRules>;

/**
 * Hook for form validation using centralized validate.ts rules.
 *
 * Usage:
 *   const { errors, validate, clearError, clearAllErrors } = useFormValidation();
 *
 *   const handleSave = () => {
 *     const isValid = validate(form, {
 *       name: { required: true, minLength: 2 },
 *       phone: { custom: isValidPhone, customMessage: 'Invalid phone number' },
 *       email: { custom: isValidEmail, customMessage: 'Invalid email address' },
 *     });
 *     if (!isValid) return;
 *     // proceed with save
 *   };
 */
export function useFormValidation() {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback((
    formData: Record<string, any>,
    schema: ValidationSchema,
  ): boolean => {
    const newErrors: Record<string, string> = {};

    for (const [fieldName, rules] of Object.entries(schema)) {
      const value = String(formData[fieldName] ?? '');
      const result: ValidationResult = validateField(fieldName, value, rules);
      if (!result.valid && result.error) {
        // Use the field name as display label (convert snake_case to Title Case)
        const label = fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        newErrors[fieldName] = result.error.replace(fieldName, label);
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, []);

  const clearError = useCallback((field: string) => {
    setErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrors({});
  }, []);

  return { errors, validate, clearError, clearAllErrors };
}
