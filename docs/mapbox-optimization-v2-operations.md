# Mapbox Optimization V2 operations

## Integrated workflows

- Service runs: appointments, service duration, capability requirements, shift boundaries, optional return to origin, fleet MPG metadata, and saved route order/mileage/time write-back.
- Patrol beats: multiple vehicles, traffic-aware routing, shift boundaries, capabilities, breaks that fit the shift, and return-to-origin control.
- Dispatch: assignment plans for selected geocoded calls and available units. The existing dispatch workflow applies assignments; solving a plan does not independently change unit status.
- Fleet: the vehicle route planner now submits real traffic-aware V2 services instead of estimating distance with straight lines and a fixed speed. Shift inputs use Mountain Time. Unassigned stops remain visible.
- Fleet API: `POST /api/mapbox/optimization-v2/submit` accepts `job_type: "fleet_route"` and a `problem` document. Supports services, shipments, capacities, capabilities, FIFO/LIFO loading, pickup/dropoff windows, service windows, breaks, four routing profiles, and either supported objective. Supervisor, manager, or admin access is required.
- Existing geocoding, reverse geocoding, directions, matrix, isochrone, map matching, boundaries, tile query, and static map endpoints remain in `/api/mapbox`.

## Background execution and rules

The existing one-minute scheduled handler and interactive polling share `mapboxOptimizationV2Jobs.ts`. HTTP 202 remains in progress. Network errors, rate limits, and upstream server failures are retryable. Jobs expire ten minutes after submission, including jobs never opened in a browser. Completion and service-route updates use a single D1 batch. Newer saved-route submissions prevent an older result overwriting their route.

Admin → Alert Rules includes `optimization_completed`, `optimization_failed`, and `optimization_stops_dropped`. Rules can match `job_type`, `job_id`, and, for completed plans, `dropped_count` and `route_count`. Rules use the existing notification engine and its configured recipients. No notification rules are enabled automatically. Rule delivery is best-effort, matching the existing engine; it is not a durable event outbox.

Fuel MPG is retained as local job metadata and excluded from the Mapbox API request. Distances and durations are derived from documented stop odometers and ETAs when Mapbox omits route-level summaries. Reading completed jobs returns fuel metadata consistently.

## Deployment and verification

1. Apply and track `0286_mapbox_fleet_optimization.sql` using the repository migration workflow, only if it is not already tracked. It preserves existing jobs and extends the permitted job types. This migration was verified in local D1, and its presence was verified in live D1 on 2026-09-09.
2. The API Worker is `rmpg-flex-api`; use the explicit root `wrangler.toml`. Do not deploy this code over the legacy Worker or API proxy.
3. Mapbox V2 requires account access. A configured token alone does not prove V2 entitlement. Worker-side `MAPBOX_SECRET_TOKEN` takes precedence over `MAPBOX_ACCESS_TOKEN`; secret values never enter client responses.
4. Build the client with `npm run build` in `client`. For a Worker change without container changes, `wrangler deploy --config wrangler.toml --dry-run --containers-rollout none` verifies packaging without rebuilding unrelated OCR containers.
5. Smoke-test a small fleet or service plan through an authenticated session: pending → processing → complete, sensible ETAs, dropped-stop visibility, and saved route reload. Test an enabled alert rule if notification delivery is required.

Cloudflare authentication repair on 2026-09-09: an expired `CF_API_TOKEN` in the local `.env` overrode a valid Wrangler OAuth session. Removing that expired setting restored authentication. No replacement token was needed.

## Verification boundaries

The automated tests cover request validation, pending HTTP 202, transient upstream errors, timeout, cached fuel metadata, ownership, metrics, atomic D1 write-back, migration preservation, and stale-result protection. Existing Mapbox route and client tests were also run. This does not establish production Mapbox V2 entitlement or validate every existing Mapbox feature end to end. Advanced shipment constraints are available through the fleet API; the current vehicle planner UI creates service-stop routes.

References: https://docs.mapbox.com/api/navigation/optimization/ and https://developers.cloudflare.com/workers/wrangler/commands/.

## Release evidence (2026-09-09)

- Isolated release checkout: `/tmp/rmpg-mapbox-release`, based on `aecbefc331`, with the remaining Mapbox alert, timezone, and dropped-stop changes copied in. Unrelated uncommitted workspace edits were excluded.
- Worker deployed successfully: version `0af6d074-04ad-46ee-af53-980e20509127` on `rmpg-flex-api`, retaining existing container images.
- Production Pages deployment succeeded: `https://d6f7b555.rmpg-flex.pages.dev` (`main`, project `rmpg-flex`). Pages Functions were staged with the frontend, matching CI.
- Backend and client typechecks passed. 38 node tests, 15 Worker/D1 tests, and 9 client tests passed. Frontend production build and Worker packaging succeeded.
- Browser reached the live RMPG Flex login page. Authenticated route submission and Mapbox V2 entitlement remain to be verified after user sign-in. Plain command-line HTTP probes were blocked by the edge and are not evidence of app endpoint behavior.
