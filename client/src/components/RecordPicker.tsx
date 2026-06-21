// ============================================================
// RecordPicker — polymorphic search dropdown
// ============================================================
// Wraps Person / Incident / Call / Case pickers behind a single
// `type` prop. Used in IncidentsPage's "Link Record" modal where the
// operator first picks the record-type (Incident / Call / Case /
// Warrant / Citation / Arrest) from a dropdown and then has to pick
// the specific record. Previously they typed the numeric id; this
// picker switches in the right name-search dropdown based on type.
//
// Warrant / Citation / Arrest fall back to a numeric input — those
// entities don't have dedicated pickers yet (they're rarer in the
// cross-link modal). The fallback emits the typed digits as a
// stand-in for the FK id, mirroring the original input behavior so
// the modal keeps working for those types.

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import PersonPicker, { type PersonSummary } from './PersonPicker';
import IncidentPickerInline, { type IncidentSummary } from './IncidentPickerInline';
import CallPicker, { type CallSummary } from './CallPicker';
import CasePicker, { type CaseSummary } from './CasePicker';

export type LinkableRecordType =
  | 'person'
  | 'incident'
  | 'call'
  | 'case'
  | 'warrant'
  | 'citation'
  | 'arrest';

interface Props {
  type: LinkableRecordType | '';
  value: number | null;
  displayValue?: string;
  onChange: (
    id: number | null,
    record?: PersonSummary | IncidentSummary | CallSummary | CaseSummary,
  ) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

export default function RecordPicker({
  type, value, displayValue, onChange,
  disabled = false, required = false, id, className = '',
}: Props) {
  // When the parent switches type, clear any prior selection so the
  // emitted FK matches the new entity. Without this the form would
  // hold a person_id pointing at a person while the type dropdown said
  // "case", and the link would land mis-shaped on the server.
  useEffect(() => {
    if (value != null) onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  if (!type) {
    return (
      <input
        type="text"
        disabled
        placeholder="Pick a record type first…"
        className="w-full bg-surface-sunken border border-border-default pl-2 pr-2 py-1.5 text-[11px] text-rmpg-500 disabled:opacity-50"
        style={{ borderRadius: 2 }}
        aria-label="Record (type required first)"
      />
    );
  }

  if (type === 'person') {
    return (
      <PersonPicker value={value} displayValue={displayValue} onChange={onChange}
        disabled={disabled} required={required} id={id} className={className} />
    );
  }
  if (type === 'incident') {
    return (
      <IncidentPickerInline value={value} displayValue={displayValue} onChange={onChange}
        disabled={disabled} required={required} id={id} className={className} />
    );
  }
  if (type === 'call') {
    return (
      <CallPicker value={value} displayValue={displayValue} onChange={onChange}
        disabled={disabled} required={required} id={id} className={className} />
    );
  }
  if (type === 'case') {
    return (
      <CasePicker value={value} displayValue={displayValue} onChange={onChange}
        disabled={disabled} required={required} id={id} className={className} />
    );
  }

  // warrant / citation / arrest fall back to typed numeric input. These
  // entity types are rarer in the cross-link modal; dedicated pickers
  // can be added in a follow-up when the operator hits them. Until then
  // the fallback mirrors the original surface so the modal keeps working.
  return <RecordIdFallback type={type} value={value} onChange={onChange} disabled={disabled} required={required} id={id} className={className} />;
}

interface FallbackProps {
  type: 'warrant' | 'citation' | 'arrest';
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

function RecordIdFallback({ type, value, onChange, disabled, required, id, className }: FallbackProps) {
  const [text, setText] = useState(value != null ? String(value) : '');
  useEffect(() => {
    setText(value != null ? String(value) : '');
  }, [value]);

  const showClear = text.length > 0 || value != null;
  const label = type === 'warrant' ? 'warrant' : type === 'citation' ? 'citation' : 'arrest record';

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500 pointer-events-none" />
        <input
          id={id}
          type="text"
          value={text}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            setText(digits);
            onChange(digits ? Number(digits) : null);
          }}
          placeholder={`Enter ${label} ID (search picker coming soon)`}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          className="w-full bg-surface-sunken border border-border-default pl-7 pr-7 py-1.5 text-[11px] text-rmpg-100 disabled:opacity-50"
          style={{ borderRadius: 2 }}
          aria-label={`${label} id${required ? ' (required)' : ''}`}
        />
        {showClear && !disabled && (
          <button type="button" onClick={() => { setText(''); onChange(null); }}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-rmpg-500 hover:text-rmpg-100" aria-label="Clear selection">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
