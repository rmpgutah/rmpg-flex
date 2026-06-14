// ============================================================
// RMPG Flex — Service Worker
// Provides offline caching for static assets while always
// fetching API data fresh from the network.
// Supports automatic updates with client notification.
// v451: Traccar replaces OwnTracks as the dominant primary GPS source.
//       /api/traccar (canonical) + /traccar (alias) accept Traccar
//       Client (OsmAnd HTTP), Traccar Server forward-webhook, and
//       generic flat JSON. /owntracks/* returns 410 Gone. Optional
//       Traccar Server REST API pull mode (15-second poll) when
//       traccar_server_url + email + password configured.
// v452: Align Traccar config keys with prod schema (traccar_url/email/
//       password/enabled/poll_interval). Migrate owntracks_pending_devices
//       → traccar_pending_devices. Honor traccar_enabled toggle.
// v453: /api/traccar/health route order fix (was shadowed by /:user).
// v454: Traccar Server poller decrypts AES-encrypted email/password from
//       system_config; top-level ESM import for poller; admin pull-status
//       card with live OK/ERROR pill; non-secret config keys render as
//       type=text; collapse traccar_pull_status to one row.
// v455: Traccar historical bulk import — every column preserved, with
//       map viewer (Historical GPS Tracks page + admin import section).
// v456: Bug fixes — allow traccar_url/enabled/poll_interval through
//       admin third-party-keys endpoint (URL save was rejected); fix
//       fv.unit_number → fv.vehicle_number in /historical/devices.
// v457: Mount /api/traccar webhook router AFTER admin router so the
//       /:user/:device wildcard no longer shadows specific endpoints
//       like /historical/devices, /devices, /mappings, /credentials.
//       Webhook still receives bare /api/traccar?token= and any unmatched
//       sub-paths from devices configured with /api/traccar/<u>/<d> URLs.
// v458: Stop encrypting non-secret keys (traccar_url, traccar_enabled,
//       traccar_poll_interval) when saved through admin third-party-keys.
//       Poller reads them raw; encryption was producing "Failed to parse
//       URL from <iv:tag:cipher>" errors in the pull-status panel.
// v459: Fix second column-name bug in /api/traccar/historical/devices —
//       fleet_vehicles uses plate_number, not license_plate.
// v460: Historical tracks visual upgrade — speed-bucketed polyline gradient
//       (6 colors blue→red), direction arrows along the track, distinct
//       Start (S) and End (E) markers, idle/stop detection (≥2 min) marked
//       with purple "P" pins, speed legend overlay in bottom-left corner.
// v461: Map sidebar A+B hybrid — gold-accented stratified section headers
//       (text-[#d4a017] uppercase, gold-glow + 0.18em tracking), uniform
//       brighter item rows (#b8b8b8) with gold-rail hover indicator. Heatmap
//       layer collapsed to soft haze (radius 30→14, opacity 0.7→0.28,
//       maxIntensity capped at 8) so it no longer reads as hard rings.
// v472: Offline CartoDB tile precaching removed — Google Maps
//       is the sole map surface (2026-04-29). TILE_CACHE_NAME retired.
// v473: Offline-mode subscribe-time reconciliation + HR test warmup
//       (2026-04-30). Forces clients onto the new bundle.
// v474: Call marker info bubble redesigned — 11 dispatcher fields packed
//       into a tight 280-340px panel: priority pill + call_number +
//       status pill + age in header; incident type subhead; address +
//       cross-street + property; beat/sector geography; time received
//       (relative + absolute); aggregated hazard banner (officer safety,
//       weapons, felony, domestic, hazmat, mental health, gang) only when
//       a flag is set; existing assigned/nearest unit sections preserved.
// v477: Merge origin/main into flamboyant-nobel — bring 42 PRs (business
//       records, ALPR design, map sidebar visual upgrade, click-target
//       a11y, loading screens, WebSocket Reconnecting pill, AbortController
//       timeouts) into the production-deployed branch (2026-05-01).
// ============================================================

// v601: auth-refresh fix — apiFetch + offlineSync now send sessionId on
//       /api/auth/refresh (legacy handler requires session_id); was causing
//       silent logout at every 15-min token expiry + the [SYNC] Refresh-failed
//       warnings. Bump forces clients onto the fixed bundle.
// v602: turn-by-turn driving directions panel on the dispatch map (useMapRouting
//       now requests steps=true + parses maneuvers; DispatchMiniMap renders a
//       scrollable point-by-point list for the unit→call route).
// v603: turn-by-turn redesigned as a bottom nav banner (one direction at a time,
//       ETA + miles above) with voice announcement of each direction as it
//       becomes current (steps[0] from the live-origin recompute).
// v604: fix assigned-unit matching on the dispatch map — assigned_units arrives
//       as unit OBJECTS, but the code did assigned_units.includes(String(id))
//       (always false) so the unit marker, route line, and turn-by-turn
//       directions never appeared. Normalize to an id Set.
// v627: police-format geography output on the call detail panel — render the
//       Spillman sector code ("SL1") instead of the raw numeric sector_id,
//       prefix the beat code to its name, and add the Area line. The codes
//       were already on the wire from /districts; the client had discarded them.
// v628: surface zone › beat names on the queue CallCard (under the address) —
//       the dispatch code was badged but the human geography wasn't shown.
// v629: use the existing zoneLeaf/beatLeaf parsers in the live geography output
//       (detail panel + card) so Zone/Beat render as clean leaves ("HER", "C")
//       instead of the redundant composite codes ("SL1-HER", "SL1-HER/C").
// v630: click-to-copy the Spillman dispatch code + explanatory tooltips on the
//       Area/Sec/Zone/Beat fields in the call detail panel.
// v631: prepend the Spillman section code to the queue card geography line,
//       derived from the composite zone_id via new sectionPrefix() parser
//       (zero extra lookups). sector_name fallback for non-composite codes.
// v632: geography filter + sort. Search box now matches district fields
//       (Spillman code, zone/beat, place names). New GEO sort mode groups the
//       queue by section › zone › beat. Sort mode now persists via localStorage
//       (the /user/preferences backend is stubbed) — fixes the dead SORT toggle.
// v633: police-format disposition in the call detail panel — "RTF — Report
//       Taken" (code + label) via new formatDispositionCode(), instead of the
//       label alone. Shared humanizeDisposition left untouched.
// v634: copy-to-clipboard button on the call detail-panel Location field.
// v635: unit status board now shows time-in-status (dwell) next to the status
//       badge, color-escalating per status so dispatchers catch units stuck
//       en route / with long scene times.
// v636: call timeline now shows the elapsed delta between each populated stage
//       (Created→Dispatched→Enroute→On Scene→Cleared→Closed) — the full
//       response-time breakdown, not just dispatched→onscene.
// v637: hint district search in the queue search placeholder; show the card
//       geography line even when only a section is assigned (no zone/beat yet).
// v638: merge origin/main (16 commits) into the dispatch geography/police-format
//       batch; bump above both lineages (mine v637, main v632) for a clean
//       cache invalidation on the combined deploy.
// v639: stacked-calls panel in the call detail — lists other active calls at the
//       same address (click to jump). Real D1-backed /user/preferences (no SW
//       impact, listed here for the deploy log).
// v640: GEO-sort section dividers — when the queue is sorted by district, render
//       a sticky "SECTION · Name" header before each new section's calls.
// v641: keyboard-shortcut cheat sheet overlay (toggle with "?") documenting the
//       Spillman-style F-key + letter + nav shortcuts.
// v642: busiest-district chip in the dispatch stats strip — active-call load
//       per section (busiest first), full breakdown on hover. Click to filter
//       the queue to that district (wires into the district-aware search).
// v643: fix Beat picker in call edit — when a Section is chosen but no Zone,
//       scope beats to that section (not all ~719) with zone-disambiguated
//       names, backfill zone + dispatch_code on select, disable until a section
//       is picked. Previously dumped every beat as a raw code.
// v646: check for SW updates on tab focus/visibility (not just the 15-min
//       poll), so a freshly-deployed bundle surfaces the moment an operator
//       returns to the console instead of staying invisible for up to 15 min.
// v647: normalize sector_id to string at the useDistrictLookup ingest boundary
//       + coerce inputs in its lookup helpers, so number/string mismatches stop
//       causing crashes (map #807, dispatch panel). Retires that class of bug at
//       the shared chokepoint instead of per-call-site.
// v667: force-evict stale chunks so the fleet/global scroll fix already in this
//       bundle reaches operators pinned to a pre-fix cache (Fleet > Fuel tab
//       couldn't scroll the fuel-log list). Layout source is correct; this is a
//       cache-busting bump to retire the old bundle.
// v668: Fleet Costs fixes + enhancements — (1) insurance/accessory GET now
//       aliases premium/effective_date/expiry_date/warranty_expiry to the
//       modal-native names so saved rows stop displaying blank ("saves then
//       vanishes"); (2) MoneyInput thousands-formatting on all cost $ fields
//       (no more mangled input); (3) per-category running totals; (4) carry-
//       over auto-fill from the last fuel/cost entry.
// v669: fix fleet record-PDF crash "equipment.map is not a function" — the
//       live fleet_vehicles.equipment column is TEXT (JSON/CSV string), but the
//       PDF generator assumed string[] and called .map(). Now coerced to a
//       string[] in recordPdfGenerator.ts so Print fleet record works.
// v670: fix dispatch map crash "line-gradient: Expected at least 4 arguments"
//       (single-segment route built a stop-less step expr → invalid; now falls
//       back to flat line-color), and harden PrintRecordButton breadcrumb fetch
//       to require a numeric call id (stops GET /call-trail/undefined → 400).
//       Server side (same push): dispatch call DELETE now unlinks non-cascading
//       FK refs before deleting (was 500), and /api/hr/dashboard has a real
//       handler (was 404).
// v677: audit DO-FIRST map hardening — useMapboxResponseTime moves the 9MB
//       beat.geojson fetch BEFORE the style-ready guard and wraps only the
//       addSource/addLayer (idempotent) so a basemap switch mid-fetch can't
//       throw "Style is not done loading"; useMapRouting bails on <2-coord
//       routes before building a degenerate line-gradient. (Worker side same
//       push: OCR/AI-dispatch timeout guards + VoiceHubDO never-silence broadcast.)
// v678: audit item A — useGpsTracking.sendBatch no longer clears the failover
//       queue on a 200-with-error body; it re-enqueues those breadcrumbs (was
//       silent GPS data loss when /dispatch/gps 200s with {error}). (Worker
//       same push: audit item B — geocodeAddress in the serve-intake commit is
//       now 8s-time-boxed so a slow Nominatim can't stall the /upload response.)
// v679: Statewide PMTiles overlays — Utah roads + address points vector
//       tiles served from R2 via /api/tiles/* (Range-capable). New
//       "Statewide Data" toggle section on the Map page. /api/* is already
//       SW-bypassed, so PMTiles range requests pass straight to network.
// v680: Statewide overlays made dynamic — survive basemap switch + print
//       (re-add on style.load), theme-aware labels (legible on light/
//       satellite), and "Use This Location" popup action routes a clicked
//       address/road into the existing address-search pan+zoom+marker flow.
// v681: pdfjs-dist 5→6 (Dependabot #880, was CI-failing). v6 removed
//       PDFDocumentProxy.destroy() — the rmpg-pdf-engine pdfjs backend now
//       owns the loading task and tears down via loadingTask.destroy()
//       (version-agnostic). Worker (build/pdf.worker.min.mjs) + standard_fonts/
//       cmaps asset paths unchanged; vite build + 563 tests green on v6.
// v682: Spatial Layers reorganized into two groups — "Police Geography"
//       (Area › Section › Zone › Beat) and "Boundaries" (Municipality,
//       County). Area/Section/Zone are derived from beat geometry: fill
//       colored by level + dissolved boundary outline (@turf/dissolve,
//       MultiPolygons flattened first). State Boundary/Highways/Places
//       dropped from the map sidebar.
// v683: PDF surface hardening — white-fill scanned-PDF canvas before Vision
//       OCR rasterization (JPEG has no alpha); skip malformed-transform text
//       items in engine backend + pdf-editor; null-guard serve-PDF GPS
//       toFixed; Array.isArray guard on record-PDF violations.map.
// v684: Advanced overlay tools — (1) "What's Here" click-to-identify
//       (Area/Section/Zone/Beat + County/Municipality + nearest address
//       via turf PIP); (2) Activity choropleth coloring beats/zones/
//       sections/areas by live call volume (calls binned via PIP); (3)
//       overlay opacity slider + Area/Section legend + persisted tool
//       state; (4) Measure (distance/area via @turf/length+area).
// v685: PDF output crash-hardening sweep — Array.isArray guards on every
//       DB-sourced array field across record/recordExt/invoice/serve/form PDF
//       generators (~30 sites: linked_persons/vehicles/properties, warrants,
//       incidents, citations, calls, criminal_records, visit_history, notes,
//       attachment_images, fleet/personnel logs, line_items, payments, photos,
//       skipTraces, distribution/checked) so a sentinel "None" string (truthy
//       .length, no .map/.join) can no longer crash a PDF. Plus finite-guard
//       on recordExt fine_amount ($NaN -> raw value).
// v686: Statewide Data first-class integration (Phase A) — Roads/Addresses
//       join the overlay opacity slider, get a legend (road classes +
//       address dot), and persisted on/off visibility across reloads;
//       road labels gain class-based collision priority (major roads win)
//       so the network reads cleanly. Backend address search/snap next.
// v687: Statewide address service (Phase B) — dedicated rmpg-geo D1 (1.48M
//       UGRC address points + FTS) behind /api/geo. Map search box now
//       returns authoritative statewide addresses first (Mapbox fills);
//       "What's Here" resolves nearest address from the DB (works anywhere,
//       no tile dependency).
// v688: PDF META consistency — Created/Last Updated now fall back to "N/A"
//       (matching the rest of the form) instead of rendering blank boxes when
//       a record has no created_at/updated_at. Found via visual render+review
//       of a fully-populated person record PDF.
// v689: audit wave-3 — map-overlay fixes (vector-tile listener-leak dedup,
//       choropleth strictly-ascending step stops, response-time no-data
//       coloring, measure-tool unmount cleanup) + VoiceHubDO officer-safety
//       alert gap. Bump so users get the fixed map hooks.
// v690: Location-map snapshots on record PDFs — Call (CFS), Property, and
//       Business reports now embed a static Mapbox map of the address with a
//       gold marker pin (CFS: light streets @ z15; Property/Business:
//       satellite-streets @ z17 to show the structure). Geocodes the address
//       when a record has no stored lat/lng (e.g. businesses). New
//       pdfStaticMap.ts helper; BusinessTab gains a Print button (businesses
//       render via the property generator). Best-effort — omitted silently if
//       no coords/token/network.
// v691: FIX statewide overlays not rendering — root cause: Mapbox GL JS has
//       NO addProtocol (MapLibre-only), so the pmtiles:// protocol silently
//       never registered and Roads/Address Points loaded nothing despite
//       showing toggled-on. Now the Worker extracts MVT tiles from the
//       PMTiles archives in R2 and serves /api/tiles/<name>/{z}/{x}/{y}.mvt;
//       client uses a NATIVE mapbox vector source (no protocol). Verified
//       tile extraction against the real archives.
// v692: FIX address-search zoom/focus/pin — handleAddressSelect used
//       panTo()+setZoom() (two competing animations) so selecting a result
//       neither centered nor zoomed to the address and the pin landed
//       off-screen. Now a single flyTo({center,zoom:17}) pans+zooms as one
//       move, bringing the gold search pin into view.
// v693: Geography overlay redesign — Area/Section/Zone/Beat now render as
//       blended COLOR COVERAGE fills (their own boundary outlines removed),
//       selectable one at a time or all together; County + Municipality
//       become OUTLINE-ONLY neutral reference lines lifted above the
//       coverage (fills killed). Boundary lines + level labels z-ordered on
//       top of the fills.
// v694: A/S/Z/B no longer pop in/out while zooming — removed the minzoom
//       gating on the Area/Section/Zone coverage fills + labels and dropped
//       Beat's minZoom (the useGeoJsonLayers zoomend handler kept hiding it
//       below z10). Once selected they stay visible at every zoom. Removed
//       the now-inaccurate z7+/z8+/z9+ badges from the Police Geography rows.
// v695: SECURITY — purge plaintext mapbox_password from system_config (deleted
//       on live D1) and remove the Account Password field from the Mapbox
//       integration UI so it can't be re-saved as a cleartext secret. The app
//       only ever needs the public mapbox_access_token.
// v696: FIX — CFS/Property/Business PDF "opens then goes blank". The v690 map
//       helper used auth-coupled apiFetch (getMapboxAccessToken, forwardGeocode)
//       inside PDF generation; a 401 there triggers apiFetch's token-refresh →
//       window.location.href='/login', tearing down the open viewer. Now uses
//       the sync cached token + direct api.mapbox.com geocode (no apiFetch, no
//       auth coupling) with AbortController timeouts. Map can no longer
//       redirect, hang, or destabilize generation.
// v697: Drive-to-address navigation + dispatch-from-address. Selecting an
//       address search result now shows Navigate / Dispatch actions:
//       Navigate routes device GPS → address (reuses useMapRouting:
//       traffic, congestion line, live re-route) with a turn-by-turn
//       current-maneuver line added to the nav banner and live origin
//       updates as you drive; Dispatch creates a call at the address
//       (POST /dispatch/calls, incident type + priority, coords prefilled).
// v698: FIX "Unincorporated" misclassification — the 29 county "<CITY>-UNINC"
//       catch-all beats fully overlap the incorporated city beats, so the
//       client first-match PIP reported e.g. Midvale as "SLC Unincorporated".
//       New findBeatAt() mirrors the server geofence rule (incorporated city
//       beat wins; -UNINC only as fallback) and is used by What's-Here +
//       the activity choropleth. Tagged beats sorted so city fills draw on
//       top of the catch-all coverage (no more unincorporated bleed).
// v699: FIX — CFS PDF process-service details didn't fill. "Process Service
//       Details" (serve-to/address/result/attempts) + Visit History were
//       gated to incident_type==='pso_client_request', but serve-intake
//       creates calls as 'civil_paper_service' so those sections never
//       rendered. Hoisted Process Service Details to a top-level section
//       (self-gated by process data / service-type) and added
//       'civil_paper_service' to the visit-history gate.
// v701: Phase 2 — unified always-visible map Legend (bottom-left, collapsible)
//       reflecting EVERY active overlay: geography coverage (Area/Section/
//       Zone/Beat + compact categorical key), County/Muni outline boundaries,
//       statewide road classes + address dot, and the activity-choropleth ramp.
// v702: Phase 3 — Address/Premise Intelligence. "What's Here" now also pulls
//       nearby prior calls + incidents (new GET /api/dispatch/geography/
//       premise-intel, lat/lng bbox) and shows a premise-history band
//       ("N prior calls · M incidents · Last: <type> <date>") with acronym-
//       formatted incident types (toDisplayLabel). Map <-> Dispatch/RMS
// v792: Cross-integration audit fix — NAV/FLEET/PERSONNEL/DISPATCH mileage
//       guardrails + vehicle-id back-links (Claude ed5d0e99 + d3001d25).
// v809: Toughbook GPS — detect by hardware presence (u-blox COM port is
//       definitive regardless of WMI manufacturer string) + retry internal-GPS
//       detection through cold-boot port enumeration delay (no more silent WiFi).
// v810: Nav trip recording — fix interval-reset bug that silently dropped ALL
//       live movement data (route-update + auto-end intervals were re-created on
//       every GPS fix so they never fired); read fix from a ref, bind only to
//       trip id + tracking. Forward speed/heading so max-speed populates. Add
//       missing GET /nav/vehicle-take-home endpoint (client 404'd → take-home
//       officers couldn't start trips).
// v811: Nav trip detection lifted app-wide — one NavTripProvider at the route
//       shell (read-only GPS) drives detection on EVERY page incl. the Drive
//       Mode HUD, not just /nav. NavPage now consumes the shared context instead
//       of running its own detector + duplicate uploader.
// v812: Fix "trips not logging" poison-pill — a trip left open (app close / lost
//       signal) stayed 'active' forever and the single-active-trip guard 409'd
//       every new trip. Server now auto-closes stale active trips (>10min no
//       update) in /trip/current + /trip/start; client clears stale ids + re-arms
//       when the server reports no current trip; the 3-min auto-detect window now
//       re-arms (rolling departure detection) instead of dying after login.
// v813: HOTFIX — app-wide trip detector caused an infinite render loop (fresh
//       position object each render → detection effect → setDetection → re-render
//       → …), pegging the main thread so ALL clicks/Link buttons failed app-wide.
//       Memoize position in NavTripProvider + key the detection effect on
//       primitive lat/lng so a setDetection re-render can't re-fire it.
// v814: Integration audit (Fleet/Dispatch/Nav). (1) AUTO-detected trips never set
//       activeTripId (startTrip already confirms → active), so the route-update +
//       auto-end intervals — both guarded on activeTripId — recorded ZERO live
//       breadcrumbs for auto trips; only manual trips worked. (2) Adopted active
//       trips now seed lastMovementAt so they can auto-end. (3) Dispatch map
//       instant unit-glide was dead: AlertHubDO delivers a flat {latitude,
//       longitude} frame but MapPage only read data.lat/data.unit.* → units moved
//       only on the ~7s poll; now reads latitude/longitude too. (4) Shared
//       Toughbook NMEA reader is ref-counted so a read-only/extra tracker
//       unmounting no longer strands the unit on WiFi. (5) Manual trips now log
//       detected_by='manual'. (Server: nav trip-end duration tz fix; breadcrumb
//       trip_id stamped for replay.)
// v815: patrol MileageAuditTab backfill-missing-mileage (client change shipped
//       in 1529d651 without a SW bump — v814 was already live, so bump to
//       invalidate the stale cached bundle).
// v816: Document Writer overhaul. (1) SAVE FIX: documents are saved as text/html
//       to /api/uploads, but that MIME was missing from the uploads allowlist so
//       every save 400'd and the page stayed "Unsaved" (server: add text/html;
//       client: surface the error instead of swallowing it). (2) Dark/Light theme
//       (auto by clock + toggle) — replaces the unreadable prose-invert-on-white
//       text with theme-driven color:inherit; print/PDF always black-on-white.
//       (3) 50 formatting/design features (font family/size, color/highlight,
//       super/sub, small/all caps, letter spacing, line height, shadow, drop cap,
//       weight, opacity; paragraph spacing/indents/columns/breaks/borders/shading/
//       line numbers/direction/vertical align; page size/orientation/margins,
//       headers/footers, watermark, TOC, cover page, footnotes/endnotes, cross-
//       refs, bookmarks, backgrounds, templates, statistics) via custom TipTap
//       extensions — no new npm deps.
// v817: Document Writer — batch of advanced editor features (no new npm deps).
// v818: PDF editor — Stamp Studio.
// v819: Process Server — "Notice of Attempt to Serve" form.
// v820: PDF editor — underline + strikethrough text-markup tools.
// v821: Printable field forms — 6 new blank PDFs.
// v822: PSO Notice of Communication — autofilled client notice.
// v823: Microsoft 365 email integration — full 6-phase pipeline (admin OAuth +
//       inbox/folders/attachments with CID image rewriting + send via Graph +
//       rules engine + autolinker (CFS#/plate) + cron poller + outbox retries +
//       LinkedEmailsSection on Incidents/Warrants). Azure AD input validation
//       (GUID shape + Secret-VALUE-not-ID check). See PR #1081 for the full
//       phase-by-phase commit log.
// v824: Admin Email — defend Save Credentials against password-manager autofill
//       races (Chrome/Safari fill the DOM without firing React's onChange,
//       leaving controlled state empty and the form falsely "required").
//       Inputs now carry refs + onPaste/onBlur handlers and handleSaveCredentials
//       falls back to the live DOM value when state is empty.
// v825: Admin Email — explicit "Credentials saved" green banner after a
//       successful Save. The previous flow cleared the inputs but gave no
//       affirmative success cue; users reported "nothing happened" even
//       though the DB writes had landed and the connection-status pill had
//       quietly moved from "Not Configured" → "Not Authorized".
// v826: Navigation 100-update batch — large additive enhancement of the Drive
//       Mode HUD + /nav trip tab. New nav hooks (prefs/session/waypoints/recent-
//       destinations/auto-theme/driving-score/fix-freshness/proximity-alerts/
//       hotkeys/wake-lock/low-power/speed-limit), nav utils (unit+time formatters,
//       GPX/CSV export, heading/coord/eta/geo/theme/trail helpers, volume-scaled
//       tones), a HUD instruments module + NavSettingsPanel, and NavMapView helper
//       extraction. Built via a 5-lane parallel workflow (disjoint files), then
//       verified (typecheck + 793 tests). Fixed a real latent bug: proximity-alert
//       cooldown wrongly suppressed the FIRST tone near clock-epoch (lastToneAt
//       init 0 -> -Infinity).
// v827: Nav wiring audit — wired GPX + CSV trip-track export onto NavPage trip
//       history (gpxExport/navCsvExport/navUnits), and PRUNED 23 orphaned
//       (built-but-never-wired) nav hooks/utils from the v826 batch that
//       duplicated already-wired hud/ or inline logic.
// v828: Admin Email — shadowed /api/email/status fix. The stubs router was
//       mounted at /api/email BEFORE the real email router, so the
//       integrations-tab `/status` stub (returns {configured: false}) was
//       intercepting /api/email/status and falsely rendering the "Email Not
//       Configured" splash even when creds were saved.
// v829: Admin Email — OAuth callback unauth fix. Microsoft redirects the
//       user's browser directly to /api/email/oauth/callback with code+state
//       and no Authorization header; the router's `use('*', authMiddleware)`
//       was 401ing the redirect ("Authentication required"). Now the
//       middleware skips that exact path while still gating every other
//       route in the router.
// v832: mobile responsiveness pass — Reports, Document Writer, Fleet, PDF
//       Editor, Navigation/Drive Mode, Records & Personnel tabs made
//       touch-friendly (responsive stacking, overflow-x tables, viewport-fit
//       modals/drawers, 44px tap targets). Client-only; bump to invalidate.
// v833: Mobile/tablet responsive audit (complements v832). Global <=1024px CSS
//       safety net (index.css EOF): replaced-element overflow guard (excl Mapbox
//       canvas), 44px touch targets for the iPad band (768-1024, pointer:coarse,
//       min-height only), readable text floor + iOS size-adjust lock, and dialog/
//       modal max-width so overlays never exceed the viewport — desktop dense
//       theme untouched. Page fixes: stat-card grids (Reports/Billing/QA/Training/
//       Assets/Community/Dashcam/CommandCenter) stack 2-col on phone; Security
//       login/threat tables get horizontal scroll; Invoices table panel both-axis-
//       scroll (keeps sticky header); Dispatch handoff modal max-w-[95vw].
//       Manifest: orientation -> any, dead /units shortcut -> /map. useIsMobile
//       re-checks on orientationchange.
// v834: functional-audit fixes — Reports date-range now drives the data (was
//       ignored); Reports CSV export quoting + correct incidents shape (was
//       crashing/empty); schedules panel shape tolerance; Dashboard Active
//       Warrants card uses the live count; Document Writer clears draft on save
//       + leak-proof print; NavPage null-coord guards; speed-limit badge clears
//       off untagged roads; Personnel edit no longer blanks employee_id/notes.
// v835: iPad nav-shell flip — Layout now uses useIsMobile(1024) so iPad portrait
//       + small landscape (<1024) get the TOUCH shell (mobile header/drawer/
//       bottom-nav) instead of the mouse-oriented desktop F-key toolbars, which
//       only ever covered <768 before (iPads got the cramped desktop layout).
//       The two desktop F-key toolbars switch md:flex -> lg:flex so they show
//       only at >=1024, matching the JS boundary (no double-render at 768-1023).
//       Large landscape iPads + desktops (>=1024) keep the F-key layout.
// v836: PDF Editor — annotations on ROTATED pages now save at the correct
//       position. drawAnnotation draws in the displayed frame under a /Rotate-
//       inverse CTM (new ContentStreamBuilder.transform + rotationGeometry);
//       both native + pdf-lib save paths fixed. Redactions/signatures on rotated
//       evidence pages were landing in the wrong place. Geometry unit-tested +
//       visually verified (rot 0/90/270). Un-rotated path byte-identical.
// v837: PDF Editor polish — (1) dragging/resizing an annotation now creates ONE
//       undo step instead of flooding history with a frame-by-frame entry per
//       pointer-move (snapshot-on-first-move + live no-history updates); (2) the
//       Bates/Watermark/Document-properties toolbar buttons (previously dead
//       no-ops) now surface the document-level PropertiesPanel sections.
// v838: PSO Notice of Communication data fixes — addressee now uses the
//       contracting CLIENT record (company + Attn: contact + client phone/
//       address) instead of the inconsistent call-level caller; Service Type
//       derives from the client industry / PS disposition ("Process Service")
//       instead of generic "Protective Services"; attempt RESULT maps the raw
//       "PS *"/"Negative Contact" dispositions to client-readable text; notice
//       body wording is service-type-accurate. Backed by a clients JOIN that
//       now surfaces contact_name/contact_phone/address/industry.
// v839: PDF system + Document Writer feature wave 1 (~27 new features).
//   PDF Editor: rotate-all/reverse/duplicate pages, export page-range dialog,
//   fit-page/width zoom presets, "Page N of M" footer, checkmark/cross/cloud
//   annotations, color presets, lock/unlock, select-all/clear-page, more
//   shortcuts, thumbnail-size toggle, download-flattened, fit-width-on-load.
//   Document Writer: 5 new police templates, insert time/date-time, numbered
//   section headings, Focus/Zen mode, live word/char/sentence status bar,
//   avg-words/sentence stat.
// v840: PDF system + Document Writer feature wave 2 (~28 more features).
//   PDF Editor: append/merge PDF, insert image-as-page, blank/lined/grid page
//   templates, search-and-redact by pattern (SSN/phone/email/regex), image +
//   tiled watermark, custom header/footer, measure tool, annotation font/opacity
//   controls, extract-text, batch-rotate selected pages, crop-all, bookmarks
//   panel, go first/last, export page as PNG. Document Writer: 12 more police
//   templates, snippets library, table-of-contents, doc properties, signature
//   line, version snapshots, smart quotes, read-aloud TTS, JSON export/import,
//   outline numbering, fillable fields, character map, word goal.
// v841: PDF system + Document Writer feature wave 3 (~25 more features).
//   PDF Editor: AcroForm form fields, real /Link annotations + /Outlines tree on
//   save, split into multiple files, optimize/compress, line styles (dashed/
//   dotted) via new engine setLineDash op, set page size, per-thumbnail rotate
//   CCW, grayscale/invert page, annotation summary report PDF, save-a-copy,
//   two-PDF visual compare (pixel diff). Document Writer: 15 more police
//   templates, Analysis panel (Flesch readability, style/passive-voice checks,
//   word/phrase frequency, version diff), formatting brush, case transforms,
//   table-from-CSV, Utah Code citation insert, page-count estimate, letterhead
//   + page-border styles, custom save-as-template surfaced in the chooser.
// v842: Email — fix broken images in the message viewer. The body renders in a
//   blob: URL iframe, but proxyEmailImages rewrote <img> srcs to a RELATIVE
//   "/api/email/image-proxy?..." which doesn't resolve against a blob: document's
//   base, so every external image 404'd to a broken-image icon. Qualify the proxy
//   URL with window.location.origin so it resolves to the real same-origin path.
// v843: GPS reliability (accountability — never silently drop a fix). Three
//   loss-points closed: (1) durable flush on pagehide/visibility-hidden — the
//   in-memory upload queue (up to one 5s interval of fixes) is persisted to the
//   localStorage failover queue on tab close / OS backgrounding, where React's
//   unmount cleanup is unreliable; deduped so a tab-switch can't double-queue.
//   (2) failover buffer cap raised 100→2000 fixes (~8 min → ~2.8 h offline) and
//   overflow now logs instead of dropping silently. (3) Server-side: a non-finite
//   lat/lng fix no longer poisons the ATOMIC breadcrumb batch (one NaN used to
//   roll back & 500 the whole batch → client re-queued the poisoned batch forever,
//   blocking every good fix); bad points are dropped, good ones persist.
// v845: UNBLOCK main — PR #1094 (+105 templates) merged broken (132 type errors
//       → every deploy since Wave 3 failed): a 2nd template taxonomy that didn't
//       reconcile + an incomplete TemplateChooser rewrite + a dropped import.
//       Fix: DocumentTemplate.category unions both taxonomies; TemplateChooser
//       restored to last known-good (all templates preserved); FeaturesPanel
//       import restored.
// v846: mobile card layouts on /patrol — Checkpoints + Scan Log + Shift Summary
//   toolbar wrapping. Wide tables behind overflow-x-auto are unusable on a phone;
//   cards stack key info + 44pt-tap-target action rows on a single touch surface.
// v847: PDF + Document Writer feature wave 4 (~27 more features).
//   PDF Editor: page organizer (drag-reorder grid), single/continuous/2-up view
//   modes, annotation reply threads, N-up export, page-number styles, flatten-
//   form, text-annotation hyperlinks, deskew, page labels, snap-to-grid + grid,
//   apply-annotation-to-all-pages, region-to-PNG, annotation border toggle.
//   Document Writer: debounced server autosave, shortcuts cheatsheet, paragraph-
//   style presets, text<->list conversions, list/table row sort, auto-filled
//   officer signature block, recent documents, standalone styled HTML export,
//   reusable section blocks, duplicate document, nav helpers, manual save-draft.
// v848: /field-camera mobile camera portal — live viewfinder + HUD; capture
//   composites timestamp/officer/unit/GPS into a bottom data band + translucent
//   RMPG watermark bottom-right, uploads stamped JPEG to /api/field-photos (R2).
// v849: PDF + Document Writer feature wave 5 (~21 more features).
//   PDF Editor: annotation search/filter, rotate annotation, measurement
//   calibration + polygon area, redaction options (black-bar/white-out + reason),
//   sticky-note categories, insert pages from another PDF at a position, editor
//   chrome light/dark, annotation style presets, shortcut help. Document Writer:
//   mail-merge from a CFS call, heuristic proofreader (click-to-fix), track-
//   changes/suggestion mode, reversible redaction mark, section word-count goals,
//   document minimap, inline phrase autocomplete, editor appearance settings.
// v850: live-sweep fixes (full 90-route browser sweep of prod). (1) Crime
//   Analysis page was a permanent "No data available" — the endpoint was only
//   ever a proxy stub with a mismatched shape; real /api/reports/crime-analysis
//   (+ CSV export) now ships on the rewrite with the page's exact contract,
//   and the page shows its spinner during load (loading was checked AFTER
//   !data, so the spinner never appeared). (2) Dashboard 8-tile rollup was
//   serving the all-zeros catch fallback in prod: /reports/dashboard queried
//   response_time_sec (live column is response_time_seconds) → "no such
//   column" rejected the whole Promise.all; fixed + response minutes now fall
//   back to onscene_at−created_at when the column is NULL (all live rows).
//   (3) Radio LiveTab: transient TX-poll failures (e.g. a tick racing the
//   15-min token refresh) logged a scary error every 5s; now warn once per
//   failure streak, error only if it persists.
// v851: PDF + Document Writer feature wave 6 (~18 more — closing toward 150).
//   PDF Editor: typed signature + initials + quick-sign, AcroForm dropdown/radio/
//   date fields, crop aspect-ratio presets, PNG export DPI (72/150/300), nested
//   bookmarks (/Outlines tree), presentation/full-screen view. Document Writer:
//   floating selection bubble toolbar, auto-numbered figure/table/exhibit
//   captions, vertical spacer, page-setup presets, export/copy selection, custom
//   spell dictionary, word/char limit indicator, drag-reorder outline sections,
//   formatting macro recorder, clear-document.
// v852: Document Writer template formatting overhaul — citation-form look in
//   sans-serif across all ~150 templates. ROOT CAUSE of the old plain look:
//   TipTap's schema silently STRIPPED the templates' <div> wrappers, per-<td>
//   styles and h2 border-bottoms at insert. _shared.ts rebuilt on a
//   round-trip-safe vocabulary (span font-family/size/letter-spacing/small-caps,
//   paragraph shading + full borders, tables, taskList): Arial/Helvetica form
//   chrome, letterhead w/ gold rule bar, gold-tab section bars, label-over-value
//   field grids (dense 3-up citation caseHeader), ruled narrative writing areas,
//   boxed signature rows w/ certification line, notary acknowledgment on
//   affidavits, statute banners, form footer helper. index.ts's 45 hand-rolled
//   templates converted to the same system (43 titles, 120 sections, 264 field
//   cells); 164 '<strong>Label:</strong>' cells in the 4 category files →
//   field() label-over-value boxes.
// v853: Fix blank "Notice of Communication" PDFs (and serve Notice of
//   Attempt). jsPDF's dataurlnewwindow opened an HTML wrapper page whose
//   iframe pointed at a SESSION-BOUND blob URL — anything saved/uploaded from
//   that window was a ~240-byte HTML shell that rendered blank in every PDF
//   viewer (live artifact: attachments #56). New openPdfDocument() opens the
//   real PDF bytes (File-wrapped blob → window.open, download fallback when
//   popup-blocked). Generator verified healthy (smoke tests + pdftoppm render).
// v854: Account Security page fixes + real TOTP 2FA. (1) "undefined
//   remaining" backup codes — /api/auth/security/status now returns the
//   client's SecurityStatus shape (totpEnabled/backupCodesRemaining/...);
//   active-session count now only counts sessions used in the last 7 days.
//   (2) TOTP enrollment is REAL: RFC 6238 in the Worker (WebCrypto, AES-GCM
//   secret at rest, 10 hashed single-use backup codes), login gate +
//   /login/verify-2fa + /login/verify-backup-code, password-confirmed
//   disable + backup-code regenerate. QR rendered client-side from
//   otpauthUrl (qrcode pkg); setup surfaces capture backup codes from the
//   verify response (previously rendered an empty list). Sessions cron
//   purge added.
// v873: lazyRetry now retries a failed chunk import in place (1.5s/4s backoff)
//   before reloading — rides out Pages deploy-propagation 500s instead of
//   stranding users on the ErrorBoundary card (2026-06-10 fleet-chunk incident).
// v876: rules-of-hooks crash sweep — NewCallModal/QuickPsoModal useState was
//   declared after the `if (!isOpen) return null` early return (opening the
//   modal changed the hook count → React #310 crashed the page); same class
//   fixed in ReconConnectPage (effects below the role-gate early return).
// v877: Toughbook background nav — hold an Electron powerSaveBlocker
//       (prevent-app-suspension) while a trip is active so route uploads +
//       auto-end keep firing off-screen; pairs with backgroundThrottling:false.
// v878: app-wide turn-by-turn guidance — route/ETA/progress/reroute engine
//       hoisted from NavigationPage into NavTripContext (useNavGuidanceEngine)
//       so navigation keeps calculating on Dispatch/Records/etc; returning to
//       the drive HUD re-adopts the live route instead of resetting it.
// v879: Mileage Audit data-fix upgrades — autofill chips (GPS-recorded
//       distance + chain-neighbor continuity via /patrol/mileage/
//       fix-suggestions), live row-distance/GPS-deviation calculations in
//       the fix form, and chain-gap badges on the Start→End column.
// v880: GPS trail render fix — adjacency-preserving speed-colored segments
//       (the per-color LineString grouping drew straight diagonal chords
//       between non-consecutive fixes) + gap/teleport splitting + arrow
//       marker leak. Mileage chain now includes odometer-less PATROL trips
//       (distance from GPS distance_m — live patrol trips carry no odometer).
// v881: Fleet per-vehicle analytics wave 2 — combined-cost-trend/monthly-
//       spend/daily-gps-mileage wrapper keys, inspection-stats + cost-
//       analytics field names, maintenance-schedule urgency, lifecycle
//       computed fields, driver-performance GPS enrichment, SUM fan-out
//       fix in lifecycle/comparison.
// v882: PS-211 trip log PDF fixes — first-section title no longer struck
//       through by the header rule (all v2 forms), PERIOD header label,
//       MM/DD-stamped start/end on multi-day reports, 1-decimal distances,
//       episode-based harsh counts + GPS-teleport distance filtering,
//       zero-movement rows dropped.
// v883: PS-211 shows ALL trips (call_response unit_trips + mileage-less
//       patrol trips) with a DATE column + America/Denver times; Patrol
//       Trip Log Management (full add/edit/delete, audited); Fleet
//       "Mileage Distribution" panel → "Daily Mileage Run" (GPS miles/day).
// v884: Fleet sub-records pass — tires D1_TYPE_ERROR (undefined binds) +
//       diagram column-name fix + full tire edit/delete; damage + recall
//       full edit/delete; maintenance modal gains labor cost, next-due
//       mileage, service tasks, notes; Mileage Audit officer dropdown
//       shows ALL personnel (was role=officer only).
// v885: SW-update reload-loop fix — auto-reload capped to once per 5 min
//       (sw.js byte-flap at the edge looped reloads every 1-3 min = "can't
//       scroll") + per-path scroll restore across reloads.
const CACHE_NAME = 'rmpg-flex-v951';
const MAX_CACHE_ENTRIES = 500; // Limit main cache to prevent unbounded growth
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png',
  '/rmpg flex.png',
  // Sampled console feedback sounds (soundAssets.ts) — offline-critical.
  // UI feedback five + the full Spillman/Motorola dispatch tone library
  // (dispatchTones.ts plays these asset-first with synth fallback).
  '/sounds/click.wav',
  '/sounds/submit.wav',
  '/sounds/update.wav',
  '/sounds/delete.wav',
  '/sounds/login.wav',
  '/sounds/info.wav',
  '/sounds/caution.wav',
  '/sounds/warning.wav',
  '/sounds/error.wav',
  '/sounds/alert.wav',
  '/sounds/alarm.wav',
  '/sounds/chirp.wav',
  '/sounds/double_chirp.wav',
  '/sounds/descending.wav',
  '/sounds/p1_alert.wav',
  '/sounds/panic_continuous.wav',
  '/sounds/key_up.wav',
  '/sounds/key_out.wav',
  '/sounds/radio_grant.wav',
  '/sounds/radio_deny.wav',
  '/sounds/quick_call_2.wav',
  '/sounds/talk_permit_low.wav',
  '/sounds/call_alert.wav',
  '/sounds/knox_alert.wav',
  '/sounds/squelch_tail.wav',
  '/sounds/static_burst.wav',
  '/sounds/boop.wav',
  '/sounds/dispatch_bell.wav',
  '/sounds/data_chirp.wav',
  '/sounds/emergency_three.wav',
];

// Evict entries when cache exceeds limit (order not guaranteed)
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const excess = keys.length - maxEntries;
    const startIndex = Math.floor(Math.random() * (keys.length - excess + 1));
    const toDelete = keys.slice(startIndex, startIndex + excess);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}

// Install — pre-cache core shell, immediately activate
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((err) => {
        console.warn('[SW] Pre-cache failed:', err);
        // Don't block install — partial cache is acceptable
      })
  );
  // Skip waiting so the new SW activates immediately
  self.skipWaiting();
});

// Activate — clean old caches (including the retired tile cache), claim clients, notify
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // Delete every cache that isn't the current main cache. This also
      // evicts the retired 'rmpg-flex-tiles-v2' CartoDB tile cache.
      const oldKeys = keys.filter((k) => k !== CACHE_NAME);
      return Promise.all(oldKeys.map((k) => caches.delete(k))).then(() => {
        if (oldKeys.length > 0) {
          // Notify v539+ clients that have an auto-reload handler.
          // The SW-side force-reload (client.navigate) was REMOVED
          // 2026-05-05 because it was causing perceived slowness on
          // Electron — the cache eviction + navigation triggered a
          // full bundle re-fetch every time a new SW activated. The
          // v539+ client-side auto-reload (1.5s after SW_UPDATED with
          // input-focus guard) is enough; pre-v539 sessions can do a
          // one-time manual reload.
          self.clients.matchAll({ type: 'window' }).then((clients) => {
            clients.forEach((client) => {
              client.postMessage({ type: 'SW_UPDATED', cacheName: CACHE_NAME });
            });
          });
        }
      });
    })
    .then(() => self.clients.claim())
  );
});

// Fetch — network-first for code/pages, cache-first for images and tiles
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls, WebSocket, POST requests, or external map tiles
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws') ||
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // /tiles/* requests no longer have a special cache path. The CartoDB
  // tile fallback was retired 2026-04-29; if any code still references
  // /tiles/, requests fall through to the default network-first handler.

  // Navigation requests — always network first with offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              trimCache(CACHE_NAME, MAX_CACHE_ENTRIES);
            });
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request)
            .then((cached) => cached || caches.match('/'))
            .then((fallback) => fallback || new Response(
              '<!DOCTYPE html><html><head><title>Offline — RMPG Flex</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0}body{background:#0a0a0a;color:#d4a017;font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{text-align:center;max-width:420px;padding:32px 28px;border:1px solid #222;background:#141414;border-radius:2px}h1{margin:0 0 12px;font-size:18px;letter-spacing:0.05em;text-transform:uppercase;color:#d4a017}p{margin:0 0 20px;color:#888;font-size:13px;line-height:1.5}button{background:#d4a017;color:#000;border:0;padding:10px 28px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;cursor:pointer;border-radius:2px;font-family:inherit}button:hover{background:#f0bf38}</style></head><body><div class="card"><h1>Connection Lost</h1><p>Unable to reach the RMPG Flex server. Check your network connection and retry.</p><button onclick="window.location.reload()" type="button">Retry</button></div></body></html>',
              { status: 503, headers: { 'Content-Type': 'text/html' } }
            ))
        )
    );
    return;
  }

  // JS/CSS strategy split by URL shape:
  // - /assets/<name>-<hash>.<ext>  → CACHE FIRST (hash is the version, content
  //   is immutable; once cached, never re-fetch unless cache miss). This was
  //   the load-time killer: every launch spent seconds re-validating already-
  //   cached vendor + index chunks against the network before falling back.
  // - Anything else (e.g. /sw.js itself if accessed as a script) → network
  //   first with cache fallback (preserves the old behavior for non-hashed
  //   resources that DO change content for the same URL).
  if (url.pathname.match(/\.(js|css)$/)) {
    const isHashedAsset = url.pathname.startsWith('/assets/');

    if (isHashedAsset) {
      // Cache-first — return immediately if we have it, only hit network on miss.
      event.respondWith(
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request)
            .then((response) => {
              // Poison guard: a deploy-removed chunk hash can come back as a
              // 200 text/html SPA fallback (index.html). NEVER cache or return
              // HTML for a JS/CSS request — that produces the "Expected a
              // JavaScript-or-Wasm module … MIME type text/html" execution
              // error and, if cached, persists it. Surface a 404 so the
              // dynamic import rejects and lazyRetry reloads the fresh bundle.
              const ct = response.headers.get('Content-Type') || '';
              if (ct.includes('text/html')) {
                return new Response('', { status: 404, statusText: 'Stale chunk (HTML fallback)' });
              }
              if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, clone);
                  trimCache(CACHE_NAME, MAX_CACHE_ENTRIES);
                });
              }
              return response;
            })
            .catch(() => new Response('', { status: 503, statusText: 'Offline' }));
        })
      );
      return;
    }

    // Non-hashed JS/CSS → network first
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Same poison guard as the hashed branch — never cache/return HTML
          // for a JS/CSS request (see v716 note).
          const ct = response.headers.get('Content-Type') || '';
          if (ct.includes('text/html')) {
            return caches.match(event.request).then(
              (cached) => cached || new Response('', { status: 404, statusText: 'Stale chunk (HTML fallback)' })
            );
          }
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              trimCache(CACHE_NAME, MAX_CACHE_ENTRIES);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || new Response('', { status: 503, statusText: 'Offline' })))
    );
    return;
  }

  // Images, fonts, etc. — cache first (these rarely change for same filename)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              trimCache(CACHE_NAME, MAX_CACHE_ENTRIES);
            });
          }
          return response;
        })
        .catch(() => new Response('', { status: 503, statusText: 'Offline' }));
    })
  );
});

// ─── Background Sync ────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-sync-push') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SYNC_PUSH_REQUESTED' });
        });
      })
    );
  }
});

// Listen for messages from the client — verify source is a controlled WindowClient
self.addEventListener('message', (event) => {
  // Only accept messages from controlled clients (same-origin guarantee)
  if (!event.source || (event.source.type !== undefined && event.source.type !== 'window')) {
    return;
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    self.registration.update();
  }
  if (event.data && event.data.type === 'REGISTER_SYNC') {
    if (self.registration.sync) {
      self.registration.sync.register('offline-sync-push').catch(() => {});
    }
  }
  // PRECACHE_TILES message retired 2026-04-29 — clients that still send
  // it (older PWA bundles) are silently ignored.
  // Clean unregister — clear all caches and unregister SW (troubleshooting)
  if (event.data && event.data.type === 'UNREGISTER') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
    );
  }
});
