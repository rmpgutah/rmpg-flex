import { totalFineOf, newDraft, type ViolationDraft, type OffenseLevel } from './violationStackHelpers';

interface Props {
  value: ViolationDraft[];
  onChange: (next: ViolationDraft[]) => void;
}

const LEVELS: OffenseLevel[] = ['Infraction', 'Misdemeanor', 'Felony'];

export function ViolationStack({ value, onChange }: Props) {
  const patch = (id: string, partial: Partial<ViolationDraft>) =>
    onChange(value.map((v) => (v.id === id ? { ...v, ...partial } : v)));

  return (
    <div className="space-y-3">
      {value.map((v, i) => (
        <div key={v.id} className="border border-[#222] p-3 bg-[#0a0a0a]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase font-bold text-[#d4a017]">Violation {i + 1}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x.id !== v.id))}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              × Remove
            </button>
          </div>
          <input
            type="text"
            placeholder="Statute / Code (e.g. UCA 41-6a-601)"
            value={v.statute_citation}
            onChange={(e) => patch(v.id, { statute_citation: e.target.value })}
            className="input-dark w-full py-2 text-xs mb-2 min-h-[44px]"
          />
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
        className="w-full py-2 text-xs border border-dashed border-[#444] text-[#888] hover:text-[#d4a017] hover:border-[#d4a017]"
      >
        + Add Violation
      </button>
      <div className="flex justify-between border-t border-[#222] pt-2">
        <span className="text-[10px] uppercase font-bold">Total Fine</span>
        <span className="text-xs font-bold text-[#d4a017]">${totalFineOf(value).toFixed(2)}</span>
      </div>
    </div>
  );
}
