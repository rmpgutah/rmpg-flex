import type { DetectedDefendant } from '../../utils/serveIntakeDefendants';

interface Props {
  detected: DetectedDefendant[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export default function DefendantsPicker({ detected, selected, onChange }: Props) {
  if (detected.length <= 1) return null;

  const toggle = (name: string) => {
    onChange(selected.includes(name)
      ? selected.filter(n => n !== name)
      : [...selected, name]);
  };

  return (
    <div className="border border-rmpg-600 rounded-sm p-2 mb-3">
      <div className="text-[10px] text-rmpg-400 uppercase mb-1.5">
        Defendants detected ({detected.length})
      </div>
      <div className="space-y-1">
        {detected.map(d => (
          <label key={d.name} className="flex items-center gap-2 text-xs text-rmpg-200">
            <input
              type="checkbox"
              checked={selected.includes(d.name)}
              onChange={() => toggle(d.name)}
              className="accent-brand-500"
              aria-label={d.name}
            />
            <span>{d.name}</span>
            {d.split_confidence < 1.0 && (
              <span className="text-[9px] text-amber-400 ml-auto">
                {Math.round(d.split_confidence * 100)}% split-conf
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
