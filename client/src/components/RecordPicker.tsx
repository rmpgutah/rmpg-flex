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

import { useEffect } from 'react';
import PersonPicker, { type PersonSummary } from './PersonPicker';
import IncidentPickerInline, { type IncidentSummary } from './IncidentPickerInline';
import CallPicker, { type CallSummary } from './CallPicker';
import CasePicker, { type CaseSummary } from './CasePicker';
import WarrantPicker, { type WarrantSummary } from './WarrantPicker';
import CitationPicker, { type CitationSummary } from './CitationPicker';
import ArrestPicker, { type ArrestSummary } from './ArrestPicker';

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
    record?: PersonSummary | IncidentSummary | CallSummary | CaseSummary | WarrantSummary | CitationSummary | ArrestSummary,
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
  if (type === 'warrant') {
    return (
      <WarrantPicker value={value} displayValue={displayValue} onChange={onChange}
        disabled={disabled} required={required} id={id} className={className} />
    );
  }
  if (type === 'citation') {
    return (
      <CitationPicker value={value} displayValue={displayValue} onChange={onChange}
        disabled={disabled} required={required} id={id} className={className} />
    );
  }
  if (type === 'arrest') {
    return (
      <ArrestPicker value={value} displayValue={displayValue} onChange={onChange}
        disabled={disabled} required={required} id={id} className={className} />
    );
  }

  // Exhaustive switch above — every LinkableRecordType is handled. The
  // empty-string branch is caught at the top of the component. This
  // unreachable fallback would only fire if a future type was added
  // without updating the switch; it returns null so a missing type is
  // visible (empty input) rather than silently rendering a broken
  // numeric input.
  return null;
}
