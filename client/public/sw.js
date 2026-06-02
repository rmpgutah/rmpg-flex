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
//       formatted incident types (toDisplayLabel). Map <-> Dispatch/RMS.
// v703: cache-invalidation catch-up. PR #893 (CSP eval fix + 1,984-control a11y
//       id sweep) and PR #894 (warrants self-clear fix) both merged AFTER v702
//       was already deployed, and #893's web-UI conflict resolution kept v702 —
//       so clients holding the v702 cache would never pull the merged bundle
//       (the <meta> CSP fix that unblocks eval, the form-field ids, the warrant
//       fix). Bump forces every client onto the current code.
// v704: Phase 4+5 — (4) Dispatch Here gains "Assign nearest available unit"
//       (auto-assigns closest unit via /dispatch/calls/:id/auto-assign after
//       create; no-op until units on duty). (5) Activity choropleth gains a
//       Calls/Incidents data source — Incidents source bins RMS incident
//       points over the geography (fetched on demand). Map <-> Fleet/Dispatch/RMS.
// v705 — Unit subsystem audit (PR #896): (1) live-sync — revive the dead
//        'unit_update' WS channel by re-fanning dispatch_update unit actions +
//        new Worker broadcasts on status/assign/unassign/dispatch/create/update/
//        delete/GPS. (2) 19-bug audit — align UnitStatus to the 7 live-DB
//        statuses (removed 'on_patrol', which the units CHECK rejects); board
//        Assignment column (current_call_number alias); out_of_service sort +
//        sentinel-status LED fallback; unitRecommendation hasGps sentinel/zero
//        coercion; map nav-cursor heading arrow + speed via units.gps_heading/
//        gps_speed (migration 0065). Worker: PUT /units allowlist, dead
//        /units/assign-unit removed, assign/dispatch prior-call cleanup +
//        call-status + last_status_change, aggregates 'busy' committed count.
// v706: Fix bottom-left overlay collision — the unified Legend AND the
//       turn-by-turn nav banner were pinned at left:12/16 and sat UNDER the
//       open LAYERS panel. Both now shift right of the panel
//       (clamp(160px,14vw,200px)+24) when it's open and return to the edge
//       when collapsed, matching the other map overlays; they stack cleanly
//       when navigation is active.
// v707: LAYERS panel — Intelligence / Analysis / Tactical groups are now
//       collapsible (click the section header to fold), persisted across
//       sessions (rmpg_map_collapsed_sections). Lets the operator keep the
//       panel compact alongside the already-collapsible Map Style / Spatial
//       Layers / Statewide Data / Advanced Tools sections.
// v708: Statewide data visual upgrade — (1) address points now color-coded by
//       structure/property type (Residential/Commercial/Industrial/Agricultural/
//       Mixed/Other via PtType); (2) roads keep class color codes (+ Ramp);
//       (3) both ALWAYS load — gates lowered to the archive min zoom (roads z6,
//       addresses z10) so they no longer vanish when zoomed out; legends
//       updated. Click still populates full point detail.
// v709 — Unit management: admin can now DISPOSE units (retire = soft
//        out-of-service keeping history, or delete = permanent) — both
//        force-clear a stale call assignment server-side, so units stuck on a
//        call (the old delete refused them) can finally be removed; the board
//        dispose button shows for admins regardless of call state. Unit
//        create/edit modal gains setup fields: vehicle, default beat,
//        capabilities (K9/SWAT/Supervisor/FTO/Traffic/Detective/Patrol), audio
//        mode. Unit create/update/delete/dispose + GET now route to the
//        rewrite (env.API) so the new fields persist + the hardened handlers run.
// v710: FIX — Fleet detail page wouldn't scroll. The vehicle-detail tab panel
//       (FleetDetailPanel) is a single overflow-y-auto scroller, but 7 of the
//       tabs (Overview/Fuel/Costs/Inspections/Assignments/Personnel/Analytics)
//       also declared `flex-1 overflow-y-auto` on their own root — a nested
//       zero-range scroll container that trapped trackpad gestures and never
//       chained out to the real scroller. Stripped the redundant inner
//       overflow so the panel is the single scroll owner for all tabs
//       (Tires/Damage/Recalls already relied on it). SW bump also clears any
//       stale cached bundle.
// v711: Dispatch surfaces (call cards, detail read-view, call PDF) now show
//       the SHORT dispatch code only (e.g. "SLA-A2"); the full Area/Section/
//       Zone/Beat names remain on the Map UI (What's Here + hierarchy labels).
// v712: Advanced GPS navigation — the map directions module gains spoken
//       turn-by-turn (distance-gated pre-alert + "now" cue), CAD-unique
//       hazard-ahead alerts (active calls on the path ahead, voice + banner),
//       arrival detection, audible reroute, a mute toggle, maneuver arrows,
//       and a "then …" next-maneuver preview. New useNavGuidance hook +
//       voiceAlerts nav phrases; useMapRouting now exposes route geometry.
// v713: Map perf — eliminate the ~1–2s main-thread freeze (Chrome
//       "'setTimeout' handler took ~2000ms") when toggling Area/Section/Zone
//       layers. The hierarchy labels no longer @turf/dissolve all ~770 beat
//       polygons (geometry that was never drawn); they now anchor one label
//       per level on its largest member beat in O(n). Fill coverage unchanged.
// v714: FIX — auto-update force-reloaded the page mid-work, wiping unsaved
//       edits ("changes lost / functions reset / app goes back"). The repo
//       deploys many times/day; WebUpdateBanner reloaded unconditionally ~2s
//       after detecting any new bundle, ignoring the hook's focused-field
//       guard. Now reloads only when SAFE (no focused input/contenteditable,
//       no open modal/dialog) and retries every 4s until safe — so updates
//       still land within seconds of pausing, without clobbering in-progress
//       data entry. Reload authority centralized in WebUpdateBanner (the hook
//       no longer races it).
// v715: FIX — Fleet Analytics showed $0 costs / "--" MPG / empty Fuel-Economy
//       trend / "No cost data" despite real data. The /fleet/analytics summary
//       read STALE materialized rollup columns (total_fuel_cost/avg_mpg) on
//       fleet_vehicles that are never updated on fuel log; now aggregated LIVE
//       from fleet_fuel_log + fleet_maintenance (verified: $3,200.35 fuel,
//       13.5 MPG, $238.96 maint). fuel_economy_trend.avg_mpg computed per month
//       (was hardcoded NULL); cost_per_mile_ranking ("Top Vehicles by Cost")
//       now populated (was hardcoded []). Also: fuel-report PDF now includes
//       an Odometer column per fill (was missing entirely; reads
//       odometer_reading ?? raw odometer).
// v716: Dispatch dispositions are now SHORT-CODED (detailed but terse) —
//       general patrol dispositions use mnemonics (RTF/GOA/ARR/CIT…), process-
//       service CFS use PS/### in increments of 5 (anchored on the live
//       PS/055=Personal/Individual). Selection dropdowns show "CODE — Description";
//       output surfaces show the CODE only (description on hover) with a chart
//       color badge. Full 39-code chart seeded to system_config. Also restored
//       A/S/Z/B as a SHORT-code Section/Zone/Beat chip (e.g. "SL1/HER/A1") on the
//       CFS card + detail — long Area›Section›Zone›Beat NAMES remain strictly on
//       the Map UI ("What's Here").
// v717: Statewide DB always-on — Utah roads + address points default visible
//       (auto-enabled on map ready; toggleable in-session, returns at load).
// v718: Plain-language record TYPE is now mandatory output everywhere — shared
//       recordTypeLabel() (map + humanize fallback, never a raw code) feeds the
//       Connections graph legend/node tooltips, the link picker chips, and the
//       record-delete dialog; getEntityLabel delegates to it. (PDFs already
//       title each record by its plain type.)
// v719: fix CrmPage hard crash — toDisplayLabel()/.replace on an undefined
//       status/type/relationship/source field threw "Cannot read properties of
//       undefined (reading 'replace')" and the ErrorBoundary took the whole
//       /crm page down (live sweep 2026-06-02). Null-guarded the helper + the
//       lead-source label.
// v720: Records/RMS audit — VehiclesTab no longer falsely flags non-stolen
//       vehicles as STOLEN. isActiveStolen() now matches ONLY a confirmed
//       'Stolen' status (was flagging everything ≠ None/Recovered, so Not
//       Stolen / Unknown / Cleared / Under Investigation all showed a false
//       STOLEN badge + posture ring); list badge, counts, filter, and ring all
//       unified on the helper. (Pairs with worker-side records/nibrs fixes:
//       person warrant lookups key on subject_person_id; evidence INSERT/PUT/
//       search use real columns; NIBRS uses occurred_date.)
// v721: occupant cross-reference on the New Call premise check — PremiseHistory
//       also fetches /dispatch/address-occupants and renders persons on file at
//       the address with active-warrant / gang / caution flags, a blinking
//       FLAGGED AT ADDRESS banner, and the alert tone.
// v722: Serve Intake — folder drops now upload. dataTransfer.files is empty for
//       a dropped FOLDER; read the contents via webkitGetAsEntry() recursively
//       (filesFromDrop). Raised the per-upload file cap 12→30 so a whole job
//       packet (Field Sheet + Info Form + Court Docket + Summons + scanned-page
//       rasters) goes through in one drop.
// v723: Serve Intake drop zone — gold drag-active highlight ("RELEASE TO ADD
//       DOCUMENTS") so a drag gets a visible response, + window-level dragover/
//       drop guard so a stray drop just outside the zone (common in the Electron
//       shell) no longer navigates/loses the files.
// v724: Dispatch address autofill for TYPED addresses. Previously cross-street
//       + section/zone/beat only filled when you PICKED an autocomplete
//       suggestion; typing an address and tabbing away left them blank. Now on
//       blur the field resolves from the best Mapbox suggestion (or, if none, a
//       normalized server geocode — "4974 S Redwood Rd" → "South Redwood Road")
//       and fills coords + cross-street + A/S/Z/B. Wired in the dispatch call-
//       edit panel and the New Call modal.
// v725: Unit status board "No GPS" fix — the location cell keyed off the
//       optional text `location` field, so a unit reporting LIVE coordinates
//       (browser/device GPS, no reverse-geocoded address) falsely showed
//       "No GPS" even though it's on the map. Now shows the live coords (+ age)
//       whenever lat/lng are present; "No GPS" only when there's truly no fix.
const CACHE_NAME = 'rmpg-flex-v725';
const MAX_CACHE_ENTRIES = 500; // Limit main cache to prevent unbounded growth
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png',
  '/rmpg flex.png',
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
