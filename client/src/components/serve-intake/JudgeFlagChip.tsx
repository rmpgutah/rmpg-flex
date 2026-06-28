import { AlertTriangle } from 'lucide-react';
import type { FieldVerdict } from '../../types/serveIntakeJudge';

interface Props {
  verdict: FieldVerdict;
}

export default function JudgeFlagChip({ verdict }: Props) {
  if (verdict.ok) return null;
  return (
    <div className="flex items-start gap-1.5 mt-1 text-[10px] text-amber-300 bg-amber-900/30 border border-amber-700/50 rounded-sm px-1.5 py-0.5">
      <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
      <div>
        <div>{verdict.reason}</div>
        {verdict.suggested_value && (
          <div className="text-amber-200/80">
            Suggested: <span className="font-mono">{verdict.suggested_value}</span>
          </div>
        )}
      </div>
    </div>
  );
}
