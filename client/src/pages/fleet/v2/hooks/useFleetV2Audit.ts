import { useEffect, useRef } from 'react';
import { apiFetch } from '../../../../hooks/useApi';
import type { FleetV2AuditDetails } from '../../../../types/fleetV2Audit';

interface EmitArgs {
  action: 'FLEET_V2_VIEW' | 'FLEET_V2_API_ERROR';
  entityType: string;
  details: FleetV2AuditDetails;
}

function emit(args: EmitArgs): void {
  // Fire-and-forget; errors swallowed so audit emits never break the UI.
  apiFetch('/audit-emit', {
    method: 'POST',
    body: JSON.stringify(args),
  }).catch(() => {});
}

/** Emits a single FLEET_V2_VIEW row on mount. Idempotent across React strict-mode double-invoke. */
export function useFleetV2View(route: string): void {
  const emittedRef = useRef(false);
  useEffect(() => {
    if (emittedRef.current) return;
    emittedRef.current = true;
    emit({
      action: 'FLEET_V2_VIEW',
      entityType: 'fleet_ui_page',
      details: {
        kind: 'FLEET_V2_VIEW',
        route,
        viewport_width: typeof window !== 'undefined' ? window.innerWidth : 0,
      },
    });
  }, [route]);
}

/** Used by API-call error sentinels (FleetListShell + per-Route fetch wrappers). */
export function emitFleetV2ApiError(endpoint: string, status: number, message: string): void {
  emit({
    action: 'FLEET_V2_API_ERROR',
    entityType: 'fleet_ui_page',
    details: { kind: 'FLEET_V2_API_ERROR', endpoint, status, message },
  });
}
