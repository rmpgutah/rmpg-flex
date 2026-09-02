import { totalFineOf, newDraft, type ViolationDraft, type OffenseLevel } from './violationStackHelpers';
import { Combobox } from './Combobox';
import { applyStatuteAutofill, type StatuteRow } from './statuteAutofill';

interface Props {
  value: ViolationDraft[];
  onChange: (next: ViolationDraft[]) => void;
  statuteFetcher?: (q: string) => Promise<StatuteRow[]>;
}

const LEVELS: OffenseLevel[] = ['Infraction', 'Misdemeanor', 'Felony'];

export function ViolationStack({ value, onChange, statuteFetcher }: Props) {
  const patch = (id: string, partial: Partial<ViolationDraft>) =>
    onChange(value.map((v) => (v.id === id ? { ...v, ...partial } : v)));

  return (
    <div className="space-y-3">
      {value.map((v, i) => (
        <div key={v.id} className="border border-border-default p-3 bg-surface-sunken">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase font-bold [color:var(--panel-header-color)]">Violation {i + 1}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x.id !== v.id))}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              × Remove
            </button>
          </div>
          {statuteFetcher ? (
            <div className="mb-2">
              <Combobox<StatuteRow>
                value={v.statute_id != null && v.statute_citation ? {
                  id: v.statute_id,
                  citation_code: v.statute_citation,
                  title: '',
                  offense_level: v.offense_level,
                  default_fine: v.fine_amount,
                  description: v.description,
                } : null}
                onChange={(picked) => {
                  if (!picked) {
                    patch(v.id, { statute_id: undefined, statute_citation: '' });
                    return;
                  }
                  const patched = applyStatuteAutofill(v, picked);
                  onChange(value.map((x) => (x.id === v.id ? patched : x)));
                }}
                fetcher={statuteFetcher}
                getLabel={(s) => s.citation_code}
                getKey={(s) => s.id}
                renderOption={(s) => (
                  <div>
                    <div className="text-xs font-bold">{s.citation_code}</div>
                    {s.title && <div className="text-[10px] text-fg-muted">{s.title}</div>}
                  </div>
                )}
                placeholder="Statute / Code (e.g. UCA 41-6a-601)"
              />
            </div>
          ) : (
            <input
              type="text"
              placeholder="Statute / Code (e.g. UCA 41-6a-601)"
              value={v.statute_citation}
              onChange={(e) => patch(v.id, { statute_citation: e.target.value })}
              className="input-dark w-full py-2 text-xs mb-2 min-h-[44px]"
            />
          )}
          <input
            type="text"
            placeholder="Violation description"
            value={v.description}
            onChange={(e) => patch(v.id, { description: e.target.value })}
            className="input-dark w-full py-2 text-xs mb-2 min-h-[44px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={v.offense_level}
              onChange={(e) => patch(v.id, { offense_level: e.target.value as OffenseLevel })}
              className="input-dark py-2 text-xs min-h-[44px]"
            >
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <input
              type="number"
              step="0.01"
              placeholder="Fine"
              value={v.fine_amount}
              onChange={(e) => patch(v.id, { fine_amount: Number(e.target.value) || 0 })}
              className="input-dark py-2 text-xs min-h-[44px]"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, newDraft()])}
        className="w-full py-2 text-xs border border-dashed border-rmpg-600 text-fg-muted hover:[color:var(--panel-header-color)] hover:[border-color:var(--field-label-color)]"
      >
        + Add Violation
      </button>
      <div className="flex justify-between border-t border-border-default pt-2">
        <span className="text-[10px] uppercase font-bold">Total Fine</span>
        <span className="text-xs font-bold [color:var(--panel-header-color)]">${totalFineOf(value).toFixed(2)}</span>
      </div>
    </div>
  );
}
