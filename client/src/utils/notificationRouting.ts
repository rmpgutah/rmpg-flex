// ============================================================
// RMPG Flex — Notification → deep-link routing
//
// Notifications carry an `entity_type` + `entity_id` pair on the
// server (see src/utils/footage/footageAlpr.ts, intelWatchlist.ts,
// caseTaskNudges.ts, serveNudgeSweep.ts, alpr.ts, intel.ts,
// emailProcessor.ts, etc — every code path that issues a notification
// stamps both fields). Until v1056 the client collapsed all of that
// to a single `type → /dispatch | /warrants | /communications | …`
// map in NotificationCenter, throwing the entity_id away — so
// clicking a "Warrant hit on John Doe" notification landed the
// operator on the warrants list instead of John's record.
//
// Each entity_type maps to the matching page's documented deep-link
// param name (matches what /serve, /warrants, /cases, /citations,
// /trespass-orders, /incidents, /field-interviews, /communications,
// /records, /dispatch, /mdt, and /intel/bolos already accept on a
// `?<entity>_id=` query). Returning `null` falls back to the
// type-based default route so the link still goes somewhere useful.
// ============================================================

export interface NotificationLike {
  type: string;
  entity_type?: string | null;
  entity_id?: number | string | null;
}

/**
 * Default landing pages keyed by notification `type` — used when
 * the notification has no entity_type/entity_id (or the entity_type
 * isn't in the deep-link map yet).
 */
const TYPE_DEFAULT_ROUTE: Record<string, string> = {
  dispatch: '/dispatch',
  warrant: '/warrants',
  bolo: '/communications?tab=bolos',
  message: '/communications?tab=messages',
  system: '/',
  credential_expiry: '/personnel',
  patrol_missed: '/patrol',
  // Notification-type literals emitted by the server but not previously routed
  intel_screen: '/intel',
  watchlist_hit: '/intel',
  case_task_nudge: '/tasks',
  task_nudge: '/tasks',
  serve_nudge: '/serve',
  serve_qr_scan: '/serve',
  serve_schedule_request: '/serve',
  email_rule: '/communications?tab=messages',
  intel_product: '/intel/reports',
  escalation: '/notifications',
};

/**
 * entity_type → (id) → deep-link path. The param name matches what
 * the receiving page already documents as its deep-link contract:
 *  - call           → /dispatch?call_id=
 *  - warrant        → /warrants?warrant_id=
 *  - case           → /cases?case_id=
 *  - case_task      → /tasks?task_id= (tasks page deep-links the row
 *                     directly; the prior /cases?task_id= was a no-op
 *                     because Cases only reads ?case_id=)
 *  - person         → /records?tab=persons&person_id=
 *  - vehicle        → /records?tab=vehicles&vehicle_id=
 *  - bolo           → /communications?tab=bolos&bolo_id=
 *  - intel_report   → /intel/reports?report_id=
 *  - serve_job      → /serve?job_id=
 *  - citation       → /citations?citation_id=
 *  - field_interview→ /field-interviews?fi_id=
 *  - trespass       → /trespass-orders?order_id=
 *  - incident       → /incidents?incident_id=
 *  - email_message  → /communications?tab=messages&message_id=
 *  - alpr_capture   → /plate-log?capture_id= (best-effort fallback)
 *  - use_of_force   → /use-of-force?uof_id=
 *  - arrest_record  → /arrest-records?arrest_id= (canonical)
 *  - arrest         → /arrest-records?arrest_id= (legacy alias used by older
 *                     server emitters — kept so notifications generated before
 *                     the canonical name landed still route correctly)
 *  - court_event    → /court-records?event_id= (historical disposition view;
 *                     /court (Court Tracker) accepts the same param for the
 *                     upcoming-dates view, so a notification deep-link works
 *                     equivalently from either page)
 */
const ENTITY_ROUTE_BUILDERS: Record<string, (id: string) => string> = {
  call: (id) => `/dispatch?call_id=${encodeURIComponent(id)}`,
  warrant: (id) => `/warrants?warrant_id=${encodeURIComponent(id)}`,
  case: (id) => `/cases?case_id=${encodeURIComponent(id)}`,
  person: (id) => `/records?tab=persons&person_id=${encodeURIComponent(id)}`,
  vehicle: (id) => `/records?tab=vehicles&vehicle_id=${encodeURIComponent(id)}`,
  bolo: (id) => `/communications?tab=bolos&bolo_id=${encodeURIComponent(id)}`,
  intel_report: (id) => `/intel/reports?report_id=${encodeURIComponent(id)}`,
  serve_job: (id) => `/serve?job_id=${encodeURIComponent(id)}`,
  citation: (id) => `/citations?citation_id=${encodeURIComponent(id)}`,
  field_interview: (id) => `/field-interviews?fi_id=${encodeURIComponent(id)}`,
  trespass: (id) => `/trespass-orders?order_id=${encodeURIComponent(id)}`,
  incident: (id) => `/incidents?incident_id=${encodeURIComponent(id)}`,
  email_message: (id) => `/communications?tab=messages&message_id=${encodeURIComponent(id)}`,
  alpr_capture: (id) => `/plate-log?capture_id=${encodeURIComponent(id)}`,
  use_of_force: (id) => `/use-of-force?uof_id=${encodeURIComponent(id)}`,
  // IA complaint / investigation — added v1070 alongside the IA page deep-link
  // contract. Both land on /affairs?complaint_id= because the investigation
  // is only viewable inside the parent complaint detail panel (the IA route
  // exposes /affairs/complaints/:id/investigations but not a standalone
  // investigation viewer). The investigation_id stays in the URL so the
  // page can scroll/highlight the row inside the complaint detail.
  ia_complaint: (id) => `/affairs?complaint_id=${encodeURIComponent(id)}`,
  ia_investigation: (id) => `/affairs?investigation_id=${encodeURIComponent(id)}`,
  arrest_record: (id) => `/arrest-records?arrest_id=${encodeURIComponent(id)}`,
  arrest: (id) => `/arrest-records?arrest_id=${encodeURIComponent(id)}`,
  research_result: (id) => `/web-research?research_id=${encodeURIComponent(id)}`,
  web_research: (id) => `/web-research?research_id=${encodeURIComponent(id)}`,
};

/**
 * Resolve a notification → the URL we should navigate to.
 * Returns `null` if neither the entity_type nor the type maps to a
 * known route (caller should leave the operator on the current page
 * and just mark-read).
 */
export function routeForEntity(n: NotificationLike): string | null {
  if (n.entity_type && n.entity_id != null) {
    const builder = ENTITY_ROUTE_BUILDERS[n.entity_type];
    if (builder) return builder(String(n.entity_id));
  }
  return TYPE_DEFAULT_ROUTE[n.type] ?? null;
}

/**
 * `true` if the notification has a deep-link target — useful for
 * deciding whether to show an "Open" button / chevron next to a row.
 */
export function hasDeepLink(n: NotificationLike): boolean {
  return routeForEntity(n) !== null;
}
