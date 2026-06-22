// ═══════════════════════════════════════════════════════════════
// Audit-log entity-type → SPA route mapper.
// ───────────────────────────────────────────────────────────────
// Every audit_log row has an entity_type + entity_id pair. The
// AuditLogPage previously had no way to jump from a row to the
// source record — operators had to memorize the route shape per
// type (warrants/persons/cases/...) and paste an id into the URL.
// This util centralises the mapping so the audit row click and any
// future audit-cross-page features all stay consistent.
//
// Pure module — no React imports, no router imports. Returns either
// a deep-link path that conforms to the cross-page contract used
// across the app (see RecordsPage / WarrantsPage / IncidentsPage /
// CitationsPage / CasesPage / DashCamerasPage / DAR / Serve / Evidence
// / FieldInterviews / TrespassOrders / MDT — every page that hydrates
// from ?<entity>_id=<n>) or null when the entity isn't routable
// (e.g. system/config events, the audit log itself).
//
// Unit-tested in __tests__/auditEntityRoute.test.ts.
// ═══════════════════════════════════════════════════════════════

export interface AuditEntityRoute {
  /** Human label for the menu/button — e.g. "Open warrant", "Open person". */
  label: string;
  /** SPA path (no host, no leading API prefix). Suitable for react-router
   *  navigate() or <Link to=>. */
  path: string;
}

/** Look up the SPA route for an audit_log (entity_type, entity_id) pair.
 *  Returns null when no route applies — caller should hide the menu item
 *  and show the row as non-navigable. Case-insensitive on entity_type and
 *  tolerant of singular/plural and snake/camel variants the codebase has
 *  accumulated. */
export function getAuditEntityRoute(
  entityType: string | null | undefined,
  entityId: string | number | null | undefined,
): AuditEntityRoute | null {
  if (!entityType) return null;
  // entity_id "0" is legitimate (rare), but empty string / null / undefined
  // are not. Numeric coercion would treat "0" as falsy.
  const id = entityId === null || entityId === undefined || String(entityId).trim() === ''
    ? null
    : String(entityId).trim();
  if (!id) return null;
  const t = entityType.toLowerCase().trim();

  // ── Dispatch ──
  if (t === 'call' || t === 'calls_for_service' || t === 'cfs') {
    return { label: 'Open call', path: `/mdt?call_id=${encodeURIComponent(id)}` };
  }
  // Units / panic alerts route into MDT too (closest operational surface).
  if (t === 'unit' || t === 'panic_alert' || t === 'checkpoint') {
    // No dedicated unit page — surface the actor in MDT with a hint.
    return null;
  }

  // ── Records (5-tab page) ──
  if (t === 'person' || t === 'persons') {
    return { label: 'Open person', path: `/records?tab=persons&person_id=${encodeURIComponent(id)}` };
  }
  if (t === 'vehicle' || t === 'vehicles' || t === 'vehicle_record') {
    return { label: 'Open vehicle', path: `/records?tab=vehicles&vehicle_id=${encodeURIComponent(id)}` };
  }
  if (t === 'property' || t === 'properties') {
    return { label: 'Open property', path: `/records?tab=properties&property_id=${encodeURIComponent(id)}` };
  }
  if (t === 'business' || t === 'businesses') {
    return { label: 'Open business', path: `/records?tab=businesses&business_id=${encodeURIComponent(id)}` };
  }
  if (t === 'evidence' || t === 'evidence_item' || t === 'property_evidence') {
    return { label: 'Open evidence', path: `/evidence?evidence_id=${encodeURIComponent(id)}` };
  }

  // ── Warrants / NCIC / process service ──
  if (t === 'warrant' || t === 'warrants') {
    return { label: 'Open warrant', path: `/warrants?warrant_id=${encodeURIComponent(id)}` };
  }
  if (t === 'serve_queue' || t === 'serve_job' || t === 'serve' || t === 'process_serve') {
    return { label: 'Open serve job', path: `/serve?job_id=${encodeURIComponent(id)}` };
  }
  if (t === 'trespass_order' || t === 'trespass') {
    return { label: 'Open trespass order', path: `/trespass-orders?order_id=${encodeURIComponent(id)}` };
  }

  // ── Reports + investigations ──
  if (t === 'incident' || t === 'incidents') {
    return { label: 'Open incident', path: `/incidents?incident_id=${encodeURIComponent(id)}` };
  }
  if (t === 'citation' || t === 'citations') {
    return { label: 'Open citation', path: `/citations?citation_id=${encodeURIComponent(id)}` };
  }
  if (t === 'case' || t === 'cases' || t === 'case_management') {
    return { label: 'Open case', path: `/cases?case_id=${encodeURIComponent(id)}` };
  }
  if (t === 'dar' || t === 'daily_activity_report') {
    return { label: 'Open DAR', path: `/dar?dar_id=${encodeURIComponent(id)}` };
  }
  if (t === 'fi' || t === 'field_interview' || t === 'field_interview_card') {
    return { label: 'Open FI card', path: `/field-interviews?fi_id=${encodeURIComponent(id)}` };
  }
  if (t === 'code_enforcement_violation' || t === 'violation') {
    return { label: 'Open violation', path: `/code-enforcement?violation_id=${encodeURIComponent(id)}` };
  }
  if (t === 'tow' || t === 'tow_record') {
    return { label: 'Open tow', path: `/code-enforcement?tow_id=${encodeURIComponent(id)}` };
  }

  // ── Media / footage ──
  if (t === 'dashcam_video' || t === 'dashcam_event' || t === 'dashcam' || t === 'mvr') {
    return { label: 'Open dashcam clip', path: `/dash-cameras?clip_id=${encodeURIComponent(id)}` };
  }
  if (t === 'bodycam_video' || t === 'body_camera' || t === 'bwc') {
    return { label: 'Open BWC clip', path: `/body-cameras?video_id=${encodeURIComponent(id)}` };
  }

  // ── Jail / custody ──
  if (t === 'inmate' || t === 'booking' || t === 'jail_booking') {
    return { label: 'Open inmate', path: `/jail?inmate_id=${encodeURIComponent(id)}` };
  }

  // ── Admin surfaces (no detail panel; route to the tab) ──
  if (t === 'user' || t === 'users' || t === 'officer_credential') {
    return { label: 'Open user', path: `/personnel?user_id=${encodeURIComponent(id)}` };
  }

  // Non-routable entity types fall through:
  //   audit (the log itself), records (legacy alias for the page),
  //   system, config, client_contract, invoice, payment, expense_report,
  //   time_entry, fleet_vehicle, fleetio, alpr_capture, field_photo,
  //   research_finding, deep_research_job, use_of_force.
  // Returning null tells the caller to omit the row's "Open …" action.
  return null;
}
