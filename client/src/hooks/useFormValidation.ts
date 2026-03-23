import { useState, useCallback, useRef } from 'react';
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
 *   const { errors, validate, validateSingleField, clearError, clearAllErrors } = useFormValidation();
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
 *
 *   // For onBlur validation:
 *   <input onBlur={() => validateSingleField('email', form.email, schema.email)} />
 */
export function useFormValidation() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const schemaRef = useRef<ValidationSchema>({});

  const validate = useCallback((
    formData: Record<string, any>,
    schema: ValidationSchema,
  ): boolean => {
    schemaRef.current = schema;
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

  /**
   * Validate a single field on blur. Updates only that field's error state.
   * Pass the field name, current value, and its rules.
   */
  const validateSingleField = useCallback((
    fieldName: string,
    value: string,
    rules?: FieldRules,
  ): boolean => {
    const fieldRules = rules || schemaRef.current[fieldName];
    if (!fieldRules) return true;

    const result: ValidationResult = validateField(fieldName, value, fieldRules);
    if (!result.valid && result.error) {
      const label = fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      setErrors(prev => ({ ...prev, [fieldName]: result.error!.replace(fieldName, label) }));
      return false;
    } else {
      // Clear error for this field if now valid
      setErrors(prev => {
        if (!prev[fieldName]) return prev;
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
      return true;
    }
  }, []);

  const clearError = useCallback((field: string) => {
    setErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrors({});
  }, []);

  /** Check if there are any validation errors */
  const hasErrors = Object.keys(errors).length > 0;

  /** Get the first error message (useful for summary display) */
  const firstError = Object.values(errors)[0] || null;

  return { errors, hasErrors, firstError, validate, validateSingleField, clearError, clearAllErrors };
}
