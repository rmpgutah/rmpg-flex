import { Link } from 'react-router-dom';
import { FleetListShell } from '../shell/FleetListShell';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { FileEdit } from 'lucide-react';

/** Analysis Forms is RMPG-bespoke meta-analysis across maintenance / fuel /
 *  inspections / assignments. The v1 tab (~550 lines) is feature-complete;
 *  porting it requires its own focused PR. For now this route shows what the
 *  section will host and links to v1 for the full UI. */
export function AnalysisFormsRoute() {
  useFleetV2View('/fleet/v2/analysis');
  return (
    <FleetListShell
      title="Analysis Forms"
      searchPlaceholder="Search forms…"
      onSearchChange={() => {}}
    >
      <div className="p-6 max-w-xl">
        <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-4">
          <div className="flex items-baseline gap-2 mb-2">
            <FileEdit className="w-4 h-4 text-brand-400" />
            <h2 className="text-base font-semibold text-rmpg-100">Custom Analysis Forms</h2>
          </div>
          <p className="text-sm text-rmpg-300 mb-3">
            Bespoke fleet-analysis tooling for cross-resource queries (e.g.
            maintenance × fuel patterns, inspection failure trends, officer
            utilization). The full form library lives in v1.
          </p>
          <p className="text-sm text-rmpg-400 mb-4">
            v2 will host this section when the dedicated port lands. For now,
            access the existing forms in the v1 UI.
          </p>
          <Link
            to="/fleet"
            className="inline-flex items-center gap-1 text-sm text-brand-400 hover:underline"
          >
            Open Analysis Forms in v1 →
          </Link>
        </div>
      </div>
    </FleetListShell>
  );
}
