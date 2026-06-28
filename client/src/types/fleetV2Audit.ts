// ============================================================
// Fleet V2 audit-emit payload types
// ============================================================
// Discriminated union for the `details` field on every
// recordAudit() call emitted from the new /fleet/v2 UI.
// Spec §6.10 mandates typed payloads — no untyped JSON in
// audit_log/flex_events rows.
// ============================================================

export interface FleetV2ViewDetails {
  kind: 'FLEET_V2_VIEW';
  /** The /fleet/v2/... pathname at mount time. */
  route: string;
  /** window.innerWidth at mount time. Used by §6.6 viewport analysis. */
  viewport_width: number;
}

export interface FleetV2ApiErrorDetails {
  kind: 'FLEET_V2_API_ERROR';
  /** The /api/fleet/... endpoint that returned non-2xx. */
  endpoint: string;
  /** HTTP status code (0 if network/abort). */
  status: number;
  /** Human-readable message — never include response body (may leak secrets). */
  message: string;
}

export type FleetV2AuditDetails = FleetV2ViewDetails | FleetV2ApiErrorDetails;

export function isViewDetails(d: FleetV2AuditDetails): d is FleetV2ViewDetails {
  return d.kind === 'FLEET_V2_VIEW';
}

export function isApiErrorDetails(d: FleetV2AuditDetails): d is FleetV2ApiErrorDetails {
  return d.kind === 'FLEET_V2_API_ERROR';
}
