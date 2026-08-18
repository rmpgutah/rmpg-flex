import React, { useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import BeatManagementPanel from '../panels/BeatManagementPanel';
import type { V2Route } from '../../../utils/mapboxOptimizationV2';
import AssignmentArcLayer from '../layers/AssignmentArcLayer';

// MapLeftDock + MapRightDock rendered by MapboxMapPage with sections;
// migration to this layout is a follow-up task

export default function DispatcherMapLayout() {
  const { user } = useAuth();
  const isSupervisorPlus = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');

  const [showBeatPlanner, setShowBeatPlanner] = useState(false);
  const [beatRoutes, setBeatRoutes] = useState<V2Route[]>([]);

  return (
    <div data-testid="dispatcher-map-layout" className="absolute inset-0 pointer-events-none z-10">
      <AssignmentArcLayer />
      {/* Supervisor-only controls */}
      {isSupervisorPlus && (
        <button
          onClick={() => setShowBeatPlanner(true)}
          className="pointer-events-auto absolute top-4 right-4 px-3 py-1.5 bg-surface-raised text-brand-200 text-xs border border-brand-600/40"
          style={{ borderRadius: 2 }}
          aria-label="Open Beat Planner"
        >
          Beat Planner
        </button>
      )}
      {showBeatPlanner && (
        <BeatManagementPanel
          onClose={() => setShowBeatPlanner(false)}
          onSolutionReady={(routes) => { setBeatRoutes(routes); setShowBeatPlanner(false); }}
        />
      )}
    </div>
  );
}
