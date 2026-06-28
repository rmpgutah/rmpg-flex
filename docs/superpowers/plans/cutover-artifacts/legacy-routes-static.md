# Legacy Worker (`rmpg-flex`) — Static Route Inventory

> **Phase 0 / Task 0.2** of [docs/superpowers/plans/2026-06-12-worker-cutover.md](../2026-06-12-worker-cutover.md).
> Generated 2026-06-12 from the **deployed** `rmpg-flex` bundle pulled via the Cloudflare MCP
> (`workers_get_worker_code({scriptName:'rmpg-flex'})`, 3.6 MB / ~93k lines, saved under
> `legacy-worker-snapshot/rmpg-flex-bundle.js`, gitignored). This is the **static** route table
> (everything the legacy worker *can* serve). The **dynamic** inventory — what actually still
> falls through to legacy in production — comes from Task 0.3 after ≥7 days of `[legacy-fallthrough]`
> Workers Logs and lives in `legacy-traffic-inventory.md`. Cross-check the two: any route here with
> zero traffic is "dormant" but still needs an explicit Phase 3 coverage/stub decision.

> **Architecture note (corrects the plan's assumption):** the legacy worker is a **single** Hono
> `app` instance with a `ROUTE_REGISTRY` array that `app.route(prefix, router)`-mounts every
> subsystem router — there is no nested `app2`. Three WebSocket paths (`/api/ws`, `/api/voice-ws`,
> `/api/alerts-ws`) are handled by a raw `fetch()` URL match **before** Hono sees the request.

---

## Mount Map (ROUTE_REGISTRY → `app.route(prefix, router)`)

All routers are mounted directly on the root `app` (single Hono instance, no `app2`). The `ROUTE_REGISTRY` iterates and calls `app.route(m2.prefix, m2.router)` for each entry. Additionally, `/api/ws`, `/api/voice-ws`, and `/api/alerts-ws` are handled before Hono via raw `fetch()` URL pattern matching.

| Router variable | Mount prefix | Auth |
|---|---|---|
| `health_default` | `/api/health` | public |
| `auth_default` | `/api/auth` | public |
| `mapData_default` | `/api/map-data` | public |
| `tiles_default` | `/api/tiles` | public |
| `geo_default` | `/api/geo` | public |
| `inspections_default` | `/api/inspections` | public (token-authed internally) |
| `crime_default` | `/api/crime` | required |
| `duty_default` | `/api/dispatch/duty` | required |
| `callLinks_default` | `/api/dispatch` | required |
| `panic_default` | `/api/dispatch` | required |
| `anomalies_default` | `/api/dispatch` | required |
| `premiseHistory_default` | `/api/dispatch` | required |
| `recommendedUnits` | `/api/dispatch/calls` | required |
| `closestUnit` | `/api/dispatch/calls` | required |
| `autoAssign` | `/api/dispatch/calls` | required |
| `callTimeline` | `/api/dispatch/calls` | required |
| `callActions` | `/api/dispatch/calls` | required |
| `callWarnings` | `/api/dispatch/calls` | required |
| `audioMode` | `/api/dispatch/units` | required |
| `unitStatus` | `/api/dispatch/units` | required |
| `premiseAlerts` | `/api/dispatch/premise-alerts` | required |
| `bolos` (dispatch) | `/api/dispatch/bolos` | required |
| `welfareActive` | `/api/dispatch/welfare` | required |
| `calls_default` | `/api/dispatch/calls` | required |
| `units_default` | `/api/dispatch/units` | required |
| `gps_default` | `/api/dispatch/gps` | required |
| `trips_default` | `/api/dispatch/trips` | required |
| `geography_default` | `/api/dispatch/geography` | required |
| `aggregates_default` | `/api/dispatch` | required |
| `runCards_default` | `/api/dispatch/run-cards` | required |
| `welfare_default` | `/api/dispatch/welfare` | required |
| `admin_default` | `/api/admin` | required |
| `adminSettings_default` | `/api/admin/settings` | required |
| `email_default` | `/api/email` | required (also re-mounted public at bottom) |
| `emailOauthCallback_default` | `/api/email-oauth` | public |
| `announcements_default` | `/api/announcements` | required |
| `ai_default` | `/api/ai` | required |
| `voice_default` | `/api/voice` | required |
| `personnel_default` | `/api/personnel` | required |
| `presence_default` | `/api/presence` | required |
| `properties_default` | `/api/records/properties` | required |
| `subjects_default` | `/api/records/subjects` | required |
| `records_default` | `/api/records` | required |
| `nibrs_default` | `/api/nibrs` | required |
| `incidents_default` | `/api/incidents` | required |
| `incidentSupplements_default` | `/api/incidents` | required |
| `incidentSubresources_default` | `/api/incidents` | required |
| `cases_default` | `/api/cases` | required |
| `citations_default` | `/api/citations` | required |
| `clients_default` | `/api/clients` | required |
| `connections_default` | `/api/connections` | required |
| `court_default` | `/api/court` | required |
| `crisisResponse_default` | `/api/crisis` | required |
| `crm_default` | `/api/crm` | required |
| `dlRecords_default` | `/api/dl-records` | required |
| `cloudflare_default` | `/api/cloudflare` | required |
| `fieldInterviews_default` | `/api/field-interviews` | required |
| `fleet_default` | `/api/fleet` | required |
| `forensics_default` | `/api/forensics` | required |
| `forensics_default` (alias) | `/api/forensic-lab` | required |
| `gangIntel_default` | `/api/gang-intel` | required |
| `hr_default` | `/api/hr` | required |
| `iped_default` | `/api/iped` | required |
| `narcotics_default` | `/api/narcotics` | required |
| `nav_default` | `/api/nav` | required |
| `offline_default` | `/api/offline` | required |
| `patrol_default` | `/api/patrol` | required |
| `patrolMileage_default` | `/api/patrol` | required |
| `radio_default` | `/api/radio` | required |
| `recruitment_default` | `/api/recruitment` | required |
| `serve_default` | `/api/serve` | required |
| `serve_default` (alias) | `/api/process-server` | required |
| `specialOps_default` | `/api/special-ops` | required |
| `settings_default` | `/api/settings` | required |
| `statutes_default` | `/api/statutes` | required |
| `serveIntake_default` | `/api/serve-intake` | required |
| `ocr_default` | `/api/ocr` | required |
| `skiptracer_default` | `/api/skiptracer` | required |
| `trespassOrders_default` | `/api/trespass-orders` | required |
| `victimServices_default` | `/api/victim-services` | required |
| `affairs_default` | `/api/affairs` | required |
| `alarms_default` | `/api/alarms` | required |
| `accreditation_default` | `/api/accreditation` | required |
| `notifications_default` | `/api/alerts` | required |
| `arrests_default` | `/api/arrests` | required |
| `assets_default` | `/api/assets` | required |
| `audit_default` | `/api/audit` | required |
| `billing_default` | `/api/billing` | required |
| `invoices_default` | `/api/invoices` | required |
| `useOfForce_default` | `/api/use-of-force` | required |
| `community_default` | `/api/community` | required |
| `intel_default` | `/api/intel` | required |
| `interagency_default` | `/api/interagency` | required |
| `jail_default` | `/api/jail` | required |
| `knowledgeBase_default` | `/api/knowledge-base` | required |
| `qa_default` | `/api/qa` | required |
| `risk_default` | `/api/risk` | required |
| `tasks_default` | `/api/tasks` | required |
| `training_default` | `/api/training` | required |
| `folders_default` | `/api/documents` | required |
| `pdfTools_default` | `/api/pdf-tools` | required |
| `documentIntake_default` | `/api/document-intake` | required |
| `tts_default` | `/api/tts` | required |
| `vehicles_default` | `/api/business-vehicles` | required |
| `visits_default` | `/api/business-visits` | required |
| `photos_default` | `/api/business-photos` | required |
| `fieldPhotos_default` | `/api/field-photos` | required |
| `howen_default` | `/api/howen` | required |
| `offenderRegistry_default` | `/api/offender-registry` | required |
| `offenderRegistry_default` (alias) | `/api/sex-offender-registry` | required |
| `uploads_default` | `/api/uploads` | public (HMAC-signed internally) |
| `companyDocuments_default` | `/api/company-documents` | required |
| `geocode_default` | `/api` | public (owns `/api/geocode/*`, `/api/integrations/mapbox/client-token`) |
| `shiftPlans_default` | `/api` | public (owns `/api/shift-plans/*`, `/api/shift-swaps/*`, etc.) |
| `downloads_default` | `/api` | public (owns `/api/downloads/info`, `/api/downloads/check`) |
| `warrants_default` | `/api/warrants` | required |
| `stubs_default` | `/api/user` | required |
| `notificationsInbox_default` | `/api/notifications` | required |
| `reports_default` | `/api/reports` | required |
| `bolos` (comms) | `/api/comms/bolos` | required |
| `stubs_default` | `/api/comms` | required |
| `stubs_default` | `/api/stats` | required |
| `weather_default` | `/api/weather` | required |
| `integrations_default` | `/api/integrations` | required |
| `stubs_default` | `/api/dispatch/stats` | required |
| `shiftHandoff_default` | `/api/dispatch/shift-handoff` | required |
| `stubs_default` | `/api/clearpathgps` | required |
| `microbilt_default` | `/api/microbilt` | required |
| `stubs_default` | `/api/servemanager` | required |
| `stubs_default` | `/api/skiptracer-v2` | required |
| `stubs_default` | `/api/cfs` | required |
| `codeEnforcement_default` | `/api/code-enforcement` | required |
| `stubs_default` | `/api/dar` | required |
| `stubs_default` | `/api/diagnostics` | public |
| `stubs_default` | `/api/firecrawl-tools` | required |
| `stubs_default` | `/api/mobile` | public |
| `stubs_default` | `/api/pdf-artifacts` | required |
| `stubs_default` | `/api/pdf-engine` | required |
| `stubs_default` | `/api/updates` | public |
| `stubs_default` | `/api/voice-persona` | required |
| `email_default` (dup) | `/api/email` | public |

Also — `personnel_default` sub-mounts via `.route()`:
- `bodyCamerasRouter` mounted at `/body-cameras` relative → `/api/personnel/body-cameras`
- `bodycamVideosRouter` mounted at `/bodycam-videos` relative → `/api/personnel/bodycam-videos`

---

## Complete Route List

### root (non-/api) — direct `app` registrations + WebSocket via `fetch()` intercept

```
GET  /downloads/:filename
GET  /updates/:filename
GET  /download
GET  /rmpg-seal.png
GET  /updates/latest.yml
GET  /updates/latest-mac.yml
GET  /
POST /__welfare-fire
WS   /api/ws              (WebSocket — handled before Hono in fetch())
WS   /api/voice-ws        (WebSocket → VoiceHubDO, room param required)
WS   /api/alerts-ws       (WebSocket → AlertHubDO)
```

---

### /api/health

```
GET  /api/health/
```

---

### /api/auth

```
POST /api/auth/login
POST /api/auth/login/verify-2fa
POST /api/auth/login/verify-backup-code
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/password
POST /api/auth/change-password
POST /api/auth/login/change-password
GET  /api/auth/password-policy
GET  /api/auth/session-timeout
POST /api/auth/sign-urls
GET  /api/auth/profile
PUT  /api/auth/profile
GET  /api/auth/sessions
DELETE /api/auth/sessions/:sessionId
GET  /api/auth/totp/status
GET  /api/auth/2fa/status
GET  /api/auth/security/status
GET  /api/auth/security/recent-threats
GET  /api/auth/security/blocked-ips
GET  /api/auth/security/login-history
GET  /api/auth/security/password-compliance
GET  /api/auth/security/session-analytics
GET  /api/auth/security/event-timeline
GET  /api/auth/profile-image
PUT  /api/auth/profile-image
GET  /api/auth/signature
PUT  /api/auth/signature
POST /api/auth/totp/setup
POST /api/auth/2fa/setup
POST /api/auth/totp/verify-setup
POST /api/auth/2fa/setup/verify
POST /api/auth/totp/disable
POST /api/auth/2fa/backup-codes/regenerate
GET  /api/auth/webauthn/status
GET  /api/auth/webauthn/credentials
POST /api/auth/webauthn/register-options
POST /api/auth/webauthn/register-verify
DELETE /api/auth/webauthn/credentials/:id{[0-9]+}
POST /api/auth/webauthn/authenticate-options
POST /api/auth/webauthn/authenticate-verify
POST /api/auth/security/unblock-ip
```

---

### /api/map-data

```
GET  /api/map-data/:path{[\s\S]*}
GET  /api/map-data/
```

---

### /api/tiles

```
GET  /api/tiles/:name/:z/:x/:y
GET  /api/tiles/:file
```

---

### /api/geo

```
GET  /api/geo/address-search
GET  /api/geo/address-nearest
```

---

### /api/geocode (mounted at /api)

```
GET  /api/geocode/search
GET  /api/geocode/reverse
GET  /api/integrations/mapbox/client-token
```

---

### /api/inspections

```
GET  /api/inspections/by-token/:token
POST /api/inspections/by-token/:token
POST /api/inspections/by-token/:token/photos
GET  /api/inspections/by-token/:token/photo
```

---

### /api/crime

```
GET  /api/crime/slc
GET  /api/crime/local
GET  /api/crime/crashes
GET  /api/crime/regional
```

---

### /api/dispatch/duty

```
GET  /api/dispatch/duty/me
POST /api/dispatch/duty/start
POST /api/dispatch/duty/end
```

---

### /api/dispatch (callLinks — shares /api/dispatch prefix)

```
GET    /api/dispatch/calls/:id/persons
POST   /api/dispatch/calls/:id/persons
DELETE /api/dispatch/calls/:id/persons/:linkId
PATCH  /api/dispatch/calls/:id/persons/:linkId
POST   /api/dispatch/calls/:id/persons/quick-add
GET    /api/dispatch/calls/:id/vehicles
POST   /api/dispatch/calls/:id/vehicles
DELETE /api/dispatch/calls/:id/vehicles/:linkId
PATCH  /api/dispatch/calls/:id/vehicles/:linkId
POST   /api/dispatch/calls/:id/vehicles/quick-add
PUT    /api/dispatch/calls/:id/property
DELETE /api/dispatch/calls/:id/property
```

---

### /api/dispatch (panic — shares /api/dispatch prefix)

```
POST /api/dispatch/panic
POST /api/dispatch/panic/:id/acknowledge
POST /api/dispatch/panic/:id/resolve
POST /api/dispatch/panic/:id/cancel
POST /api/dispatch/panic/:id/false-alarm
POST /api/dispatch/panic/:id/deactivate
POST /api/dispatch/request-backup
```

---

### /api/dispatch (anomalies — shares /api/dispatch prefix)

```
GET  /api/dispatch/anomaly-alerts
POST /api/dispatch/anomaly-alerts/:id/acknowledge
```

---

### /api/dispatch (premiseHistory — shares /api/dispatch prefix)

```
GET  /api/dispatch/premise-history
GET  /api/dispatch/address-occupants
```

---

### /api/dispatch/calls (recommendedUnits)

```
GET  /api/dispatch/calls/:id/recommended-units
```

---

### /api/dispatch/calls (closestUnit)

```
GET  /api/dispatch/calls/:id/closest-unit
```

---

### /api/dispatch/calls (autoAssign)

```
POST /api/dispatch/calls/:id/auto-assign
```

---

### /api/dispatch/calls (callTimeline)

```
POST   /api/dispatch/calls/:id/timeline
PUT    /api/dispatch/calls/:id/timeline/:entryId
DELETE /api/dispatch/calls/:id/timeline/:entryId
```

---

### /api/dispatch/calls (callActions)

```
POST   /api/dispatch/calls/:id/revert-status
POST   /api/dispatch/calls/:id/le-notification
POST   /api/dispatch/calls/:id/transfer
POST   /api/dispatch/calls/:id/broadcast-note
POST   /api/dispatch/calls/:id/notes
PUT    /api/dispatch/calls/:id/notes/:noteId
DELETE /api/dispatch/calls/:id/notes/:noteId
GET    /api/dispatch/calls/:id/serve-link
POST   /api/dispatch/calls/:id/send-to-serve
PATCH  /api/dispatch/calls/:id/pin
```

---

### /api/dispatch/calls (callWarnings)

```
GET  /api/dispatch/calls/:id/warnings
```

---

### /api/dispatch/units (audioMode)

```
GET  /api/dispatch/units/mine/audio-mode
PUT  /api/dispatch/units/:id/audio-mode
PUT  /api/dispatch/units/:id/mileage
```

---

### /api/dispatch/units (unitStatus)

```
PUT  /api/dispatch/units/:id/status
```

---

### /api/dispatch/premise-alerts

```
GET    /api/dispatch/premise-alerts/
GET    /api/dispatch/premise-alerts/:id
POST   /api/dispatch/premise-alerts/
PUT    /api/dispatch/premise-alerts/:id
DELETE /api/dispatch/premise-alerts/:id
GET    /api/dispatch/premise-alerts/near/scan
```

---

### /api/dispatch/bolos

```
GET    /api/dispatch/bolos/
GET    /api/dispatch/bolos/active
GET    /api/dispatch/bolos/check
GET    /api/dispatch/bolos/stats
GET    /api/dispatch/bolos/:id
POST   /api/dispatch/bolos/
PUT    /api/dispatch/bolos/:id
DELETE /api/dispatch/bolos/:id
POST   /api/dispatch/bolos/:id/archive
POST   /api/dispatch/bolos/:id/unarchive
POST   /api/dispatch/bolos/expire-check
POST   /api/dispatch/bolos/auto-archive
```

---

### /api/dispatch/welfare (welfareActive + welfare_default)

```
GET  /api/dispatch/welfare/active
POST /api/dispatch/welfare/ack
POST /api/dispatch/welfare/start
POST /api/dispatch/welfare/activity
POST /api/dispatch/welfare/help
POST /api/dispatch/welfare/snooze
POST /api/dispatch/welfare/prompt/:userId
POST /api/dispatch/welfare/escalate
POST /api/dispatch/welfare/checkin/:unitId
```

---

### /api/dispatch/calls (calls_default)

```
GET    /api/dispatch/calls/
POST   /api/dispatch/calls/
GET    /api/dispatch/calls/active
GET    /api/dispatch/calls/export
GET    /api/dispatch/calls/check-duplicate
GET    /api/dispatch/calls/archive-bulk
POST   /api/dispatch/calls/archive-bulk
GET    /api/dispatch/calls/:id
PUT    /api/dispatch/calls/:id
GET    /api/dispatch/calls/:id/audit-trail
DELETE /api/dispatch/calls/:id
POST   /api/dispatch/calls/:id/status
POST   /api/dispatch/calls/:id/archive
POST   /api/dispatch/calls/:id/unarchive
POST   /api/dispatch/calls/:id/hold
POST   /api/dispatch/calls/:id/resume
POST   /api/dispatch/calls/:id/assign-unit
POST   /api/dispatch/calls/:id/unassign-unit
POST   /api/dispatch/calls/:id/dispatch
POST   /api/dispatch/calls/:id/redispatch
POST   /api/dispatch/calls/:id/undo-redispatch
POST   /api/dispatch/calls/bulk-reassign
```

---

### /api/dispatch/units (units_default)

```
GET    /api/dispatch/units/
POST   /api/dispatch/units/
PUT    /api/dispatch/units/:id
DELETE /api/dispatch/units/:id
PUT    /api/dispatch/units/:id/status
```

---

### /api/dispatch/gps

```
POST /api/dispatch/gps/
GET  /api/dispatch/gps/current
GET  /api/dispatch/gps/my-unit
GET  /api/dispatch/gps/my-vehicle
GET  /api/dispatch/gps/dwell-times
GET  /api/dispatch/gps/speed-zones
GET  /api/dispatch/gps/trails
GET  /api/dispatch/gps/history
GET  /api/dispatch/gps/units-with-trails
GET  /api/dispatch/gps/speed-violations
POST /api/dispatch/gps/speed-violations/:id/acknowledge
GET  /api/dispatch/gps/pursuit-segments
GET  /api/dispatch/gps/speed-heatmap
GET  /api/dispatch/gps/history-map
```

---

### /api/dispatch/trips

```
GET  /api/dispatch/trips/
GET  /api/dispatch/trips/active
GET  /api/dispatch/trips/:id
```

---

### /api/dispatch/geography

```
GET  /api/dispatch/geography/tree
GET  /api/dispatch/geography/codes
GET  /api/dispatch/geography/codes/lookup/:code
GET  /api/dispatch/geography/premise-alerts
GET  /api/dispatch/geography/districts
GET  /api/dispatch/geography/districts/identify
GET  /api/dispatch/geography/premise-intel
POST /api/dispatch/geography/backfill
GET  /api/dispatch/geography/zone-allocation
```

---

### /api/dispatch (aggregates — shares /api/dispatch prefix)

```
GET  /api/dispatch/
GET  /api/dispatch/disposition-stats
GET  /api/dispatch/queue
GET  /api/dispatch/districts
GET  /api/dispatch/heatmap/enforcement
GET  /api/dispatch/heatmap/predictions
GET  /api/dispatch/analysis/summary
GET  /api/dispatch/heatmap/types
GET  /api/dispatch/stats/dashboard
GET  /api/dispatch/integration-dashboard
GET  /api/dispatch/history-map
```

---

### /api/dispatch/run-cards

```
GET    /api/dispatch/run-cards/
GET    /api/dispatch/run-cards/by-type/:incident_type
GET    /api/dispatch/run-cards/:id
POST   /api/dispatch/run-cards/
PUT    /api/dispatch/run-cards/:id
DELETE /api/dispatch/run-cards/:id
```

---

### /api/dispatch/shift-handoff

```
GET /api/dispatch/shift-handoff/
PUT /api/dispatch/shift-handoff/
```

---

### /api/admin

```
GET  /api/admin/config
GET  /api/admin/call-templates
GET  /api/admin/clients
GET  /api/admin/clients/:id
GET  /api/admin/clients/:id/incidents
GET  /api/admin/clients/:id/calls
GET  /api/admin/clients/:id/billing
POST /api/admin/clients
PUT  /api/admin/clients/:id
DELETE /api/admin/clients/:id
POST /api/admin/clients/:id/archive
POST /api/admin/clients/:id/unarchive
GET  /api/admin/shift-stats
GET  /api/admin/upcoming-court-dates
GET  /api/admin/expiring-certifications
GET  /api/admin/google-maps-config
GET  /api/admin/config/branding
GET  /api/admin/health/detailed
GET  /api/admin/changelog
GET  /api/admin/system-health
GET  /api/admin/users-activity-summary
GET  /api/admin/realtime-stats
GET  /api/admin/retention
GET  /api/admin/retention/preview
GET  /api/admin/api-stats
GET  /api/admin/user-activity-heatmap
GET  /api/admin/backup-status
GET  /api/admin/config-history
GET  /api/admin/departments
POST /api/admin/departments
PUT  /api/admin/departments/:id
DELETE /api/admin/departments/:id
GET  /api/admin/announcements/all
POST /api/admin/announcements
PUT  /api/admin/announcements/:id
DELETE /api/admin/announcements/:id
GET  /api/admin/notification-rules
POST /api/admin/notification-rules
PUT  /api/admin/notification-rules/:id
DELETE /api/admin/notification-rules/:id
POST /api/admin/notification-rules/:id/test
GET  /api/admin/maintenance-mode
PUT  /api/admin/maintenance-mode
GET  /api/admin/third-party-keys
GET  /api/admin/third-party-keys/:key
PUT  /api/admin/third-party-keys
DELETE /api/admin/third-party-keys
GET  /api/admin/users
GET  /api/admin/sessions
GET  /api/admin/database/stats
GET  /api/admin/system-overview
GET  /api/admin/users/presence
GET  /api/admin/ia/complaints
GET  /api/admin/ia/disciplinary
GET  /api/admin/ia/stats
GET  /api/admin/policies/acknowledgements
GET  /api/admin/database/backup
GET  /api/admin/database/backups
POST /api/admin/database/analyze
GET  /api/admin/database/integrity-check
POST /api/admin/database/vacuum
POST /api/admin/purge/activity-logs
POST /api/admin/purge/notifications
POST /api/admin/purge/sessions
POST /api/admin/query
GET  /api/admin/activity-feed
POST /api/admin/health/client-error
GET  /api/admin/health/client-error
GET  /api/admin/system-settings
PUT  /api/admin/system-settings
GET  /api/admin/map-config
PUT  /api/admin/map-config
POST /api/admin/impersonate
GET  /api/admin/config-history     ← duplicate registered
POST /api/admin/settings/reset
GET  /api/admin/shift-plans
POST /api/admin/system/lockdown
```

---

### /api/admin/settings

```
GET  /api/admin/settings/
GET  /api/admin/settings/values
GET  /api/admin/settings/:key
PUT  /api/admin/settings/:key
PUT  /api/admin/settings/
POST /api/admin/settings/reset
```

---

### /api/email-oauth

```
GET  /api/email-oauth/callback
```

---

### /api/email

```
GET    /api/email/oauth/callback     ← (also served by email_default, but email-oauth owns it)
GET    /api/email/status
PUT    /api/email/admin/credentials
DELETE /api/email/admin/credentials
GET    /api/email/admin/oauth/authorize
POST   /api/email/admin/test-connection
PUT    /api/email/admin/enable
PUT    /api/email/admin/smtp-settings
GET    /api/email/folders
GET    /api/email/folders/:id/children
GET    /api/email/unread-count
GET    /api/email/messages
GET    /api/email/messages/search
GET    /api/email/messages/:id
GET    /api/email/messages/:id/attachments
GET    /api/email/messages/:id/attachments/:aid
GET    /api/email/image-proxy
PATCH  /api/email/messages/:id
POST   /api/email/messages/:id/move
DELETE /api/email/messages/:id
POST   /api/email/send
GET    /api/email/outbox
POST   /api/email/messages/:id/reply
GET    /api/email/signature
PUT    /api/email/signature
POST   /api/email/admin/sync-now
GET    /api/email/rules
POST   /api/email/rules
PUT    /api/email/rules/:id
DELETE /api/email/rules/:id
POST   /api/email/rules/test-match
GET    /api/email/links/:graphId
GET    /api/email/links/by-entity/:type/:id
POST   /api/email/link
DELETE /api/email/link/:id
POST   /api/email/messages/:id/reply-all
POST   /api/email/messages/:id/forward
POST   /api/email/messages/batch
POST   /api/email/messages/mark-all-read
POST   /api/email/folders
PATCH  /api/email/folders/:id
DELETE /api/email/folders/:id
POST   /api/email/folders/:id/empty
POST   /api/email/drafts
PATCH  /api/email/drafts/:id
POST   /api/email/drafts/:id/send
GET    /api/email/conversations/:id
GET    /api/email/threads
GET    /api/email/messages/:id/headers
GET    /api/email/messages/:id/raw
GET    /api/email/categories
POST   /api/email/categories
DELETE /api/email/categories/:id
PATCH  /api/email/messages/:id/categories
POST   /api/email/categorize/batch
PATCH  /api/email/messages/:id/focused
POST   /api/email/sweep
POST   /api/email/block-sender
GET    /api/email/blocked-senders
DELETE /api/email/blocked-senders/:id
POST   /api/email/messages/:id/snooze
GET    /api/email/snoozed
DELETE /api/email/snoozed/:id
GET    /api/email/templates
POST   /api/email/templates
PUT    /api/email/templates/:id
DELETE /api/email/templates/:id
POST   /api/email/schedule
GET    /api/email/scheduled
DELETE /api/email/scheduled/:id
GET    /api/email/settings/auto-reply
PUT    /api/email/settings/auto-reply
GET    /api/email/settings/mailbox
GET    /api/email/people
GET    /api/email/oauth/authorize
GET    /api/email/contacts/search
GET    /api/email/mailbox-stats
```

---

### /api/announcements

```
GET  /api/announcements/
```

---

### /api/ai

```
GET  /api/ai/config
GET  /api/ai/stats
GET  /api/ai/status
GET  /api/ai/health
GET  /api/ai/activity
GET  /api/ai/dev-chat/history
POST /api/ai/suggest-units
POST /api/ai/analyze
POST /api/ai/narrative
POST /api/ai/smart-search
```

---

### /api/voice

```
POST /api/voice/dialogue
POST /api/voice/read-aloud
```

---

### /api/personnel

```
GET    /api/personnel/
GET    /api/personnel/credentials
POST   /api/personnel/credentials
PUT    /api/personnel/credentials/:id
DELETE /api/personnel/credentials/:id
GET    /api/personnel/equipment
GET    /api/personnel/equipment-log
GET    /api/personnel/equipment/:id/checkout-log
POST   /api/personnel/equipment/:id/checkin
POST   /api/personnel/:officerId/equipment
PUT    /api/personnel/equipment/:id
DELETE /api/personnel/equipment/:id
POST   /api/personnel/equipment/:id/checkout
POST   /api/personnel/equipment/:id/checkin
GET    /api/personnel/schedules
POST   /api/personnel/schedules
PUT    /api/personnel/schedules/:id
DELETE /api/personnel/schedules/:id
GET    /api/personnel/time
POST   /api/personnel/time/clock-in
POST   /api/personnel/time/clock-out
POST   /api/personnel/time/start-break
POST   /api/personnel/time/end-break
POST   /api/personnel/time
PUT    /api/personnel/time/:id
DELETE /api/personnel/time/:id
GET    /api/personnel/deployments
POST   /api/personnel/deployments
PUT    /api/personnel/deployments/:id
DELETE /api/personnel/deployments/:id
GET    /api/personnel/coverage-gaps
POST   /api/personnel/
PUT    /api/personnel/:id
POST   /api/personnel/:id/role
POST   /api/personnel/:id/reset-password
POST   /api/personnel/:id/status
DELETE /api/personnel/:id
GET    /api/personnel/training
POST   /api/personnel/training
PUT    /api/personnel/training/:id
DELETE /api/personnel/training/:id
GET    /api/personnel/training-requirements
POST   /api/personnel/training-requirements
PUT    /api/personnel/training-requirements/:id
DELETE /api/personnel/training-requirements/:id
GET    /api/personnel/training-completion
GET    /api/personnel/body-cameras
GET    /api/personnel/bodycam-videos
GET    /api/personnel/bodycam-videos/retention/report
GET    /api/personnel/bodycam-videos/reviews/pending
GET    /api/personnel/bodycam-videos/redaction-requests
GET    /api/personnel/duty-hours
GET    /api/personnel/activity/:id
GET    /api/personnel/fitness/:id
POST   /api/personnel/fitness/:id
GET    /api/personnel/commendations/:id
POST   /api/personnel/commendations/:id
GET    /api/personnel/:id/dispatch-stats
GET    /api/personnel/:id/fleet-summary
```

---

### /api/personnel/body-cameras (sub-mounted)

```
GET    /api/personnel/body-cameras/
GET    /api/personnel/body-cameras/:id
POST   /api/personnel/body-cameras/
PUT    /api/personnel/body-cameras/:id
DELETE /api/personnel/body-cameras/:id
```

---

### /api/personnel/bodycam-videos (sub-mounted)

```
GET    /api/personnel/bodycam-videos/reviews/pending
GET    /api/personnel/bodycam-videos/redaction-requests
GET    /api/personnel/bodycam-videos/retention/report
GET    /api/personnel/bodycam-videos/
GET    /api/personnel/bodycam-videos/:id
PUT    /api/personnel/bodycam-videos/:id
DELETE /api/personnel/bodycam-videos/:id
POST   /api/personnel/bodycam-videos/
POST   /api/personnel/bodycam-videos/upload-init
POST   /api/personnel/bodycam-videos/upload-chunk
POST   /api/personnel/bodycam-videos/upload-complete
DELETE /api/personnel/bodycam-videos/upload-abort/:uploadId
GET    /api/personnel/bodycam-videos/:id/stream
```

---

### /api/presence

```
GET  /api/presence/
```

---

### /api/records/properties

```
GET    /api/records/properties/
POST   /api/records/properties/
GET    /api/records/properties/:id
PUT    /api/records/properties/:id
DELETE /api/records/properties/:id
POST   /api/records/properties/:id/archive
POST   /api/records/properties/:id/unarchive
GET    /api/records/properties/export
```

---

### /api/records/subjects

```
GET  /api/records/subjects/search
```

---

### /api/records

```
GET    /api/records/properties        ← (also via records router)
POST   /api/records/properties
PUT    /api/records/properties/:id
POST   /api/records/persons
POST   /api/records/from-dl-scan
GET    /api/records/persons/search
GET    /api/records/persons/export
POST   /api/records/persons/check-duplicates
GET    /api/records/persons/duplicates
POST   /api/records/persons/merge
GET    /api/records/persons/alias-search
GET    /api/records/persons/:id
PUT    /api/records/persons/:id
DELETE /api/records/persons/:id
POST   /api/records/persons/:id/archive
POST   /api/records/persons/:id/unarchive
GET    /api/records/persons/:id/system-history
GET    /api/records/persons/:id/criminal-history
POST   /api/records/persons/:id/criminal-history
PUT    /api/records/criminal-history/:id
DELETE /api/records/criminal-history/:id
GET    /api/records/persons/:id/incidents
GET    /api/records/persons/:id/clients
GET    /api/records/clients/:clientId/persons
POST   /api/records/client-persons
DELETE /api/records/client-persons/:linkId
POST   /api/records/vehicles
GET    /api/records/vehicles/search
GET    /api/records/vehicles/:id
PUT    /api/records/vehicles/:id
DELETE /api/records/vehicles/:id
POST   /api/records/vehicles/:id/archive
POST   /api/records/vehicles/:id/unarchive
GET    /api/records/vehicles/:id/incidents
GET    /api/records/vehicles/:id/history
GET    /api/records/vehicles/export
GET    /api/records/vehicles/plate-lookup
GET    /api/records/vehicles/bolo-check
POST   /api/records/vehicles/stolen-check
GET    /api/records/vehicles/alerts/expired-registration
GET    /api/records/businesses
POST   /api/records/businesses
PUT    /api/records/businesses/:id
GET    /api/records/evidence
GET    /api/records/evidence/stats
GET    /api/records/evidence/locations
GET    /api/records/evidence/aging-report
GET    /api/records/evidence/export
GET    /api/records/evidence/:id
POST   /api/records/evidence
PUT    /api/records/evidence/:id
DELETE /api/records/evidence/:id
POST   /api/records/evidence/:id/archive
POST   /api/records/evidence/:id/unarchive
GET    /api/records/ncic-query
GET    /api/records/search
POST   /api/records/retention/enforce
GET    /api/records/retention/policy
GET    /api/records/reports/approval-queue
GET    /api/records/links
POST   /api/records/links
DELETE /api/records/links/:id
GET    /api/records/persons
GET    /api/records/vehicles
GET    /api/records/clients
```

---

### /api/nibrs

```
GET  /api/nibrs/codes
GET  /api/nibrs/codes/offenses
GET  /api/nibrs/codes/locations
GET  /api/nibrs/codes/weapons
GET  /api/nibrs/codes/biases
GET  /api/nibrs/codes/properties
GET  /api/nibrs/codes/loss-types
GET  /api/nibrs/validate/:incidentId
POST /api/nibrs/export
```

---

### /api/incidents

```
GET    /api/incidents/:id/supplements/dv
POST   /api/incidents/:id/supplements/dv
PUT    /api/incidents/:id/supplements/dv
DELETE /api/incidents/:id/supplements/dv
GET    /api/incidents/:id/supplements/pursuit
POST   /api/incidents/:id/supplements/pursuit
PUT    /api/incidents/:id/supplements/pursuit
DELETE /api/incidents/:id/supplements/pursuit
GET    /api/incidents/:id{\\d+}/offenses
POST   /api/incidents/:id{\\d+}/offenses
DELETE /api/incidents/:id{\\d+}/offenses/:oid{\\d+}
GET    /api/incidents/:id{\\d+}/officers
POST   /api/incidents/:id{\\d+}/officers
DELETE /api/incidents/:id{\\d+}/officers/:oid{\\d+}
GET    /api/incidents/:id{\\d+}/links
POST   /api/incidents/:id{\\d+}/links
DELETE /api/incidents/:id{\\d+}/links/:lid{\\d+}
GET    /api/incidents/:id{\\d+}/supplements
POST   /api/incidents/:id{\\d+}/supplements
GET    /api/incidents/:id{\\d+}/supplements/:sid{\\d+}
PUT    /api/incidents/:id{\\d+}/supplements/:sid{\\d+}
DELETE /api/incidents/:id{\\d+}/supplements/:sid{\\d+}
GET    /api/incidents/
GET    /api/incidents/:id
POST   /api/incidents/
PUT    /api/incidents/:id
PUT    /api/incidents/:id/submit
PUT    /api/incidents/:id/approve
PUT    /api/incidents/:id/return
DELETE /api/incidents/:id
```

---

### /api/cases

```
GET    /api/cases/stats
GET    /api/cases/
POST   /api/cases/
GET    /api/cases/:id
PUT    /api/cases/:id
PUT    /api/cases/:id/submit-review
PUT    /api/cases/:id/approve
PUT    /api/cases/:id/status
POST   /api/cases/:id/archive
DELETE /api/cases/:id
GET    /api/cases/:id/notes
POST   /api/cases/:id/notes
POST   /api/cases/:id/calculate-solvability
GET    /api/cases/:id/persons
POST   /api/cases/:id/persons
PUT    /api/cases/:id/persons/:personEntryId
DELETE /api/cases/:id/persons/:personEntryId
GET    /api/cases/export/csv
GET    /api/cases/:id/full
```

---

### /api/citations

```
GET    /api/citations/stats
GET    /api/citations/search
GET    /api/citations/person/:personId
GET    /api/citations/payment-summary
GET    /api/citations/
GET    /api/citations/:id
POST   /api/citations/
PUT    /api/citations/:id
DELETE /api/citations/:id
GET    /api/citations/:id/payments
POST   /api/citations/:id/payments
GET    /api/citations/:id/violations
POST   /api/citations/:id/violations
PUT    /api/citations/:id/violations/:violationId
DELETE /api/citations/:id/violations/:violationId
GET    /api/citations/export/csv
```

---

### /api/clients

```
GET    /api/clients/
GET    /api/clients/:id
POST   /api/clients/
PUT    /api/clients/:id
DELETE /api/clients/:id
```

---

### /api/connections

```
GET    /api/connections/graph
GET    /api/connections/path
GET    /api/connections/search
POST   /api/connections/investigations
GET    /api/connections/investigations
GET    /api/connections/investigations/:id
PUT    /api/connections/investigations/:id
DELETE /api/connections/investigations/:id
```

---

### /api/court

```
GET    /api/court/events
GET    /api/court/events/upcoming
GET    /api/court/calendar
GET    /api/court/statistics
GET    /api/court/compliance-rate
GET    /api/court/subpoenas/officer/:officerId
POST   /api/court/subpoenas
POST   /api/court/events/from-citation
GET    /api/court/events/:id
GET    /api/court/events/:id/conflicts
GET    /api/court/events/:id/witnesses
GET    /api/court/events/:id/linked-records
POST   /api/court/events
PUT    /api/court/events/:id
DELETE /api/court/events/:id
PUT    /api/court/events/:id/outcome
PUT    /api/court/events/:id/verdict
PUT    /api/court/events/:id/confirm
POST   /api/court/events/:id/continuance
POST   /api/court/events/:id/clone
POST   /api/court/events/:id/documents
PUT    /api/court/events/:id/witnesses
PUT    /api/court/events/:id/judge-notes
PUT    /api/court/events/:id/prosecutor
PUT    /api/court/events/:id/fees
PUT    /api/court/events/:id/bail
GET    /api/court/dashboard
GET    /api/court/appearances
GET    /api/court/discovery
```

---

### /api/crisis

```
GET    /api/crisis/incidents
POST   /api/crisis/incidents
PUT    /api/crisis/incidents/:id
DELETE /api/crisis/incidents/:id
GET    /api/crisis/stats
```

---

### /api/crm

```
GET    /api/crm/dashboard
GET    /api/crm/recent-activity
GET    /api/crm/expiring-contracts
GET    /api/crm/pipeline-summary
GET    /api/crm/revenue-forecast
GET    /api/crm/contacts
GET    /api/crm/tasks
POST   /api/crm/tasks
PUT    /api/crm/tasks/:id
DELETE /api/crm/tasks/:id
POST   /api/crm/activity
GET    /api/crm/activity/:clientId
GET    /api/crm/leads/pipeline-summary
GET    /api/crm/leads/follow-ups
GET    /api/crm/leads/source-analytics
GET    /api/crm/leads
POST   /api/crm/leads
PUT    /api/crm/leads/:id/stage
POST   /api/crm/leads/:id/convert
POST   /api/crm/leads/bulk-action
PUT    /api/crm/leads/:id
GET    /api/crm/lead-activity/:leadId
POST   /api/crm/lead-activity
GET    /api/crm/proposal-templates
GET    /api/crm/proposals
POST   /api/crm/proposals
PUT    /api/crm/proposals/:id/stage
PUT    /api/crm/proposals/:id
GET    /api/crm/proposals/:id
GET    /api/crm/reports/metrics
GET    /api/crm/reports/revenue
GET    /api/crm/reports/pipeline
GET    /api/crm/reports/retention
GET    /api/crm/reports/lead-source-roi
GET    /api/crm/firecrawl/status
GET    /api/crm/firecrawl/saved-searches
GET    /api/crm/firecrawl/search-history
GET    /api/crm/firecrawl/monitors
GET    /api/crm/firecrawl/monitors/:id/changes
POST   /api/crm/firecrawl/search
POST   /api/crm/firecrawl/scrape
POST   /api/crm/firecrawl/import
POST   /api/crm/firecrawl/import-bulk
POST   /api/crm/firecrawl/saved-searches
POST   /api/crm/firecrawl/monitors
POST   /api/crm/firecrawl/monitors/:id/check
POST   /api/crm/firecrawl/monitors/changes/:id/acknowledge
DELETE /api/crm/firecrawl/monitors/:id
GET    /api/crm/scrape-sources
GET    /api/crm/scrape-log
PUT    /api/crm/scrape-sources/:key
POST   /api/crm/scrape-sources/:key/poll-now
```

---

### /api/dl-records

```
POST   /api/dl-records/
GET    /api/dl-records/
POST   /api/dl-records/scan-relay
GET    /api/dl-records/scan-relay/poll
POST   /api/dl-records/ocr-scan         ← registered twice
POST   /api/dl-records/scan-log
GET    /api/dl-records/scan-log
GET    /api/dl-records/sources-config
PUT    /api/dl-records/sources-config
GET    /api/dl-records/sor/status
POST   /api/dl-records/sor/import
POST   /api/dl-records/sor/poll
GET    /api/dl-records/court-lookup
GET    /api/dl-records/fbi-lookup
GET    /api/dl-records/deep-sweep
GET    /api/dl-records/:id
PUT    /api/dl-records/:id
DELETE /api/dl-records/:id
POST   /api/dl-records/sync-from-persons
```

---

### /api/cloudflare

```
GET    /api/cloudflare/config
PUT    /api/cloudflare/config
GET    /api/cloudflare/status
GET    /api/cloudflare/resources
POST   /api/cloudflare/purge-cache
```

---

### /api/field-interviews

```
GET    /api/field-interviews/
GET    /api/field-interviews/stats
GET    /api/field-interviews/by-person/:personId
GET    /api/field-interviews/by-location
GET    /api/field-interviews/repeat-check
POST   /api/field-interviews/:id/archive
POST   /api/field-interviews/:id/unarchive
GET    /api/field-interviews/:id
POST   /api/field-interviews/
PUT    /api/field-interviews/:id
DELETE /api/field-interviews/:id
GET    /api/field-interviews/export/csv
```

---

### /api/fleet

```
GET    /api/fleet/
GET    /api/fleet/analytics
GET    /api/fleet/dashcam-videos
GET    /api/fleet/dashcam-videos/:id{[0-9]+}
GET    /api/fleet/dashcam-videos/:id{[0-9]+}/neighbors
POST   /api/fleet/dashcam-videos
GET    /api/fleet/dashcam-videos/:id{[0-9]+}/stream
PUT    /api/fleet/dashcam-videos/:id{[0-9]+}
DELETE /api/fleet/dashcam-videos/:id{[0-9]+}
POST   /api/fleet/dashcam-videos/:id{[0-9]+}/burn
GET    /api/fleet/dashcam-videos/:id{[0-9]+}/links
POST   /api/fleet/dashcam-videos/:id{[0-9]+}/links
DELETE /api/fleet/dashcam-videos/:id{[0-9]+}/links/:linkId{[0-9]+}
GET    /api/fleet/map
GET    /api/fleet/:id{[0-9]+}
POST   /api/fleet/
PUT    /api/fleet/:id{[0-9]+}
DELETE /api/fleet/:id{[0-9]+}
GET    /api/fleet/:id/fuel
POST   /api/fleet/:id/fuel
PUT    /api/fleet/fuel/:id
DELETE /api/fleet/fuel/:id
GET    /api/fleet/:id/maintenance
POST   /api/fleet/:id/maintenance
PUT    /api/fleet/maintenance/:id
DELETE /api/fleet/maintenance/:id
GET    /api/fleet/:id/inspections
POST   /api/fleet/:id/inspections
PUT    /api/fleet/inspections/:id
DELETE /api/fleet/inspections/:id
GET    /api/fleet/:id/assignments
PUT    /api/fleet/:id/assign
POST   /api/fleet/:id/archive
POST   /api/fleet/:id/unarchive
GET    /api/fleet/:id/personnel
POST   /api/fleet/:id/personnel-notes
DELETE /api/fleet/:id/personnel-notes/:noteId
POST   /api/fleet/pretrip
GET    /api/fleet/pretrip/:vehicleId
GET    /api/fleet/cost-per-mile/:id
GET    /api/fleet/:id{[0-9]+}/maintenance-costs
GET    /api/fleet/:id{[0-9]+}/monthly-cost-averages
GET    /api/fleet/:id{[0-9]+}/mileage-history
GET    /api/fleet/:id{[0-9]+}/fuel-efficiency
GET    /api/fleet/export/csv
GET    /api/fleet/:id/insurance
POST   /api/fleet/:id/insurance
PUT    /api/fleet/insurance/:id
DELETE /api/fleet/insurance/:id
GET    /api/fleet/:id/registration
POST   /api/fleet/:id/registration
PUT    /api/fleet/registration/:id
DELETE /api/fleet/registration/:id
GET    /api/fleet/:id/loans
POST   /api/fleet/:id/loans
PUT    /api/fleet/loans/:id
DELETE /api/fleet/loans/:id
GET    /api/fleet/:id/accessories
POST   /api/fleet/:id/accessories
PUT    /api/fleet/accessories/:id
DELETE /api/fleet/accessories/:id
GET    /api/fleet/:id/utilities
POST   /api/fleet/:id/utilities
PUT    /api/fleet/utilities/:id
DELETE /api/fleet/utilities/:id
GET    /api/fleet/:id/other-costs
POST   /api/fleet/:id/other-costs
PUT    /api/fleet/other-costs/:id
DELETE /api/fleet/other-costs/:id
GET    /api/fleet/:id/cost-budgets
PUT    /api/fleet/:id/cost-budgets
GET    /api/fleet/:id/tires
POST   /api/fleet/:id/tires
PUT    /api/fleet/tires/:id
DELETE /api/fleet/tires/:id
GET    /api/fleet/:id/damage
POST   /api/fleet/:id/damage
PUT    /api/fleet/damage/:id
GET    /api/fleet/:id/damage-reports
POST   /api/fleet/:id/damage-reports
PUT    /api/fleet/damage-reports/:id
DELETE /api/fleet/damage/:id
GET    /api/fleet/recalls
POST   /api/fleet/recalls
PUT    /api/fleet/recalls/:id
DELETE /api/fleet/recalls/:id
GET    /api/fleet/:id/recalls
POST   /api/fleet/:id/recalls
GET    /api/fleet/parts
POST   /api/fleet/parts
PUT    /api/fleet/parts/:id
DELETE /api/fleet/parts/:id
GET    /api/fleet/warranties
POST   /api/fleet/warranties
PUT    /api/fleet/warranties/:id
DELETE /api/fleet/warranties/:id
GET    /api/fleet/keys
POST   /api/fleet/keys
PUT    /api/fleet/keys/:id/checkout
PUT    /api/fleet/keys/:id/return
GET    /api/fleet/keys/:id/log
GET    /api/fleet/accidents
POST   /api/fleet/accidents
PUT    /api/fleet/accidents/:id
GET    /api/fleet/service-providers
POST   /api/fleet/service-providers
PUT    /api/fleet/service-providers/:id
DELETE /api/fleet/service-providers/:id
GET    /api/fleet/fuel-cards
POST   /api/fleet/fuel-cards
PUT    /api/fleet/fuel-cards/:id
DELETE /api/fleet/fuel-cards/:id
GET    /api/fleet/budgets
POST   /api/fleet/budgets
PUT    /api/fleet/budgets/:id
DELETE /api/fleet/budgets/:id
GET    /api/fleet/depreciation
POST   /api/fleet/depreciation
GET    /api/fleet/replacement-plan
POST   /api/fleet/replacement-plan
PUT    /api/fleet/replacement-plan/:id
GET    /api/fleet/utilization
GET    /api/fleet/emissions
GET    /api/fleet/fleet-lifecycle
GET    /api/fleet/service-alerts
GET    /api/fleet/overdue-inspections
GET    /api/fleet/inspection-stats
GET    /api/fleet/cost-trends
GET    /api/fleet/driver-performance
GET    /api/fleet/health-scores
GET    /api/fleet/maintenance-schedule
GET    /api/fleet/vehicle-comparison
GET    /api/fleet/vehicle-lifecycle
GET    /api/fleet/dash-cameras
GET    /api/fleet/notifications
GET    /api/fleet/fleet-cost-analytics
GET    /api/fleet/fuel/analytics/by-card
GET    /api/fleet/fuel/analytics/overview
GET    /api/fleet/fuel/analytics/by-officer
POST   /api/fleet/fuel/import/preview
POST   /api/fleet/fuel/import/commit
GET    /api/fleet/scorecard
GET    /api/fleet/fuel/anomalies
GET    /api/fleet/fuel/vendors
POST   /api/fleet/fuel/vendors
GET    /api/fleet/fuel/efficiency-trend
GET    /api/fleet/fuel/bulk-deliveries
GET    /api/fleet/fuel/reconciliation
POST   /api/fleet/fuel/reconciliation
GET    /api/fleet/fuel/forecast
GET    /api/fleet/fuel/idle-estimation
GET    /api/fleet/fuel/alt-fuel
POST   /api/fleet/fuel/alt-fuel
GET    /api/fleet/fuel/tank-capacity
GET    /api/fleet/fuel/card-audit
GET    /api/fleet/fuel/budget-vs-actual
GET    /api/fleet/fuel/cost-per-mile-ranking
GET    /api/fleet/fuel/leaderboard
GET    /api/fleet/fuel/seasonal
GET    /api/fleet/fuel/pending-approvals
GET    /api/fleet/maintenance/predictive
GET    /api/fleet/maintenance/vendor-ratings
POST   /api/fleet/maintenance/vendor-ratings
GET    /api/fleet/maintenance/tsbs
POST   /api/fleet/maintenance/tsbs
PUT    /api/fleet/maintenance/tsbs/:id/complete
GET    /api/fleet/warranty-claims
POST   /api/fleet/warranty-claims
PUT    /api/fleet/warranty-claims/:id/approve
GET    /api/fleet/service-contracts
POST   /api/fleet/service-contracts
GET    /api/fleet/maintenance/sla
GET    /api/fleet/maintenance/:id/parts
POST   /api/fleet/maintenance/:id/parts
GET    /api/fleet/maintenance/forecast
GET    /api/fleet/maintenance/templates
GET    /api/fleet/maintenance/pending-approvals
GET    /api/fleet/maintenance/emergency-repairs
GET    /api/fleet/roadside-assistance
POST   /api/fleet/roadside-assistance
GET    /api/fleet/maintenance/quality-checks
GET    /api/fleet/maintenance/tools
GET    /api/fleet/maintenance/bay-schedule
POST   /api/fleet/maintenance/bay-schedule
GET    /api/fleet/lifecycle/trade-in-value/:id
POST   /api/fleet/lifecycle/trade-in-value
GET    /api/fleet/lifecycle/disposals
POST   /api/fleet/lifecycle/disposals
GET    /api/fleet/lifecycle/leases
POST   /api/fleet/lifecycle/leases
POST   /api/fleet/lifecycle/lease-vs-buy
GET    /api/fleet/lifecycle/retirement-planning
GET    /api/fleet/lifecycle/mileage-stages
GET    /api/fleet/lifecycle/condition-scores/:id
POST   /api/fleet/lifecycle/condition-scores
GET    /api/fleet/lifecycle/history/:id
GET    /api/fleet/lifecycle/purchase-orders
POST   /api/fleet/lifecycle/purchase-orders
GET    /api/fleet/lifecycle/delivery-checklists
POST   /api/fleet/lifecycle/delivery-checklists
GET    /api/fleet/compliance/fmcsa
POST   /api/fleet/compliance/fmcsa
GET    /api/fleet/compliance/dot-inspections
GET    /api/fleet/compliance/ifta
POST   /api/fleet/compliance/ifta
GET    /api/fleet/compliance/emissions
POST   /api/fleet/compliance/safety-recalls/:id/complete
GET    /api/fleet/compliance/accident-analysis
GET    /api/fleet/compliance/safety-ratings
GET    /api/fleet/compliance/defects
POST   /api/fleet/compliance/defects
PUT    /api/fleet/compliance/defects/:id/resolve
GET    /api/fleet/compliance/safety-equipment
POST   /api/fleet/compliance/safety-equipment
PUT    /api/fleet/compliance/safety-equipment/:id/inspect
GET    /api/fleet/compliance/load-compliance
POST   /api/fleet/compliance/load-compliance
GET    /api/fleet/compliance/dvir-summary
GET    /api/fleet/compliance/stats
GET    /api/fleet/financial/cost-centers
POST   /api/fleet/financial/cost-centers
GET    /api/fleet/financial/cost-allocations
POST   /api/fleet/financial/cost-allocations
GET    /api/fleet/financial/chargeback
GET    /api/fleet/financial/grants
POST   /api/fleet/financial/grants
POST   /api/fleet/financial/grants/:id/allocate
GET    /api/fleet/financial/capital-assets
POST   /api/fleet/financial/capital-assets
GET    /api/fleet/financial/budget-forecast
GET    /api/fleet/financial/multi-year-plan
GET    /api/fleet/financial/cpm-trend
POST   /api/fleet/financial/roi-calculator
GET    /api/fleet/financial/insurance-claims
POST   /api/fleet/financial/depreciation-comparison
GET    /api/fleet/financial/tco-by-class
GET    /api/fleet/financial/benchmarking
GET    /api/fleet/financial/tax-depreciation/:id
GET    /api/fleet/financial/asset-register
POST   /api/fleet/financial/asset-register
GET    /api/fleet/financial/audit-trail
GET    /api/fleet/operations/pool-reservations
POST   /api/fleet/operations/pool-reservations
PUT    /api/fleet/operations/pool-reservations/:id/checkout
PUT    /api/fleet/operations/pool-reservations/:id/checkin
GET    /api/fleet/operations/pool-status
GET    /api/fleet/operations/transfers
POST   /api/fleet/operations/transfers
GET    /api/fleet/operations/seasonal-rotation
GET    /api/fleet/operations/event-allocation
GET    /api/fleet/operations/readiness
GET    /api/fleet/operations/deployment-plan
GET    /api/fleet/operations/shortage-analysis
GET    /api/fleet/operations/demand-forecast
GET    /api/fleet/operations/assignment-optimization
GET    /api/fleet/operations/shared-vehicles
GET    /api/fleet/operations/decals
POST   /api/fleet/operations/decals
GET    /api/fleet/operations/upfits
POST   /api/fleet/operations/upfits
GET    /api/fleet/operations/detailing-log
POST   /api/fleet/operations/detailing-log
GET    /api/fleet/analytics/kpi-dashboard
GET    /api/fleet/analytics/trend-forecast
GET    /api/fleet/analytics/anomalies
GET    /api/fleet/analytics/peer-comparison
GET    /api/fleet/analytics/aging-report
GET    /api/fleet/analytics/replacement-priority
GET    /api/fleet/analytics/efficiency-score
GET    /api/fleet/analytics/carbon-footprint
GET    /api/fleet/analytics/recommendations
GET    /api/fleet/analytics/custom-metrics
POST   /api/fleet/analytics/custom-metrics
POST   /api/fleet/analytics/custom-metrics/:id/values
GET    /api/fleet/data/import-template
POST   /api/fleet/data/reconcile-fuel-card
GET    /api/fleet/data/dmv-renewals
GET    /api/fleet/data/emissions-tests
GET    /api/fleet/data/export
GET    /api/fleet/drivers/certifications
POST   /api/fleet/drivers/certifications
GET    /api/fleet/drivers/incidents
POST   /api/fleet/drivers/incidents
GET    /api/fleet/drivers/training
POST   /api/fleet/drivers/training
GET    /api/fleet/drivers/feedback
POST   /api/fleet/drivers/feedback
GET    /api/fleet/drivers/performance-score/:userId
GET    /api/fleet/drivers/expiring-certs
GET    /api/fleet/drivers/vehicle-familiarity/:userId
GET    /api/fleet/drivers/assignments/:userId
GET    /api/fleet/drivers/dashboard
GET    /api/fleet/drivers/comparison
GET    /api/fleet/drivers/mentoring
GET    /api/fleet/equipment/calibrations
POST   /api/fleet/equipment/calibrations
GET    /api/fleet/equipment/inventory-category
GET    /api/fleet/equipment/dashboard
POST   /api/fleet/equipment/transfer
GET    /api/fleet/equipment/expiring-warranties
GET    /api/fleet/equipment/by-vehicle/:vehicleId
GET    /api/fleet/equipment/cost-analysis
GET    /api/fleet/reports/executive-summary
GET    /api/fleet/reports/monthly-status
GET    /api/fleet/reports/year-over-year
GET    /api/fleet/reports/downtime-analysis
GET    /api/fleet/reports/fleet-availability
GET    /api/fleet/reports/vendor-scorecard
GET    /api/fleet/reports/sustainability
GET    /api/fleet/reports/annual-review
GET    /api/fleet/reports/geographic-distribution
GET    /api/fleet/scheduling/maintenance-calendar
GET    /api/fleet/scheduling/preventive-timeline
GET    /api/fleet/scheduling/upcoming-events
GET    /api/fleet/scheduling/rotation-plan
GET    /api/fleet/scheduling/backlog
GET    /api/fleet/scheduling/parts-forecast
GET    /api/fleet/scheduling/special-event-plan
GET    /api/fleet/risk/vehicle-assessment/:id
GET    /api/fleet/risk/high-risk-vehicles
GET    /api/fleet/risk/insurance-optimization
GET    /api/fleet/risk/incident-root-cause
GET    /api/fleet/risk/safety-audit-schedule
GET    /api/fleet/risk/pursuit-vehicles
GET    /api/fleet/risk/continuity-plan
POST   /api/fleet/risk/theft-report
GET    /api/fleet/risk/theft-reports
PUT    /api/fleet/risk/theft-reports/:id/recover
GET    /api/fleet/procurement/specs
POST   /api/fleet/procurement/specs
GET    /api/fleet/procurement/orders
POST   /api/fleet/procurement/orders
GET    /api/fleet/procurement/orders/:id/bids
POST   /api/fleet/procurement/orders/:id/bids
PUT    /api/fleet/procurement/bids/:id/select
GET    /api/fleet/procurement/acquisition-cost-analysis
GET    /api/fleet/procurement/standardization
GET    /api/fleet/procurement/delivery-timeline
GET    /api/fleet/decommissioning/checklist/:vehicleId
POST   /api/fleet/decommissioning/start
PUT    /api/fleet/decommissioning/:id/step
PUT    /api/fleet/decommissioning/:id/complete
GET    /api/fleet/decommissioning/active
GET    /api/fleet/decommissioning/salvage-summary
GET    /api/fleet/decommissioning/disposal-methods
GET    /api/fleet/decommissioning/reduction-analysis
GET    /api/fleet/decommissioning/history
GET    /api/fleet/decommissioning/stats
GET    /api/fleet/daily-gps-mileage
GET    /api/fleet/:id/gps-mileage
PUT    /api/fleet/:id/gps-mileage
GET    /api/fleet/combined-cost-trend
GET    /api/fleet/monthly-spend
GET    /api/fleet/maintenance
GET    /api/fleet/inspections
GET    /api/fleet/fuel-logs
GET    /api/fleet/assignments
GET    /api/fleet/:id/call-history
GET    /api/fleet/:id/readiness
```

---

### /api/forensics (also aliased at /api/forensic-lab)

```
GET    /api/forensics/stats
GET    /api/forensics/
GET    /api/forensics/:id
POST   /api/forensics/
PUT    /api/forensics/:id
DELETE /api/forensics/:id
GET    /api/forensics/:caseId/exhibits
POST   /api/forensics/:caseId/exhibits
PUT    /api/forensics/:caseId/exhibits/:exhibitId
DELETE /api/forensics/:caseId/exhibits/:exhibitId
POST   /api/forensics/:caseId/exhibits/:exhibitId/custody
GET    /api/forensics/:caseId/analyses
POST   /api/forensics/:caseId/analyses
PUT    /api/forensics/:caseId/analyses/:analysisId
DELETE /api/forensics/:caseId/analyses/:analysisId
GET    /api/forensics/:caseId/activity
GET    /api/forensics/:caseId/exhibits/:exhibitId/custody-audit
GET    /api/forensics/export/csv
GET    /api/forensics/turnaround-times
GET    /api/forensics/metrics/backlog
GET    /api/forensics/:id/qc-history
GET    /api/forensics/analysis-templates
POST   /api/forensics/:id/qc-check
GET    /api/forensics/queue/priority
GET    /api/forensics/templates/report
GET    /api/forensics/capacity/planning
```

(Same routes duplicated at `/api/forensic-lab/*`)

---

### /api/gang-intel

```
GET    /api/gang-intel/
POST   /api/gang-intel/
PUT    /api/gang-intel/:id
DELETE /api/gang-intel/:id
GET    /api/gang-intel/gangs
POST   /api/gang-intel/gangs
PUT    /api/gang-intel/gangs/:id
DELETE /api/gang-intel/gangs/:id
GET    /api/gang-intel/graffiti
GET    /api/gang-intel/stats
```

---

### /api/hr

```
GET    /api/hr/dashboard
GET    /api/hr/benefits
GET    /api/hr/leave
GET    /api/hr/leave/export/csv
GET    /api/hr/disciplinary/export/csv
GET    /api/hr/reviews/export/csv
GET    /api/hr/leave/balances
POST   /api/hr/leave
PUT    /api/hr/leave/:id
DELETE /api/hr/leave/:id
POST   /api/hr/leave/:id/approve
POST   /api/hr/leave/:id/deny
GET    /api/hr/disciplinary
GET    /api/hr/disciplinary/:officerId/timeline
POST   /api/hr/disciplinary
PUT    /api/hr/disciplinary/:id
DELETE /api/hr/disciplinary/:id
GET    /api/hr/reviews
GET    /api/hr/reviews/:id
POST   /api/hr/reviews
PUT    /api/hr/reviews/:id
DELETE /api/hr/reviews/:id
POST   /api/hr/reviews/:id/acknowledge
```

---

### /api/iped

```
GET    /api/iped/status
PUT    /api/iped/config
DELETE /api/iped/config
POST   /api/iped/validate
POST   /api/iped/test-api
DELETE /api/iped/hash-sets/:name
GET    /api/iped/hash-sets
GET    /api/iped/hash-sets/:id
GET    /api/iped/downloads
GET    /api/iped/jobs
```

---

### /api/narcotics

```
GET    /api/narcotics/cases
POST   /api/narcotics/cases
PUT    /api/narcotics/cases/:id
DELETE /api/narcotics/cases/:id
GET    /api/narcotics/stats
```

---

### /api/nav

```
GET  /api/nav/trip/current
POST /api/nav/trip/start
PUT  /api/nav/trip/:id/confirm
PUT  /api/nav/trip/:id/update
PUT  /api/nav/trip/:id/end
PUT  /api/nav/trip/:id/cancel
GET  /api/nav/trip/history
GET  /api/nav/trip/:id
GET  /api/nav/trip/check-take-home
GET  /api/nav/vehicle-take-home
```

---

### /api/offline

```
GET  /api/offline/my-secret
GET  /api/offline/secrets
POST /api/offline/sync/pull
POST /api/offline/sync/push
```

---

### /api/patrol

```
GET    /api/patrol/checkpoints/map
GET    /api/patrol/checkpoints/property/:propertyId
GET    /api/patrol/checkpoints/:id/instructions
GET    /api/patrol/checkpoints
POST   /api/patrol/checkpoints
PUT    /api/patrol/checkpoints/:id
DELETE /api/patrol/checkpoints/:id
POST   /api/patrol/checkpoints/:id/archive
POST   /api/patrol/checkpoints/:id/unarchive
POST   /api/patrol/scan
GET    /api/patrol/scans
GET    /api/patrol/scans/export
GET    /api/patrol/compliance
GET    /api/patrol/exceptions
GET    /api/patrol/shift-summary
POST   /api/patrol/breaks/start
POST   /api/patrol/breaks/end
GET    /api/patrol/breaks
POST   /api/patrol/verify-tour
GET    /api/patrol/verifications
GET    /api/patrol/log/generate
GET    /api/patrol/optimize-route
GET    /api/patrol/time-tracking
GET    /api/patrol/coverage-heatmap
GET    /api/patrol/efficiency
GET    /api/patrol/mileage/suggest
GET    /api/patrol/mileage/chain
GET    /api/patrol/mileage/audit
GET    /api/patrol/mileage/fix-suggestions
POST   /api/patrol/mileage/fix
GET    /api/patrol/trip-log/generate
GET    /api/patrol/trips
POST   /api/patrol/trips
PUT    /api/patrol/trips/:source/:id
DELETE /api/patrol/trips/:source/:id
```

---

### /api/radio

```
GET    /api/radio/channels
POST   /api/radio/channels
PATCH  /api/radio/channels/:id
DELETE /api/radio/channels/:id
GET    /api/radio/transmissions
POST   /api/radio/transmissions
DELETE /api/radio/transmissions/:id
GET    /api/radio/transmissions/:id/audio
GET    /api/radio/recordings
POST   /api/radio/recordings
PATCH  /api/radio/recordings/:id
DELETE /api/radio/recordings/:id
GET    /api/radio/stats
POST   /api/radio/dispatcher/ocr
GET    /api/radio/settings
PUT    /api/radio/settings
POST   /api/radio/ai/incident-narrative
GET    /api/radio/ai/shift-summary
```

---

### /api/recruitment

```
GET    /api/recruitment/candidates
POST   /api/recruitment/candidates
PUT    /api/recruitment/candidates/:id
DELETE /api/recruitment/candidates/:id
GET    /api/recruitment/stats
```

---

### /api/serve (also aliased at /api/process-server)

```
GET    /api/serve/linked-statuses
GET    /api/serve/stats/summary
GET    /api/serve/routes/:date
POST   /api/serve/routes
PUT    /api/serve/reorder
GET    /api/serve/priority-queue
GET    /api/serve/deadlines
GET    /api/serve/success-rates
GET    /api/serve/export/csv
GET    /api/serve/
POST   /api/serve/
GET    /api/serve/:id
PUT    /api/serve/:id
POST   /api/serve/:id/attempt
POST   /api/serve/:id/substitute-service
GET    /api/serve/:id/gps-trail
```

(Same routes duplicated at `/api/process-server/*`)

---

### /api/special-ops

```
GET    /api/special-ops/callouts
POST   /api/special-ops/callouts
PUT    /api/special-ops/callouts/:id
DELETE /api/special-ops/callouts/:id
GET    /api/special-ops/equipment
POST   /api/special-ops/equipment
PUT    /api/special-ops/equipment/:id
DELETE /api/special-ops/equipment/:id
GET    /api/special-ops/stats
```

---

### /api/settings

```
GET  /api/settings/
PUT  /api/settings/user
PUT  /api/settings/org
```

---

### /api/statutes

```
GET  /api/statutes/
GET  /api/statutes/search
GET  /api/statutes/toc
GET  /api/statutes/chapter
GET  /api/statutes/section/:citation
```

---

### /api/serve-intake

```
POST /api/serve-intake/scan-document
POST /api/serve-intake/upload
POST /api/serve-intake/intake
GET  /api/serve-intake/:id/documents
GET  /api/serve-intake/documents/:docId/file
GET  /api/serve-intake/stats
GET  /api/serve-intake/
GET  /api/serve-intake/:id
POST /api/serve-intake/
PUT  /api/serve-intake/:id
DELETE /api/serve-intake/:id
GET  /api/serve-intake/:id/attempts
POST /api/serve-intake/:id/attempts
POST /api/serve-intake/:id/skip-trace
GET  /api/serve-intake/routes
POST /api/serve-intake/routes
GET  /api/serve-intake/export.csv
```

---

### /api/ocr

```
POST /api/ocr/scan-document
```

---

### /api/skiptracer

```
GET  /api/skiptracer/status
GET  /api/skiptracer/stats
GET  /api/skiptracer/dossiers
GET  /api/skiptracer/dossiers/:id
```

---

### /api/trespass-orders

```
GET  /api/trespass-orders/check
GET  /api/trespass-orders/
```

---

### /api/victim-services

```
GET    /api/victim-services/victims
POST   /api/victim-services/victims
PUT    /api/victim-services/victims/:id
DELETE /api/victim-services/victims/:id
GET    /api/victim-services/stats
```

---

### /api/affairs

```
GET    /api/affairs/complaints
GET    /api/affairs/complaints/:id
POST   /api/affairs/complaints
PUT    /api/affairs/complaints/:id
DELETE /api/affairs/complaints/:id
GET    /api/affairs/complaints/:id/investigations
POST   /api/affairs/complaints/:id/investigations
PUT    /api/affairs/complaints/:id/investigations/:invId
GET    /api/affairs/flags
POST   /api/affairs/flags
PUT    /api/affairs/flags/:id
GET    /api/affairs/stats
```

---

### /api/alarms

```
GET    /api/alarms/accounts
POST   /api/alarms/accounts
PUT    /api/alarms/accounts/:id
DELETE /api/alarms/accounts/:id
GET    /api/alarms/stats
```

---

### /api/accreditation

```
GET    /api/accreditation/standards
POST   /api/accreditation/standards
PUT    /api/accreditation/standards/:id
DELETE /api/accreditation/standards/:id
GET    /api/accreditation/stats
```

---

### /api/alerts

```
GET    /api/alerts/templates
POST   /api/alerts/templates
PUT    /api/alerts/templates/:id
DELETE /api/alerts/templates/:id
GET    /api/alerts/batches
POST   /api/alerts/batches
PUT    /api/alerts/batches/:id
GET    /api/alerts/batches/:id/recipients
POST   /api/alerts/batches/:id/recipients
PUT    /api/alerts/batches/:id/send
GET    /api/alerts/stats
```

---

### /api/arrests

```
POST   /api/arrests/manual
GET    /api/arrests/manual/:id
PUT    /api/arrests/manual/:id
DELETE /api/arrests/manual/:id
GET    /api/arrests/recent
GET    /api/arrests/search
GET    /api/arrests/:id/cross-links
PUT    /api/arrests/:id/link-person
DELETE /api/arrests/:id/link-person
GET    /api/arrests/export/csv
GET    /api/arrests/manual/:id/checklist
PUT    /api/arrests/manual/:id/checklist
GET    /api/arrests/manual/:id/property
POST   /api/arrests/manual/:id/property
DELETE /api/arrests/manual/:id/property/:itemId
GET    /api/arrests/manual/:id/miranda
POST   /api/arrests/manual/:id/miranda
```

---

### /api/assets

```
GET    /api/assets/inventory
POST   /api/assets/inventory
PUT    /api/assets/inventory/:id
DELETE /api/assets/inventory/:id
GET    /api/assets/checkouts
POST   /api/assets/checkouts
PUT    /api/assets/checkouts/:id/return
GET    /api/assets/weapons
POST   /api/assets/weapons
GET    /api/assets/ammunition
POST   /api/assets/ammunition
PUT    /api/assets/ammunition/:id/issue
GET    /api/assets/k9
POST   /api/assets/k9
GET    /api/assets/stats
```

---

### /api/audit

```
GET    /api/audit/logs
GET    /api/audit/stats
GET    /api/audit/export
POST   /api/audit/retention/enforce
GET    /api/audit/retention/policy
PUT    /api/audit/retention/policy
GET    /api/audit/action-types
GET    /api/audit/summary
GET    /api/audit/entity/:entityType/:entityId
POST   /api/audit/compress
GET    /api/audit/index-stats
GET    /api/audit/compliance-report
```

---

### /api/billing

```
GET    /api/billing/contracts
POST   /api/billing/contracts
GET    /api/billing/invoices
POST   /api/billing/invoices
PUT    /api/billing/invoices/:id
DELETE /api/billing/invoices/:id
GET    /api/billing/invoices/:id/items
POST   /api/billing/invoices/:id/items
DELETE /api/billing/invoices/:id/items/:itemId
GET    /api/billing/payments
POST   /api/billing/payments
GET    /api/billing/expenses
POST   /api/billing/expenses
PUT    /api/billing/expenses/:id
GET    /api/billing/stats
```

---

### /api/invoices

```
GET  /api/invoices/stats
GET  /api/invoices/
```

---

### /api/use-of-force

```
GET  /api/use-of-force/
GET  /api/use-of-force/stats
POST /api/use-of-force/
PUT  /api/use-of-force/:id/review
```

---

### /api/community

```
GET    /api/community/events
POST   /api/community/events
PUT    /api/community/events/:id
DELETE /api/community/events/:id
GET    /api/community/tips
POST   /api/community/tips
PUT    /api/community/tips/:id
GET    /api/community/watch-groups
POST   /api/community/watch-groups
GET    /api/community/alerts
POST   /api/community/alerts
GET    /api/community/stats
```

---

### /api/intel

```
GET    /api/intel/search
GET    /api/intel/health
POST   /api/intel/reindex
GET    /api/intel/watchlist
POST   /api/intel/watchlist
DELETE /api/intel/watchlist/:entityType/:entityId
POST   /api/intel/screen
GET    /api/intel/suggestions
POST   /api/intel/suggestions/:id/confirm
POST   /api/intel/suggestions/:id/reject
POST   /api/intel/extract/run
POST   /api/intel/sightings
GET    /api/intel/sightings
POST   /api/intel/quick-capture
POST   /api/intel/recordings/start
PUT    /api/intel/recordings/:id/chunk
POST   /api/intel/recordings/:id/stop
GET    /api/intel/recordings
GET    /api/intel/recordings/:id/chunk/:seq
GET    /api/intel/jail/sources
POST   /api/intel/jail/scan
POST   /api/intel/jail/ingest
GET    /api/intel/jail/bookings
GET    /api/intel/dossier/person/:id
GET    /api/intel/resolution/suggestions
POST   /api/intel/resolution/suggestions/:id/confirm
POST   /api/intel/resolution/suggestions/:id/reject
DELETE /api/intel/resolution/canonical/:personId
```

---

### /api/interagency

```
GET    /api/interagency/partners
POST   /api/interagency/partners
PUT    /api/interagency/partners/:id
DELETE /api/interagency/partners/:id
GET    /api/interagency/agreements
POST   /api/interagency/agreements
PUT    /api/interagency/agreements/:id
GET    /api/interagency/exchanges
POST   /api/interagency/exchanges
GET    /api/interagency/stats
```

---

### /api/jail

```
GET    /api/jail/inmates
GET    /api/jail/inmates/:id
POST   /api/jail/inmates
PUT    /api/jail/inmates/:id
DELETE /api/jail/inmates/:id
GET    /api/jail/inmates/:id/charges
POST   /api/jail/inmates/:id/charges
DELETE /api/jail/inmates/:id/charges/:chargeId
GET    /api/jail/inmates/:id/visitors
POST   /api/jail/inmates/:id/visitors
GET    /api/jail/inmates/:id/property
POST   /api/jail/inmates/:id/property
GET    /api/jail/inmates/:id/medical
POST   /api/jail/inmates/:id/medical
GET    /api/jail/inmates/:id/disciplinary
POST   /api/jail/inmates/:id/disciplinary
GET    /api/jail/inmates/:id/transports
POST   /api/jail/inmates/:id/transports
PUT    /api/jail/inmates/:id/transports/:transportId
GET    /api/jail/stats
```

---

### /api/knowledge-base

```
GET  /api/knowledge-base/search
```

---

### /api/qa

```
GET    /api/qa/reviews
POST   /api/qa/reviews
PUT    /api/qa/reviews/:id
DELETE /api/qa/reviews/:id
GET    /api/qa/criteria
POST   /api/qa/criteria
GET    /api/qa/reviews/:id/scores
POST   /api/qa/reviews/:id/scores
GET    /api/qa/surveys
POST   /api/qa/surveys
GET    /api/qa/stats
```

---

### /api/risk

```
GET    /api/risk/assessments
POST   /api/risk/assessments
PUT    /api/risk/assessments/:id
DELETE /api/risk/assessments/:id
GET    /api/risk/inspections
POST   /api/risk/inspections
PUT    /api/risk/inspections/:id
GET    /api/risk/claims
POST   /api/risk/claims
PUT    /api/risk/claims/:id
GET    /api/risk/stats
```

---

### /api/tasks

```
GET    /api/tasks/
GET    /api/tasks/stats
GET    /api/tasks/:id
POST   /api/tasks/
PUT    /api/tasks/:id
DELETE /api/tasks/:id
GET    /api/tasks/:id/comments
POST   /api/tasks/:id/comments
```

---

### /api/training

```
GET    /api/training/courses
POST   /api/training/courses
PUT    /api/training/courses/:id
DELETE /api/training/courses/:id
GET    /api/training/enrollments
POST   /api/training/enrollments
PUT    /api/training/enrollments/:id
GET    /api/training/cert-types
POST   /api/training/cert-types
GET    /api/training/certs
POST   /api/training/certs
GET    /api/training/firearms
POST   /api/training/firearms
GET    /api/training/stats
```

---

### /api/documents

```
GET    /api/documents/folders
POST   /api/documents/folders
PUT    /api/documents/folders/:id
DELETE /api/documents/folders/:id
POST   /api/documents/folders/:id/move-file
```

---

### /api/pdf-tools

```
GET  /api/pdf-tools/health
POST /api/pdf-tools/encrypt
POST /api/pdf-tools/sign-payload
```

---

### /api/document-intake

```
GET  /api/document-intake/health
POST /api/document-intake/extract-text
POST /api/document-intake/extract
```

---

### /api/tts

```
POST /api/tts/
```

---

### /api/business-vehicles

```
GET    /api/business-vehicles/:businessId
POST   /api/business-vehicles/
DELETE /api/business-vehicles/:linkId
```

---

### /api/business-visits

```
GET  /api/business-visits/:businessId
POST /api/business-visits/
```

---

### /api/business-photos

```
GET    /api/business-photos/file/:key{.+}
GET    /api/business-photos/:businessId
POST   /api/business-photos/
DELETE /api/business-photos/:photoId
```

---

### /api/field-photos

```
POST   /api/field-photos/
GET    /api/field-photos/
GET    /api/field-photos/file/*
DELETE /api/field-photos/:id
```

---

### /api/howen

```
GET  /api/howen/status
GET  /api/howen/devices
GET  /api/howen/devices/:id
GET  /api/howen/events
```

---

### /api/offender-registry (also aliased at /api/sex-offender-registry)

```
GET    /api/offender-registry/
POST   /api/offender-registry/
PUT    /api/offender-registry/:id/clear
GET    /api/offender-registry/:id/risk-score
GET    /api/offender-registry/:id/contacts
POST   /api/offender-registry/:id/contact
GET    /api/offender-registry/export/csv
GET    /api/offender-registry/stats
```

(Same duplicated at `/api/sex-offender-registry/*`)

---

### /api/uploads

```
GET    /api/uploads/entity/:type/:id
GET    /api/uploads/sign/:fileId
GET    /api/uploads/:fileId/thumbnail
GET    /api/uploads/:fileId/download
GET    /api/uploads/:fileId
POST   /api/uploads/
PUT    /api/uploads/:fileId/link
DELETE /api/uploads/:fileId
```

---

### /api/company-documents

```
GET    /api/company-documents/
GET    /api/company-documents/export/csv
GET    /api/company-documents/:id
POST   /api/company-documents/
PUT    /api/company-documents/:id
DELETE /api/company-documents/:id
```

---

### /api (shiftPlans — mounted at /api bare prefix)

```
GET    /api/shift-plans/coverage/:date
GET    /api/shift-plans/conflicts/:date
POST   /api/shift-plans/bulk-activate
GET    /api/shift-plans/export/csv
POST   /api/shift-plans/:id/activate
GET    /api/shift-plans
GET    /api/shift-plans/:id
POST   /api/shift-plans
PUT    /api/shift-plans/:id
DELETE /api/shift-plans/:id
GET    /api/shift-swaps
GET    /api/admin/shift-swaps
POST   /api/shift-swaps
PUT    /api/shift-swaps/:id
GET    /api/shift-overtime
GET    /api/staffing-levels
GET    /api/shift-notifications
```

---

### /api (downloads — mounted at /api bare prefix)

```
GET  /api/downloads/info
GET  /api/downloads/check
```

---

### /api/warrants

```
GET    /api/warrants/watch/runs
POST   /api/warrants/watch/scan
GET    /api/warrants/utah
POST   /api/warrants/search-all
GET    /api/warrants/person/:id/profile
GET    /api/warrants/utah-search/auto-poll-status
GET    /api/warrants/dashboard/stats
GET    /api/warrants/dashboard/feed
GET    /api/warrants/dashboard/priority
GET    /api/warrants/expiring
GET    /api/warrants/scrapers
GET    /api/warrants/scrapers/health
POST   /api/warrants/scrapers/:source_key/trigger
POST   /api/warrants/scrapers/:source_key/reset-circuit
GET    /api/warrants/check/:personId{\\d+}
GET    /api/warrants/
POST   /api/warrants/
GET    /api/warrants/:id{\\d+}
PUT    /api/warrants/:id{\\d+}
PUT    /api/warrants/:id{\\d+}/serve
POST   /api/warrants/:id{\\d+}/archive
POST   /api/warrants/:id{\\d+}/unarchive
DELETE /api/warrants/:id{\\d+}
POST   /api/warrants/ingest-utah
```

---

### /api/notifications (notificationsInbox)

```
GET    /api/notifications/unread-count
GET    /api/notifications/
GET    /api/notifications/stats
GET    /api/notifications/categories
GET    /api/notifications/preferences
PUT    /api/notifications/preferences
PUT    /api/notifications/:id/read
POST   /api/notifications/mark-all-read
DELETE /api/notifications/:id
POST   /api/notifications/delete-read
POST   /api/notifications/cleanup
PUT    /api/notifications/:id/snooze
POST   /api/notifications/escalate
GET    /api/notifications/snoozed-due
POST   /api/notifications/admin/broadcast
```

---

### /api/reports

```
GET  /api/reports/incidents-summary
GET  /api/reports/crime-trends
GET  /api/reports/beat-activity
GET  /api/reports/citation-revenue
GET  /api/reports/schedules
GET  /api/reports/templates
GET  /api/reports/statute-analytics
GET  /api/reports/response-times
GET  /api/reports/officer-activity
GET  /api/reports/command-center
GET  /api/reports/shift-activity/:officerId
GET  /api/reports/dashboard
GET  /api/reports/crime-analysis
GET  /api/reports/crime-analysis/export
```

---

### /api/comms/bolos (bolos router re-mounted)

```
GET    /api/comms/bolos/
GET    /api/comms/bolos/active
GET    /api/comms/bolos/check
GET    /api/comms/bolos/stats
GET    /api/comms/bolos/:id
POST   /api/comms/bolos/
PUT    /api/comms/bolos/:id
DELETE /api/comms/bolos/:id
POST   /api/comms/bolos/:id/archive
POST   /api/comms/bolos/:id/unarchive
POST   /api/comms/bolos/expire-check
POST   /api/comms/bolos/auto-archive
```

---

### /api/comms (stubs), /api/stats (stubs), /api/user (stubs), /api/dispatch/stats (stubs), /api/cfs (stubs), /api/dar (stubs), /api/clearpathgps (stubs), /api/servemanager (stubs), /api/skiptracer-v2 (stubs), /api/firecrawl-tools (stubs), /api/pdf-artifacts (stubs), /api/pdf-engine (stubs), /api/voice-persona (stubs), /api/diagnostics (stubs), /api/mobile (stubs), /api/updates (stubs)

All stubs serve the same handler set at their respective prefixes:

```
GET    <prefix>/preferences
PUT    <prefix>/preferences
POST   <prefix>/preferences/reset
GET    <prefix>/unread-count
GET    <prefix>/notifications
GET    <prefix>/activity-feed
GET    <prefix>/bolos/active
GET    <prefix>/bolos/check
GET    <prefix>/bolos/stats
GET    <prefix>/drafts
POST   <prefix>/emergency-broadcast
GET    <prefix>/messages/priority-stats
GET    <prefix>/dashboard
GET    <prefix>/current
GET    <prefix>/google-maps/client-key
GET    <prefix>/
GET    <prefix>/status
GET    <prefix>/sources
GET    <prefix>/vehicles
GET    <prefix>/devices
GET    <prefix>/jobs
GET    <prefix>/config
GET    <prefix>/mappings
GET    <prefix>/dashcam-events
GET    <prefix>/dashcam-events/by-officer/:id
GET    <prefix>/dashcam-events/export
GET    <prefix>/credentials
GET    <prefix>/settings
GET    <prefix>/media-settings
GET    <prefix>/media-status
POST   <prefix>/test-connection
POST   <prefix>/configure
POST   <prefix>/enable
POST   <prefix>/sync
POST   <prefix>/media-sync-now
POST   <prefix>/test
POST   <prefix>/discover-accounts
GET    <prefix>/export/csv
POST   <prefix>/ui-trap
POST   <prefix>/pdf-inspect/upload
POST   <prefix>/doc-extract/upload
POST   <prefix>/pdf-manipulate/upload
GET    <prefix>/cfs/:callId/challenge
POST   <prefix>/cfs/:callId/auth
GET    <prefix>/cfs/:callId/status
POST   <prefix>/:id/qr-token
POST   <prefix>/
POST   <prefix>/email
GET    <prefix>/check
GET    <prefix>/
PUT    <prefix>/
GET    <prefix>/dashcam-events/recent
GET    <prefix>/dashcam-events/:id
GET    <prefix>/live-locations
```

---

### /api/weather

```
GET  /api/weather/
```

---

### /api/integrations

```
GET    /api/integrations/google-maps/client-key
GET    /api/integrations/services/rmpgutahps
PUT    /api/integrations/services/rmpgutahps
DELETE /api/integrations/services/rmpgutahps
GET    /api/integrations/keys
POST   /api/integrations/keys
PATCH  /api/integrations/keys/:id/revoke
PATCH  /api/integrations/keys/:id/activate
DELETE /api/integrations/keys/:id
GET    /api/integrations/keys/request-log
```

---

### /api/microbilt

```
POST /api/microbilt/dl/search
GET  /api/microbilt/dl/stats
GET  /api/microbilt/status
```

---

### /api/code-enforcement

```
GET    /api/code-enforcement/violations
GET    /api/code-enforcement/violations/:id
POST   /api/code-enforcement/violations
PUT    /api/code-enforcement/violations/:id/status
GET    /api/code-enforcement/tows
GET    /api/code-enforcement/tows/:id
POST   /api/code-enforcement/tows
PUT    /api/code-enforcement/tows/:id/status
GET    /api/code-enforcement/stats
GET    /api/code-enforcement/property-history
GET    /api/code-enforcement/export/csv
```

---

## Total Count

Counting deduplicated real routes (excluding stub pattern repetitions counted once per prefix, excluding the duplicate `/api/forensic-lab` alias set, excluding `/api/process-server` alias, excluding `/api/sex-offender-registry` alias — but noting they exist as separate mount points carrying the same handlers):

- Root non-/api: **11** (including 3 WS)
- `/api/health`: 1
- `/api/auth`: 32
- `/api/map-data`: 2
- `/api/tiles`: 2
- `/api/geo`: 2
- `/api/geocode` (bare /api): 3
- `/api/inspections`: 4
- `/api/crime`: 4
- `/api/dispatch/duty`: 3
- `/api/dispatch` (callLinks): 12
- `/api/dispatch` (panic): 7
- `/api/dispatch` (anomalies): 2
- `/api/dispatch` (premiseHistory): 2
- `/api/dispatch/calls` extensions (recommendedUnits, closestUnit, autoAssign, callTimeline, callActions, callWarnings): 17
- `/api/dispatch/units` extensions (audioMode, unitStatus): 3
- `/api/dispatch/premise-alerts`: 6
- `/api/dispatch/bolos`: 12
- `/api/dispatch/welfare`: 9
- `/api/dispatch/calls` (calls_default): 21
- `/api/dispatch/units` (units_default): 5
- `/api/dispatch/gps`: 13
- `/api/dispatch/trips`: 3
- `/api/dispatch/geography`: 9
- `/api/dispatch` (aggregates): 11
- `/api/dispatch/run-cards`: 6
- `/api/dispatch/shift-handoff`: 2
- `/api/admin`: ~50
- `/api/admin/settings`: 6
- `/api/email-oauth`: 1
- `/api/email`: ~75
- `/api/announcements`: 1
- `/api/ai`: 10
- `/api/voice`: 2
- `/api/personnel`: ~50 (including sub-mounts body-cameras/bodycam-videos ≈ 20 more)
- `/api/presence`: 1
- `/api/records/properties`: 8
- `/api/records/subjects`: 1
- `/api/records`: ~45
- `/api/nibrs`: 9
- `/api/incidents`: ~26
- `/api/cases`: 18
- `/api/citations`: 16
- `/api/clients`: 5
- `/api/connections`: 9
- `/api/court`: 30
- `/api/crisis`: 5
- `/api/crm`: ~50
- `/api/dl-records`: 17
- `/api/cloudflare`: 5
- `/api/field-interviews`: 11
- `/api/fleet`: ~300 (very large)
- `/api/forensics` (+alias): ~26
- `/api/gang-intel`: 10
- `/api/hr`: 18
- `/api/iped`: 10
- `/api/narcotics`: 5
- `/api/nav`: 10
- `/api/offline`: 4
- `/api/patrol`: ~30
- `/api/radio`: 16
- `/api/recruitment`: 5
- `/api/serve` (+alias): 14
- `/api/special-ops`: 9
- `/api/settings`: 3
- `/api/statutes`: 5
- `/api/serve-intake`: 16
- `/api/ocr`: 1
- `/api/skiptracer`: 4
- `/api/trespass-orders`: 2
- `/api/victim-services`: 5
- `/api/affairs`: 11
- `/api/alarms`: 5
- `/api/accreditation`: 5
- `/api/alerts`: 11
- `/api/arrests`: 17
- `/api/assets`: 11
- `/api/audit`: 12
- `/api/billing`: 14
- `/api/invoices`: 2
- `/api/use-of-force`: 4
- `/api/community`: 11
- `/api/intel`: 26
- `/api/interagency`: 10
- `/api/jail`: 22
- `/api/knowledge-base`: 1
- `/api/qa`: 11
- `/api/risk`: 11
- `/api/tasks`: 8
- `/api/training`: 12
- `/api/documents`: 5
- `/api/pdf-tools`: 3
- `/api/document-intake`: 3
- `/api/tts`: 1
- `/api/business-vehicles`: 3
- `/api/business-visits`: 2
- `/api/business-photos`: 4
- `/api/field-photos`: 4
- `/api/howen`: 4
- `/api/offender-registry` (+alias): 8
- `/api/uploads`: 8
- `/api/company-documents`: 6
- `/api/shift-plans` etc. (bare /api): 15
- `/api/downloads` (bare /api): 2
- `/api/warrants`: 22
- `/api/notifications`: 13
- `/api/reports`: 13
- `/api/comms/bolos`: 12
- `/api/comms` (stubs): ~40 paths per stub prefix × 17 prefix mounts (stubs are shared, routes are the same set)
- `/api/weather`: 1
- `/api/integrations`: 10
- `/api/microbilt`: 3
- `/api/code-enforcement`: 11
- `POST /__welfare-fire`: 1

**Estimated total distinct logical routes (not counting alias duplicates): approximately 1,100–1,200 distinct `METHOD /path` combinations.**

If counting every mount-point separately (including all alias duplicates: `/api/forensic-lab`, `/api/process-server`, `/api/sex-offender-registry`, and every stub prefix with its ~40 paths each), the total rises to roughly **1,400–1,500 registrations**.

---

## Ambiguities / Uncertainties

1. **Stub routes count** — `stubs_default` is mounted at 17 different prefixes (`/api/user`, `/api/comms`, `/api/stats`, `/api/dispatch/stats`, `/api/cfs`, `/api/dar`, `/api/clearpathgps`, `/api/servemanager`, `/api/skiptracer-v2`, `/api/firecrawl-tools`, `/api/pdf-artifacts`, `/api/pdf-engine`, `/api/voice-persona`, `/api/diagnostics`, `/api/mobile`, `/api/updates`, `/api/comms` already counted). Each prefix gets the same ~40 stub routes. Most of these are client-compatibility shims returning empty data.

2. **`/api/email` double-mount** — `email_default` is mounted twice: once as `auth: "required"` early in the registry, and once as `auth: "public"` at the very end. Hono dispatches in registration order, so the first-registered (required) match wins for authenticated paths; the second mount exists to ensure the OAuth callback reachable without JWT. The email router itself applies `authMiddleware` internally.

3. **`/api/dispatch` prefix sharing** — Five routers share the `/api/dispatch` mount prefix: `callLinks_default`, `panic_default`, `anomalies_default`, `premiseHistory_default`, and `aggregates_default`. Their paths must be disjoint at the Hono router level; ordering in the registry determines precedence for any collision.

4. **`personnel_default` sub-routes for body-cameras/bodycam-videos** — the `personnel` router contains direct GET handlers for `/body-cameras` and `/bodycam-videos` (simple stubs) AND also mounts `bodyCamerasRouter`/`bodycamVideosRouter` via `.route()`. Both the stub GETs and the sub-router GETs exist; Hono would serve the first-registered match. The sub-router provides the full CRUD, while the top-level personnel stubs at lines 57575/57597 are earlier. This is a **potential shadowing issue** — the top-level `personnel.get("/body-cameras", ...)` at line 57575 may shadow `bodyCamerasRouter.get("/", ...)`.

5. **`/api/dl-records/ocr-scan`** — registered twice (`POST /ocr-scan` at line 79982 and again at 80885). First registration wins in Hono.

6. **`/api/admin/config-history`** — registered twice (`GET` at lines 47372 and 48193). Same path, same method. First wins.

7. **`/api/comms/bolos` vs `/api/comms`** — `bolos` router is mounted at `/api/comms/bolos` explicitly before `stubs_default` mounts at `/api/comms`. The bolos router owns the full `/bolos/*` subtree; stubs at `/api/comms/bolos/*` would never be reached for those paths.

8. **Dynamic paths** — Fleet and other subsystems use `{[0-9]+}` regex constraints in parameter names (e.g. `/:id{[0-9]+}`). These are rendered above verbatim from the source.agentId: a20c7f0d4fbb42c80 (use SendMessage with to: 'a20c7f0d4fbb42c80' to continue this agent)
<usage>subagent_tokens: 130909
tool_uses: 31
duration_ms: 497736</usage>
