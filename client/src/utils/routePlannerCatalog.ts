/**
 * Route Planner upgrade catalog (named before implementation).
 *
 * 25 fixes / enhancers
 *  1. Clamp/retry Mapbox driving-traffic when depart_at is stale (HTTP 422)
 *  2. Route-tab ETAs walk the saved visit order (no nearest-neighbor re-sort)
 *  3. Print the route sheet in drive order, not priority order
 *  4. Server optimize windows use the planner routeDate, not job.serve_date
 *  5. Cluster chaining uses Directions elapsed time, not the haversine clock
 *  6. Null geocode is a warning (centroid-grade), not silent “high quality”
 *  7. Wire Verify address from ServePage into the planner
 *  8. Optimization V2 looks up units by id OR officer_id
 *  9. Same-day windows: wait if early, never roll ETA to tomorrow
 * 10. Show drive time vs on-site dwell vs window-wait separately
 * 11. Split an 8h+ run by remaining clock, not 50/50 stop count
 * 12. Pin/lock a stop so Optimize cannot move it
 * 13. Keep geocode warnings after a V2-ordered run
 * 14. First-leg miles labeled as estimate until Directions returns
 * 15. Humanize Worker “no token” vs client map token (already present)
 * 16. Service-worker skip of blob/cdn-cgi/extension fetches
 * 17. Serve-attempt upload encryption uses Worker env (JWT fallback)
 * 18. Lunch break (30 min at noon Denver) in client ETAs
 * 19. V2 vehicle lunch break 12:00–13:00 Denver
 * 20. Timeline stop list: sequence rail, window, dwell, access notes
 * 21. Planner chrome: panel-header tokens, Field tools vs Run summary
 * 22. Apply Route confirms drive / dwell / wait breakdown
 * 23. Deadline chips stay on the stop after optimize
 * 24. Traffic replan only remaining (unserved) stops
 * 25. Learned-type dwell still clamped; apartment vs house vs business shown
 *
 * 10 real-life features
 *  A. Unpaid lunch / break on the clock
 *  B. Circular (return to start) vs one-way end-at-last-stop
 *  C. Skip / defer a stop off today’s run
 *  D. Mark arrived → POST /serve-queue/route-progress
 *  E. Navigate to the NEXT unserved stop (not the whole via-list)
 *  F. Court/return deadline countdown on the card
 *  G. Building access / contact restriction on the stop row
 *  H. Fuel dollars + estimated gallons (18 mpg patrol default)
 *  I. Re-optimize remaining after served/failed prefix
 *  J. Evening-window advisory when any stop is 17:00–21:00
 */
export const ROUTE_PLANNER_FIXES = [
  'stale-depart-at-retry',
  'saved-order-etas',
  'print-visit-order',
  'planner-route-date-windows',
  'cluster-directions-clock',
  'null-geocode-warn',
  'verify-address-wired',
  'v2-officer-or-unit-id',
  'same-day-windows',
  'drive-vs-dwell-stats',
  'split-by-clock',
  'pin-stop',
  'geocode-warn-after-v2',
  'first-leg-label',
  'token-copy',
  'sw-skip-opaque',
  'upload-kek-env',
  'client-lunch-break',
  'v2-lunch-break',
  'timeline-stop-list',
  'planner-chrome',
  'apply-breakdown',
  'deadline-chips',
  'traffic-remaining-only',
  'dwell-type-label',
] as const;

export const ROUTE_PLANNER_FEATURES = [
  'lunch-break',
  'circular-vs-oneway',
  'defer-stop',
  'mark-arrived',
  'nav-next-stop',
  'deadline-countdown',
  'access-notes',
  'gallons-and-fuel',
  'reoptimize-remaining',
  'evening-advisory',
] as const;
