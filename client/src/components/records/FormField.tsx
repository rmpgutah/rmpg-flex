// ============================================================
// RMPG Flex — Form Field
// Label wrapper for a form control. Matches the RecordField label
// hierarchy (9px uppercase muted) so forms and detail panels share
// one type rhythm. Wrap any control: <FormField label="..."><input
// className="input-dark" .../></FormField>.
// ============================================================

import React from 'react';

interface FormFieldProps {
  label: string;
  required?: boolean;
  /** Small helper text under the control. */
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export default function FormField({ label, required = false, hint, children, className = '' }: FormFieldProps) {
  return (
    <div className={className}>
      <label
        className="block mb-1 text-[9px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--text-muted, #8a8a8a)', letterSpacing: '0.04em' }}
      >
        {label}
        {required && <span className="ml-0.5" style={{ color: '#f87171' }}>*</span>}
      </label>
      {children}
      {hint && <p className="mt-0.5 text-[9px] text-rmpg-500 leading-snug">{hint}</p>}
    </div>
  );
}
