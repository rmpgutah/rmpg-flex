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

// v1047: Intel Portal (/intel/*) — Page 30 of the full-app frontend pass,
//        applied to the multi-route command-center shell (IntelPortalLayout
//        + IntelDashboard + BoloBoard + IntelSearch + the supporting widgets).
//        Same v1024–v1038 court-ready / native-dialog / deep-link contract
//        applied so the most-used intel surfaces match the rest of the app.
//
//        What changed:
//          • IntelSearch — `/intel/search?q=…` URL deep-link hydrates the
//            input on mount and mirrors the live query into the URL (replace,
//            no history spam). Lets dispatch paste a link to a unit's MDT
//            and have it land pre-filtered. Esc smart-cascade clears facet
//            filters first (smallest-open), then the query — matches the
//            Court Tracker / Cases / Trespass cascade. Distinct empty
//            states ("typed nothing" vs "no matches" vs "no matches with
//            active facets"); audit caught operators staring at "no
//            results" without having typed.
//          • SearchBar — replaced `window.prompt('Name this search:')`
//            (the last native dialog on the page) with an inline themed
//            popover (Star button toggles it). Native prompts can't be
//            themed, can't be Esc-cascaded, and tank the dashcam HUD on
//            iPad/MDT (same finding as v1024–v1037 across other pages).
//          • BoloBoard — Cancel BOLO (admin-only, removes the row) now
//            goes through ConfirmDialog with row context (number, title,
//            priority, subject/vehicle). Previously fired DELETE on click
//            with zero confirmation — a misclick erased an active critical
//            alert. New `/intel/bolos?bolo_id=<id>` deep-link direct-fetches
//            (uses existing GET /comms/bolos/:id), highlights the card, and
//            surfaces a banner card for resolved/expired BOLOs so a court-
//            attached link doesn't dead-end. "N" keyboard shortcut opens
//            New BOLO (typing-suppressed). Esc smart-cascade for the
//            confirm + create modals. Distinct empty state — was a flat
//            "No active BOLOs." line indistinguishable from a server error.
//          • IntelDashboard — `/intel?entity_id=42&entity_type=person&label=…`
//            deep-link auto-selects the entity in the right context panel
//            (opens dossier peek). LIVE indicator now flips amber + STALE
//            label if the shared overview poll has gone >60s without an
//            update — was previously a static green dot regardless.
//          • IntelPortalLayout — `bg-black` literal → `bg-surface-base`
//            token so the shell re-themes with day/night palette.
//          • IntelContext — panel-collapsed flag is now scoped per-user
//            via the new `rmpg-intel-panel-collapsed-<id>` key. Intel
//            data is the most sensitive surface in the app; a shared-
//            device login inheriting the prior user's portal layout
//            state was a small but real privacy leak. AuthContext now
//            exports the raw context so optional consumers can read it
//            without forcing an AuthProvider wrapper in unit tests.
//          • Emoji → Lucide on the dashboard chrome: 🚗 in BoloCard's
//            TYPE_ICON (→ Car/User/Flag Lucide), 🚗 in PlateSightingsWidget
//            title (→ Car), and the Cancel-BOLO action gets a real red-
//            400 token instead of a hand-rolled hex.
//          • WidgetFrame `title` widened from `string` → `ReactNode` so
//            widgets can lead with an icon + label without smuggling a
//            glyph into the string.
//          • 18 hardcoded hex literals across the in-scope files lifted
//            to tokens — #888 → text-rmpg-400/500, #d4a017 → text-brand-
//            400/600, #ff6b5e → text-red-400, #f0c050 → text-amber-300,
//            #040404 → bg-surface-base.
//          • Tests: BoloBoard test expanded with the confirm-dialog
//            interaction + empty-state assertion (3 cases vs the prior 1).
//
//        Out of scope (deferred — the multi-route portal is too large
//        for one PR):
//          • IntelReportDetailPage still has 4 native prompts (share /
//            recall / reject) and is intentionally NOT touched in this PR.
//          • IntelMapPage, IntelAiAnalyst, AlertsSection, WatchlistSection,
//            ReviewQueues, IntelReportsPage, NewIntelReportPage, IntelSources
//            — fix-in-place when their dedicated audit page lands.
//          • IntelRail / IntelContextPanel still use dingbat-style glyphs
//            (◈, ◉, ⚑, ⌕, ▦, ▲, ⛓, ◎, ✦, ▤, ⚐, ✨, ☆, ★). These are
//            monochrome BMP characters, not full-color emoji — they render
//            consistently with the steel-blue theme. Replacing them with
//            Lucide would require a layout-affecting size pass on every
//            row, deferred until the rail itself is up for review.
//
// v1048: Process Server / Serve Scheduler — Page 31 of the full-app
//        frontend pass. ServePage.tsx (1801 lines) is the operational
//        hub (Queue + Route + Map + Stats + Assign + My Run tabs) and
//        ServeSchedulerPage.tsx is the swim-lane scheduler; both are
//        court-critical because every attempt row feeds the
//        Affidavit-of-Non-Service / Notice-of-Attempt PDFs.
//        - URL deep-link contract: /serve?job_id=<n> expands a card on
//          the Queue tab (with a "not in this view" toast + filter hint
//          on miss); /serve?status=<filter> applies a status filter;
//          /serve?tab=<Queue|Route|Map|Stats|Assign|My Run> preselects
//          a tab; /serve?date=YYYY-MM-DD preselects the date picker.
//          All four params are consumed once and stripped (replace:true)
//          so a manual refresh doesn't re-pin the operator to a stale
//          deep-link.
//        - Kill native dialogs: replace window.confirm + window.alert in
//          handleDeleteJob (court-record delete — destructive, was using
//          a raw browser confirm that bypassed our keyboard-trap / a11y
//          model and broke the day/night surface) with ConfirmDialog +
//          useToast. ServeSchedulerPage's two drag-drop error alerts
//          become toasts (a modal would steal focus from the next drop
//          the operator queued up).
//        - Esc smart-cascade: delete confirm → log-attempt modal →
//          edit-attempt modal → skip-trace panel → route planner →
//          create/edit job. Previous handler only closed the
//          create form. The scheduler gains its own Esc → close the
//          Rebalance preview.
//        - N shortcut: open Add Job from anywhere on the Queue (or
//          any non-modal surface). Suppressed when typing into an
//          INPUT/TEXTAREA/SELECT/contentEditable (a recipient name
//          with "n" in it must not pop the dialog mid-type) AND when
//          any modal already owns the page. Title hint added to the
//          Add Job button ("Add Job (N)").
//        - Emoji chrome → Lucide: error banner ⚠/✕ → AlertTriangle/X;
//          priority-sort toggle ⚡/↕ → Zap/ArrowUpDown.
//        - Empty-state distinction: when jobs.length > 0 but
//          filteredJobs.length === 0, render "No <filter> jobs match
//          this filter" + a "Show all N jobs for this date" reset
//          button. Before, both "queue truly empty" and "filter hiding
//          everything" rendered the same generic copy and an operator
//          with a stale ?status=failed deep-link could not tell which.
//        Memory checks confirmed already-shipped:
//          * GPS + photo capture on attempts (ServeAttemptModal lines
//            172-186, 698-740): present and court-grade.
//          * Affidavit + Notice-of-Attempt PDFs (handleGenerateAffidavit
//            + handleNoticeOfAttempt): present; we did NOT re-implement
//            them (memory [[project-serve-intake-upgrades]] flags the
//            5-prior-PR duplication trap).
//        Deferred: useFormDraft storage key `rmpg_serve_job_form` is
//        unscoped (no user-id suffix), so on a shared device any draft
//        with PII leaks across operators. Same pattern across 8 other
//        pages — needs a system-wide useFormDraft scoping change, not a
//        Page-31 fix. No D1 migration, no worker change.
//
// v1034: Law Book — add cross-page URL deep-link contract (13th page in
//        the sweep): /law-book?statute_id=<id> | /law-book?citation=76-5-102
//        direct-fetches the statute via /statutes/section/:citation (with
//        a /statutes/search?id= fallback when only the internal id is
//        known), loads its containing chapter so siblings are visible,
//        auto-opens the section, and strips the param so a hard refresh
//        doesn't re-trigger. Worker side: /statutes/search gains an `id`
//        query short-circuit. New per-user "Recent Statutes" card on the
//        landing overview (`rmpg_lawbook_recent_<user.id>`, capped at 8,
//        with a Clear button) — operators re-read the same handful of
//        statutes constantly (DUI, assault, trespass) and the prior
//        landing forced a fresh category click every time. Esc smart-
//        cascade: open section → clear search → reset to browse
//        (suppressed while typing in an input so native form-clear
//        semantics stay intact). Empty-state distinction: search-with-
//        nothing-matching now shows the actual query/severity in the
//        message ("No statutes match \"foo\"") instead of the generic
//        "No statutes match" that read the same as the chapter-empty
//        state. Theme: 14 hardcoded hex literals lifted to tokens —
//        #d4a017 → var(--brand-gold) (4 sites), #888888 → var(--spm-
//        text-muted) (4 sites), 4 stats-ribbon accents → --sev-* tokens,
//        Criminal Procedure category accent → var(--brand-gold). Kept
//        #0a0a0a as a non-theme contrast literal on the active gold
//        button (text-on-gold legibility, same convention as Cases v1028
//        keeping #fff on filled chips). No new PDF — statutePdfGenerator
//        already covers section + chapter prints (recon confirmed; would
//        have been the 5th PDF-duplication trap if blindly added).
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
// v954: OCR trust layer + per-vehicle capture dossier (honest TrustBadge replaces
//       self-reported %, derived trust gates) on top of main v953.
// v955: FlexCam Phase 2 evidence UI (lock badge + custody + court-package) on top of main v954.
// v956: ALPR full audit & harden — /edge stolen-hit notifications + sightings,
//       honest capture status (no fake success:true), capture_id idempotency,
//       guarded R2/JSON, real vehicle_count, schema reconciliation across
//       capture/edge/clearpath/footage, client overlay/upload/dossier fixes.
// v957: Geospatial Intel Map — /intel/map Mapbox layers (sightings/calls/incidents/
//       FI/warrants/trespass), geocode cache-first, click→dossier panel.
// v958: Intel report loop — linked entities + dissemination log + external share
//       on report detail; dossier auto-links its subject into a new report.
// v962: Spillman Records — form-tab strip extended to ALL record types (was
//       persons-only) + prune-dead-tabs; also wires business selection into the
//       detail panel (was unreachable: hasSelection had no business clause so the
//       right panel never opened) + real business tab count.
// v964: system-wide theme — desktop-shell/toolbar/grid chrome vars follow
//       day/night; day color-scheme light; warm day hover.
// v973: Redaction Studio — self-host BlazeFace weights at /models/blazeface/*
//       (load() modelUrl) so face auto-detect no longer hits tfhub.dev (CSP-
//       blocked); surface a warning when the face model fails to load.
// v974: Spillman chrome kit (P0) — new client/src/components/spillman/* bundle
//       + global spillman-kit.css imported in main.tsx.
// v975: NCIC/NLETS data codes — coded terminal output + QZ decoder + code-aware QV.
// v976: NCIC comprehensive code tables + printable operator reference guide PDF.
// v977: theme consistency PR0 — global chrome tokens + light-mode menu fix.
// v978: theme sweep — DashboardPage hex → tokens (day/night flush).
// v979: record icon tiles — steel-blue glyph tiles (person/vehicle/building) +
//       type-based icons + corner condition tabs across Records lists & heroes.
// v980: Business unified onto canonical `businesses` table (CRUD repointed +
//       archive/unarchive/delete routes + delete endpoint wired).
// v983: Deep Research — stop the job poller spamming 404s after a job is
//       deleted/gone (loadDetail now stops on 404 + clears the stale selection).
// v985: Bug-fix batch + fallback assist — Arrest Records summary counters (was
//       0 vs 626) now from arrest_records; Intel AI Analyst degrades to free
//       Workers AI when Claude is out of credit (no more 502) + "FREE FALLBACK
//       AI" badge; Plate Log dashcam "reads" counts alpr_captures; Jail Mgmt
//       links to the scraped Arrest Roster.
// v987: God Mode "Reassign Calls" — repoint to /dispatch/calls/bulk-reassign
//       (dead /admin path 404'd), dropdown now targets a UNIT (sends unit_id),
//       handler fix (call_sign lookup + `target` in response for the toast).
// v988: stop 404 / chunk-load failures from freezing the whole app — bounded
//       reload-hold (chunkRetry) surfaces the ErrorBoundary recovery card
//       instead of a permanent button-less Suspense splash; plus an automatic
//       UI-trap watchdog that auto-recovers orphaned full-screen overlays.
// v989: record/CFS rendering fixes — PDF form cells shrink long values to one
//       line (fitTextToWidth) instead of wrapping past the cell and overprinting
//       the next row (CFS location-map grid); person record two-column identifying
//       marks reserve their row to avoid a page break splitting the columns;
//       on-screen RecordField wraps long values (break-words/min-w-0).
// v990: PDF report header treatment — section/hero/table header bars softened
//       from solid black to dark grey (#333); sub-heading text on those bars
//       (descriptor/address/labels) set to light-medium grey (#b8b8b8) via new
//       TEXT_SUBHEAD_INVERTED token; primary titles stay white. Section headers
//       keep their text+underline style (unchanged).
// v991: Full-drive footage — extend on-demand chunk TTL from 30 min → 12 h;
//       widen poll window to catch chunks that land outside the initial window.
// v992: Full-drive UI — detect trips with 0 clips downloaded (was wrongly
//       showing green "Ready"); add per-trip Retry button and job-level
//       "Retry All Failed Trips" button; fix updated_at column bug in retry
//       endpoint (cpg_drive_job_trips has no updated_at); bulk-reset missing
//       chunks back to pending_request so cron re-downloads them.
// v993: Full-drive clip playback — fix 401 on <video> src; auth middleware
//       now accepts ?token=<jwt> on /full-drive/clip/* paths; client appends
//       JWT from localStorage to all streamUrl values before passing to <video>.
// v1003: FlexCam repair — POST /flexcam/footage/:id/repair resets missing chunks
//        back to pending_request and reopens request to fulfilling so the cron can
//        retry. REPAIR button surfaces on partial trips in FlexCamPage (list) and
//        FlexCamFootagePage (player evidence bar). Fixes Rules-of-Hooks violation:
//        keyboard-shortcut useEffect was declared after early returns (triggered
//        "rendered more hooks" crash when error/loading state changed).
// v1002: FlexCam enhanced player — skip ±10s buttons, speed toggle (0.25–2×),
//        keyboard shortcuts panel (?), CAPTURE FRAME button (canvas burn + evidence
//        stamp JPEG download), video HUD overlays (live timestamp / REC / rate /
//        evidence watermark, togglable), improved "No events detected" fallback
//        with RE-SCAN button and contextual messaging.
// v1001: FlexCam auth-link fix — MANIFEST download button in FlexCamFootagePage
//        and Download icon in FlexCamPage were bare <a href="/api/..."> links
//        that sent no JWT, returning 401. Both converted to buttons that use
//        apiFetch → blob → URL.createObjectURL → a.click() for authenticated
//        JSON manifest download. Same pattern as the markers rebuild fix (v1000).
// v1000: FlexCam reconfigure button — stops playback, revokes all cached blob
//        URLs, resets state, and re-fetches fresh request data so the officer
//        can restart without leaving the page. Markers rebuild fixed to use
//        apiFetch (JWT header) instead of a bare <a> link (auth 401).
// v999: FlexCam clip-to-clip fix — generation counter prevents stale async
//       playSegment() chains; drop video.load() (implicit load via src= is
//       enough; explicit load() re-fires 'ended' at end-of-clip = repeat bug);
//       use canplay + readyState guard; pause() before src swap for clean
//       play-promise teardown; MDT player + list pages (SW v998 squashed).
// v1035: Trespass Orders — Page 18 of the full-app frontend pass. The
//        trespass order IS a court document (it's what gets handed to
//        the subject AND what gets attached to the case file when the
//        order is violated and arrest follows), so the operator-artifact
//        upgrade matters more here than on most pages.
//        - New client/src/utils/trespassOrderPdf.ts — pure-client jsPDF
//          generator using the same Arial + RMPG-gold banner idiom as
//          fiCardPdf (#1597), clearedSummaryPdf (#1583), shiftReportPdf
//          (#1587), and the chain-of-custody PDF (#1603). Status-aware
//          banner color (red ACTIVE/VIOLATED, amber SERVED, gray
//          EXPIRED/LIFTED), expiration callout with "(N days remaining)"
//          for active orders within 30d, signature block that swaps the
//          right-hand line between subject-acknowledgement (active/
//          served) and supervisor-review (closed). Pure helpers
//          (wrapText / expirationLine / bannerStyleFor) covered by 16
//          new vitest cases. "Print" lands on the detail-panel toolbar
//          AND the right-click context menu.
//        - Native confirm() → ConfirmDialog. Admin hard-delete used the
//          browser confirm() — no a11y, no keyboard polish, no way to
//          show the operator WHAT they were about to wipe. Renders
//          order number + subject + status + property as `details` so
//          the row context is visible at decision time.
//        - /trespass-orders?order_id=<id> URL deep-link with auto-select
//          on hydrate, query strip on apply, and direct-fetch fallback
//          for ids outside the current archive / status filter view
//          (e.g. an expired order linked from a case file). 13th
//          consecutive page to honor the Dashboard-emit / page-consume
//          contract.
//        - Esc smart-cascade: orderToDelete → expirationCalendar →
//          bulkMode → formOpen. Previous handler hard-closed the form
//          on every Esc, so an operator dismissing the expiration
//          calendar above the form lost their draft as a side effect.
//        - `N` opens a new order from anywhere on the page (mirrors
//          Dispatch / Patrol / FI / Evidence). Suppressed while typing
//          into input / textarea / contenteditable.
//        - 3-way empty state distinction: "no archived orders" vs
//          "no matches in current view" (with Clear-filters CTA) vs
//          "no orders ever — create one". Same lift as Warrants #1608.
//        - Theme tokens: text-[#d4a017] (4 sites) → text-[var(--brand-
//          gold)]; rgba(212,160,23,0.25/0.5) submit-button background
//          → rgb(var(--brand-gold-rgb) / 0.25); rgb hex inline colors
//          (#f59e0b/#22c55e/#a855f7 on Serve/Lift/Violated buttons) →
//          --sev-warn/--sev-ok/--sev-special tokens; #1a1500 restored-
//          draft banner → rgb(var(--sev-warn-rgb) / 0.08) (same lift as
//          Patrol PR #1595 + Field Interviews PR #1597).
//        - Dead-import cleanup: Archive icon imported but never used;
//          TrespassOrderStatus type imported but never referenced.
// v1033: National Warrant Search — court-ready single-result PDF
//        (Arial banner, active-warrant alert bar, subject + warrant +
//        charges blocks, verification URL block, two-signature block);
//        replaces "right-click → Copy charges" as the path to a hand-off
//        / extradition package. Adds a Print button on each result row +
//        an "Open court-ready PDF" item at the top of the row context
//        menu (so it's the first action, ahead of Copy). New
//        /national-warrants?last_name=&first_name=&dob=&state=&
//        offense_level=&warrant_type=&charge_keyword=&auto=1 URL deep-
//        link (13th consecutive page to honor the contract) — params
//        hydrate the form and `auto=1` fires the search on mount, then
//        every deep-link param is stripped via setSearchParams(replace)
//        so the URL is portable + doesn't leak the subject's PII into
//        copy-pasted links. Theme: 8 hardcoded coverage-map hex values
//        (#166534/#22c55e/#15803d/#86efac for active, #78350f/#f59e0b/
//        #92400e/#fcd34d for pending) → semantic --sev-ok-*/--sev-warn-*
//        tokens via new coverageTextColor() helper, so the day/night
//        skin re-themes both the SVG cells AND the legend AND the
//        tooltip-status text in lockstep. No new migration.
// v1028: Cases — kill the last 4 native window.prompt / window.confirm
//        calls in the page (save-view name, delete-note, close-readiness
//        gate, submit-for-review gate). Readiness gates now render the
//        missing-fields list as a proper bulleted list instead of \n-
//        joined plain text inside a native confirm. Adds /cases?case_id=
//        URL deep-link (11th consecutive page). Esc cascade extended to
//        cover all 7 modal states (was hard-coded to only form + return
//        modal; linkPerson silently ignored). Theme: 8 hex chart-color
//        literals → semantic --sev-* tokens. The page already has a
//        full v2 case-report PDF (caseReportGenerator.ts) — no new PDF
//        utility added.
// v1024: Field Interviews — court-ready single-FI PDF (Arial banner,
//        active-warrant alert bar, subject/contact/narrative blocks,
//        signature block); replaces "screenshot the detail panel" as
//        the supervisor-review / court-package path. New
//        /field-interviews?fi_id= URL deep-link, 7th consecutive page
//        to honor the contract. Replaces if(!confirm(...)) for admin
//        hard-delete with the existing ConfirmDialog component (the
//        last native-confirm holdout in this page). Repeat-contact
//        warning banner now has a "View previous contacts →" link
//        that closes the form and pre-fills the search input — the
//        detection logic existed since 2026 but no operator action
//        path. Adds `N` keyboard shortcut for opening a new FI (mirrors
//        Dispatch). Theme: warrant-banner ⚠️ emoji → Lucide
//        AlertTriangle; restored-draft #1a1500 → rgb(var(--sev-warn-rgb)
//        / 0.08) (same lift as Patrol PR #1595).
// v1044: Communications — Page 27 of the full-app frontend pass. The
//        Communications Center (/communications, threaded inbox + BOLOs +
//        activity feed) lacked the cross-page contract the recent court-
//        record pages (Field Interviews #1597, Evidence #1603, Cases
//        #1604, Warrants #1608, Trespass Orders #1610, Court Tracker
//        #1613, Offender Registry #1614) all honor.
//        - New client/src/utils/conversationTranscriptPdf.ts —
//          "Conversation Transcript" PDF with RMPG-gold banner,
//          priority-aware alert bar (emergency=red, urgent=amber, normal=
//          no bar), conversation-summary block (subject/participants/
//          channel/message-count/first/last timestamps), per-message
//          chronological block (sender→recipient, priority, read state,
//          word-wrapped body), and a two-signature block (exporting
//          officer + supervisor). Pure helpers (wrapText, highestPriority,
//          participantsOf) covered by 14 new vitest cases plus 5 jsPDF
//          smoke tests (empty thread, very-long-word body, 60-message
//          page-break exercise, broadcast emergency). Same Arial idiom
//          as fiCardPdf / courtAppearancePdf / evidenceItemPdf. "Print"
//          button now sits in the thread-detail toolbar AND the right-
//          click context menu — operators preparing IA or court packages
//          no longer need to screenshot the bubble view.
//        - Native dialogs killed:
//            (a) `window.confirm('Delete this message?')` in the per-
//                message delete button → themed ConfirmDialog with the
//                two-stage requestDeleteMessage / confirmDeleteMessage
//                split landed in #1608, so loading state shows on the
//                button itself instead of a frozen UI behind a blocking
//                modal.
//            (b) `prompt('Emergency broadcast message to ALL units:')`
//                on the toolbar → FormModal with a red audit-warning
//                banner ("This message will go to every active unit. It
//                is logged as an EMERGENCY-priority broadcast and
//                audited."). The previous native prompt() lost the
//                message text on a misclick outside the prompt and gave
//                no way to revise.
//        - URL deep-link contract — /communications?thread_id=<id> auto-
//          opens the thread once messages hydrate and marks it read;
//          ?message_id=<id> finds the containing thread and scrolls the
//          specific message into view; ?bolo_id=<id> switches to the
//          BOLOs panel and pulses a ring around the row; ?tab=
//          messages|bolos|activity forces a panel on mount. Every query
//          param is stripped after consumption (window.history.replace
//          via the existing newBolo idiom) so a refresh doesn't re-
//          trigger. The pre-existing ?newBolo=1 contract is preserved.
//          22nd consecutive page-pass on the deep-link contract.
//        - Right-click context menu on conversations gained "Print
//          transcript" (top, with Printer icon) and "Copy deep-link"
//          (so a dispatcher can paste a thread URL into another chat /
//          incident note).
//        - Esc smart-cascade — closes the top-of-stack layer first
//          (emergency-broadcast modal → delete-message confirm → cancel-
//          BOLO confirm → compose modal → new-BOLO form → selected
//          thread → search query). Previously there was NO Esc binding
//          at all on this page — the only escape was clicking the X on
//          each modal individually.
//        - `N` shortcut — opens Compose on the messages tab and the New
//          BOLO form on the BOLOs tab. Typing-suppressed (input/textarea/
//          select/contenteditable) and modal-suppressed (any open modal
//          eats the keystroke). Mirrors the Warrants / FI / Dispatch
//          shortcut from #1597 / #1608.
//        - Empty-state distinction — "No messages yet" (with Compose CTA
//          and an `N` hint) is now distinct from "No conversations match
//          '<query>'" (which surfaces the total thread count + a Clear-
//          search CTA, no Compose). Stops the inbox-onboarding CTA from
//          ambushing an operator who only over-filtered. Same lift as
//          Warrants #1608 and Trespass Orders #1610.
//        - Dead UI removed — the BOLO row rendered `bolo.subject_name`
//          and `bolo.last_known_location` conditionally, but the live
//          `bolos` table schema (verified against migrations/baseline/
//          schema.sql) has no such columns and the worker route SELECTs
//          `b.*` — so those branches NEVER rendered. Removed (kept
//          vehicle_description + subject_description, which do exist).
// v1041: Fleet (/fleet, v2 shell) — Page 24 of the full-app frontend pass.
//        Honors the cross-page URL deep-link contract and seals six
//        recon gaps the FleetShell v2 ship missed:
//          • /fleet/v2/vehicles?vehicle_id=<id> (alias ?fleet_id=)
//            auto-redirects into the path-based /fleet/v2/vehicles/:id
//            detail screen and strips the query so back-button doesn't
//            re-fire. Optional ?tab=<tab> carries through to the detail
//            tab — same shape every other audited page uses.
//          • /fleet/v2/vehicles/:id?tab=<tab> is now URL-driven (sync'd
//            both ways via useSearchParams): paste a court-prep link
//            straight to ?tab=inspections, back/forward navigates tabs,
//            unknown ?tab= values are silently stripped instead of
//            leaving stale junk in the address bar. The Overview tab is
//            the default and clean (no ?tab=overview noise in the URL).
//          • Insights period-storage privacy: the saved-period key
//            `rmpg_fleet_insights_period` was shared across every
//            operator on the same MDT (dispatch ↔ patrol on one
//            terminal — real). Now scoped per user
//            `rmpg_fleet_insights_period_<user.id>` with a one-time
//            read-through migration from the bare key so existing
//            preferences survive. Pattern mirrors LawBookPage's
//            `rmpg_lawbook_recent_<user.id>`.
//          • Dashboard rendered-but-never-fetched fix: the three cards
//            ("Upcoming Service", "Recent Fuel Entries", "Recent
//            Inspections") used to display literal text ("Service items
//            due in the next 7 days") with no API call backing it.
//            Now wired to /fleet/analytics?period=90d +
//            /fleet/overdue-inspections (Promise.allSettled, each cell
//            degrades to '—' on outage). Third card renamed
//            "Inspection Issues" since the count it now shows is
//            overdue + failing, not a recent-activity feed.
//          • NewWorkOrderModal Esc smart-cascade: the modal opened
//            but Esc on the keyboard did nothing — operator had to
//            click X or backdrop. Now Esc closes the modal (blocked
//            during in-flight save so a stuck spinner doesn't strand
//            data) with stopPropagation so it doesn't bubble to the
//            FleetShell.
//          • Theme/emoji cleanup: brand-gold literal `#d4a017` in two
//            recharts <Scatter>/<Bar> fills (recharts can't follow
//            `var(--…)` at runtime — it copies the prop into a
//            generated `<path fill="…">`) now resolved at mount via
//            getComputedStyle(--brand-gold), with the hex as the SSR
//            fallback. `✓` text → `<Check />` Lucide icon in the
//            anomalies all-clear chip; `✕` text → `<X />` Lucide icon
//            in the new-WO modal close button (now also has the
//            aria-label "Close" that was missing). NewWO backdrop
//            switched from inline `rgba(0,0,0,0.6)` to
//            `bg-black/60 backdrop-blur-sm` for theme consistency.
//        No D1 migration, no Worker route changes — client-only.
//        88 fleet/v2 tests still pass; added a user-scoping/migration
//        test for readSavedPeriod and adjusted two existing tests for
//        the new card title + renamed cards.
// v1040: Personnel (/personnel) — kill 6 native window.confirm() prompts
//        + cross-page URL deep-link contract + Esc smart-cascade +
//        `N` keyboard shortcut + theme sweep + user-scoped tab key.
//        23rd consecutive page-pass on the deep-link contract.
//          • Six destructive flows (delete schedule / credential /
//            equipment / body camera / video / time entry) routed
//            through a single shared ConfirmDialog instead of the
//            blocking native modal. Each handler now publishes a
//            { title, message, onConfirm } record to a centralized
//            deleteConfirm state — one dialog instance, one Esc
//            target, one audit point. The body-cam video confirm
//            message also names the chain-of-custody side-effect
//            ("custody record will note the deletion") instead of
//            the generic "this cannot be undone" — operators were
//            unaware deletion was logged, leading them to hesitate
//            on routine purges of duplicate uploads.
//          • Deep-link: /personnel?officer_id=<id> | ?personnel_id=
//            <id> | ?employee_id=<id> all auto-select. Linker
//            surfaces use different names (warrants/incidents use
//            officer_id, HR exports use personnel_id, payroll uses
//            employee_id) — accepting all three means external
//            bookmarks survive without knowing our internal
//            preference. If the target is not in the active view,
//            the page auto-flips to archives and retries (so a
//            terminated officer's link still resolves) before
//            surfacing "not found". Params stripped after select
//            so a hard refresh doesn't re-trigger.
//          • Esc smart-cascade: closes the smallest-open thing
//            first (playing video → editing video → delete confirm
//            → terminate confirm → primary modal → selected
//            officer). The old hard-coded "Esc closes editingVideo
//            only" left every other modal captive to its own close
//            button; opening a credential form on top of an
//            officer selection and pressing Esc dismissed the
//            video preview that wasn't even on screen.
//          • `N` shortcut → New Officer on the Roster tab (mirrors
//            Dispatch / FI / Court / Citations). Typing-suppressed
//            via input/textarea/select/contentEditable check so a
//            "Norman" search query doesn't open the form.
//          • Theme: 3 `#d4a017` literals in DashboardWidgets
//            (HoursTrendCard linearGradient stops + AreaChart
//            stroke) → `var(--brand-gold)` so the Last-7-Days hours
//            chart re-themes between night/day/legacy without code
//            changes. (Recharts SVG resolves CSS custom properties
//            via paint-attr inheritance, verified by render in
//            both palettes.)
//          • Privacy: `rmpg_personnel_tab` localStorage key now
//            suffixed with the user id (DlSearch #1601 / Warrants
//            #1608 pattern). Was the only personnel localStorage
//            key without a per-user suffix — the seven modal form-
//            draft keys auto-discard on submit so they don't carry
//            the same shared-workstation leak, but the last-active
//            tab persisted across users on the same browser
//            (supervisor leaving "Credentials" tab open → next
//            officer's first land on a tab they don't normally
//            use).
//          • False-positive lessons:
//            - Court-ready PDF — DEFERRED on purpose. The page
//              already ships PrintRecordButton in PersonnelDetailPanel
//              (5 server-side report types: Full / Credentials /
//              Training / Equipment / Time). Adding a client-side
//              court-ready PDF here would duplicate that surface
//              and confuse the print menu. The HR-file print path
//              is well-covered.
//            - "Hydrate UI state from server on mount" — already
//              fully wired (fetchCoreData + useLiveSync 'personnel'
//              + per-tab lazy loads). No action.
//            - Personnel-specific completeness checks (certification
//              expiry indicators, training reminders, on-duty roster
//              sync) — already wired: credential alert chip on
//              roster row, expiringCreds count on Credentials tab,
//              roster row LED + Duty Board tab. No gap.
// v1038: Offender Registry (/nsopw, /offender-registry redirect) —
//        court-ready PDF + deep-link + photo embed. 21st consecutive
//        page-pass for the cross-page contract; NSOPW data is now the
//        canonical Sex Offender Registry surface after PR #1599's
//        consolidation, so the page needed parity with the other court-
//        record pages (FI, Evidence, Criminal History, Cases).
//          • New client/src/utils/offenderRegistrationCardPdf.ts —
//            "NSOPW Offender Identification Card" PDF with RMPG-gold
//            banner, classification banner (red CONFIRMED / amber
//            POSSIBLE), photo + subject grid, registered address,
//            offense block, cross-reference metadata + RMPG records
//            linkage, mandatory point-in-time advisory caveat, and
//            two-signature block. Pure helpers (formatSubjectName,
//            formatAddress, classificationBanner, wrapText) covered
//            by 21 new unit tests. Same Arial + signature-block idiom
//            as fiCardPdf / evidenceItemPdf.
//          • Print button on every offender row (search results + new
//            deep-link card) — opens the PDF in a new tab. Best-effort
//            photo embed via fetch→base64 with 5s timeout; failure
//            falls back to a "no photo on file" placeholder.
//          • Deep-link contract: /nsopw?offender_id=<row> loads a
//            single offender straight from /api/nsopw/offender/:id
//            (renders as an "OFFENDER (DEEP LINK)" amber card so the
//            operator knows no name+DOB cross-check was performed).
//            /nsopw?surname=&forename=&dob= pre-fills + auto-runs the
//            cross-reference. The legacy /offender-registry and
//            /sex-offender-registry routes now use a new
//            RedirectKeepQuery wrapper in App.tsx — plain
//            <Navigate to="/nsopw" /> was dropping the search part,
//            silently breaking any old bookmarks with query params.
//          • Empty-state distinction: a "no search yet" hint card now
//            renders when the panel first loads — the existing zero-
//            matches green card was indistinguishable from the never-
//            searched state.
//          • Coverage warning: ⚠ emoji → Lucide AlertTriangle (last
//            emoji on the page).
//          • Dead-imports cleanup: Link2 + IconButton were imported
//            but never referenced. Removed.
// v1043: Dash Cameras (MVR Review Station, /dash-cameras) — Page 26 of
//        the full-app frontend pass. Dashcam clips are statutory court-
//        record material when classified evidence/flagged, but the
//        review page had no print path, the Esc key was wired to only
//        the edit modal, and there was no deep-link contract so
//        cross-page "view this clip" links from cases/incidents had to
//        round-trip through the gallery.
//          • New client/src/utils/dashcamReviewPdf.ts — "MVR Review
//            Card" PDF with RMPG-gold banner, missing-case-link alert
//            (fires red when an evidence/flagged/restricted clip has no
//            case_number and no case link), retention-hold banner, clip
//            field grid, vehicle/officer block, optional location
//            block with GPS + heading, linked-records timeline (alt-row
//            shading, synthesizes a legacy row from case_number when
//            only the column is populated), notes block, and two-
//            signature block. Pure helpers (channelLabel, sourceLabel,
//            formatDuration, formatFileSize, prettyEntityType,
//            needsCaseLinkAlert) covered by 23 new unit tests.
//          • Print button on the detail-panel header — opens the PDF
//            in a new tab. Hydrates the selected clip with joined
//            officer_name/officer_badge + dashcam_video_links rows
//            from /api/fleet/dashcam-videos/:id when a clip is opened
//            (the list endpoint omits them) so the print path always
//            has every field even on a deep-linked clip.
//          • Deep-link contract: /dash-cameras?clip_id=<id> auto-
//            selects the target clip and primes the inline player.
//            Falls through to a direct GET when the clip isn't in the
//            current paged list; the param is stripped after applying.
//          • Esc smart-cascade: smallest-open-first close across
//            videoToDelete → editingVideo → linkingVideo → showUpload
//            → playingVideo → selectedVideo. Previously only
//            editingVideo cleared, so the confirm-delete, upload,
//            link, full-screen player, and detail panel all ignored
//            Escape entirely.
//          • N keyboard shortcut: opens the Upload modal (manager-
//            tier; mirrors the New-X binding on Dispatch / FI /
//            Patrol / Evidence). Suppressed while typing into any
//            input / textarea / select / contenteditable.
//          • Empty-state distinction: filtered-out vs nothing-uploaded
//            now show different copy + a "Clear filters" button on
//            the filtered case, so an operator with active filters
//            doesn't waste time troubleshooting an upload.
//          • Tactical-dark HUD overlays preserved — the channel/REC
//            indicators stay on dark surfaces regardless of day/night
//            theme (memory: tactical surfaces always dark).
// v1037: Court Tracker — court-ready appearance prep PDF (Arial banner +
//        countdown/imminence alert + judge notes + witnesses + bail +
//        continuance history + signature block; same idiom as the v1024
//        FI / v1025 CH / v1026 evidence chain PDFs). Replaces the
//        page's last native dialog (`window.prompt()` in
//        handleCloneEvent) with a styled ConfirmDialog + date input.
//        Adds /court?event_id= (and court_event_id=) URL deep-link
//        with direct-fetch fallback + URL param strip — 12th
//        consecutive page-pass on the contract. Esc smart-cascade
//        (closes the smallest-open-first of 10 modals, replacing
//        the old hard-coded "Esc closes form only"). `N` keyboard
//        shortcut → New Event, typing-suppressed. Empty state now
//        distinguishes filter/search-empty vs upcoming-empty vs
//        truly-empty so the "New Event" CTA doesn't ambush a stale
//        filter. Theme: 14 `text-[#d4a017]` → `text-[var(--brand-gold)]`
//        and the restored-draft `#1a1500` → `bg-amber-950/40`.
//        Bugfixes: duplicate `id` attrs across mapped witness rows
//        (HTML5 unique-id violation, breaks form-tab navigation);
//        court-fee total string-concat ("50"+"25"="5025") → numeric
//        coercion with .toFixed(2); conflicts state now resets on
//        every selection change so a prior event's red conflict
//        banner doesn't ghost over a clean selection.
// v1031: Citations — kill the last native window.confirm() in handleVoid
//        and route it through the in-app ConfirmDialog (same destructive-
//        flow polish every other audited page now uses; FI #1597, Evidence
//        #1603, Cases #1604). Adds /citations?citation_id=<id> URL deep-
//        link (14th consecutive page-pass). Falls through to a direct
//        /citations/:id fetch when the row isn't in the current filtered
//        page (so a deep-link from another module resolves even when the
//        list is filtered to "Issued" but the target is "Voided"). Adds
//        `N` keyboard shortcut for opening a new citation (mirrors FI /
//        Dispatch / Patrol). Esc smart-cascade now closes void-confirm
//        first, then the inline payment form, then the person-search
//        dropdown, then the form panel. Empty-state copy distinguishes
//        "filtered to zero" from "nothing on file" — operators on a
//        clean install were uncertain whether the page was broken or
//        just empty. Theme: 22 `[#d4a017]` Tailwind arbitraries lifted
//        to `[var(--brand-gold)]`; restored-draft `#1a1500` background →
//        `rgb(var(--sev-warn-rgb) / 0.08)` (same lift as Patrol PR
//        #1595 + FI PR #1597); court-date overdue/soon/upcoming color
//        ramp (`#ef4444`/`#f97316`/`#eab308`/`#22c55e`) → semantic
//        `--sev-critical/high/caution/ok` so day-mode legibility tracks
//        the rest of the palette. Operator-chrome emoji sweep: ⚡ →
//        Zap, 🔒 → Lock, ⚖ → Gavel, ⚠ → AlertTriangle (lucide). The
//        Citations page already ships TWO citation PDFs (the Spillman
//        3-copy ticket via CitationPdfPreview/useCitationPreview, AND a
//        generic record print via PrintRecordButton/recordPdfGenerator)
//        — same trap Cases PR #1604 flagged, so no new PDF utility was
//        added; the 3-copy ticket IS the court-record form. The form-
//        draft localStorage key (`rmpg_citation_form`) was reviewed
//        against the user-scoped-storage rule and intentionally left
//        unscoped — `useFormDraft` is page-singleton everywhere in the
//        app, and the draft only contains the field operator's own
//        in-progress citation (not other officers' data).
// v1029: Connections graph — fix 3 entity-color collisions that
//        silently rendered DIFFERENT entity types as the same dot
//        color (person+case both brand-gold; evidence+arrest both red;
//        incident+business both amber). Operator couldn't tell which
//        type they were looking at on the graph. Bumped to lime/rose/
//        sky for the three colliding types — every entity now has a
//        distinct hue. Theme: 5 Tailwind brand-gold arbitraries lifted
//        to [var(--brand-gold)]. The 13 categorical chart palette
//        entries stay as raw hex (legitimate use — semantic --sev-*
//        tokens can't distinguish 16 entity types).
// v1036: Code Enforcement — court-ready notice + tow-order PDFs
//        (codeEnforcementPdf.ts, Arial banner, gold strap, critical-
//        violation alert bar, compliance-deadline reminder bar,
//        property/violator/description/resolution blocks, dual-
//        signature footer). Code-enforcement notices ARE the
//        operator artifact (handed to the property owner / driver) —
//        the only print path was previously bulk CSV. Two open*
//        entry points wired from new "Notice PDF" / "Tow Order PDF"
//        buttons on each detail panel; 18 unit tests cover the pure
//        fmt/wrap/classify helpers. Adds /code-enforcement?
//        violation_id=…&tow_id=… URL deep-link (auto-selects + tab-
//        switches + strips the query). Esc cascade extended to
//        smallest-open-first: reinspection inline → tow form →
//        violation form (was hard-coded to only the violation form,
//        silently ignoring tow form + reinspection date picker).
//        Adds `N` keyboard shortcut for new violation/tow, typing-
//        suppressed. Removes 5 declared-but-never-rendered state +
//        handler blocks (severityScore, compTimeline, fineCalc,
//        compDashboard, geoClusters) — dead since this page was
//        stubbed. Distinct empty-state copy for filtered-empty vs
//        truly-empty. Fixes the tow-form draft storage key typo
//        (rmpg_code_template_form → rmpg_code_tow_form). Theme: 6
//        text-[#d4a017] sites lifted to text-[var(--brand-gold)] +
//        2 rgba(212,160,23,…) sites lifted to rgb(var(--brand-gold-
//        rgb) / 0.NN) + fetch-error banner ⚠/✕ ASCII glyphs → Lucide
//        AlertTriangle/X.
// v1023: Patrol — hydrate isOnBreak from /patrol/breaks on mount (was
//        local-state-only; operator on break who refreshed the page saw
//        "Start Break" + a fresh click raced into a 2nd break). Adds a
//        live elapsed counter next to End Break (30s tick). New
//        /patrol?tab=<id> URL deep-link, 6th consecutive page-pass to
//        honor the same pattern. Replaces window.prompt × 3 in
//        BillingReviewTab (void reason + invoice from/to dates) with
//        proper inline modals — last patrol/ holdout; MileageAuditTab +
//        TripManagerSection already migrated. Theme: 24 hardcoded
//        [#d4a017]/[#888]/[#e0533d] sites across PricingTab/
//        BillingReviewTab/ContractsTab/MileageAuditTab/PatrolPage
//        lifted to var(--brand-gold)/var(--spm-text-muted)/var(--sev-
//        critical) tokens. The #e0533d was off-token entirely (not in
//        --sev-*); now routes through --sev-critical semantically.
// v1022: NCIC terminal — wire QUICK_QUERIES button row (declared since the
//        2026-06 NCIC overhaul but never rendered), add up/down arrow
//        command-history navigation (bounded at 30, dedupes back-to-back
//        repeats), and dedupe the welcome banner that was duplicated
//        verbatim between embedded + overlay render modes. Theme: 3
//        hardcoded #d4a017 sites on the overlay header lifted to
//        var(--brand-gold) + rgb(var(--brand-gold-rgb) / α). Adds a
//        first unit test file for the panel (the live behavior is
//        WebSocket/terminal-integrated and harder to unit-test, but
//        the QUICK_QUERIES contract is now locked).
// v1021: MDT end-of-shift PDF + deep-link + auth cleanup. The shift
//        report download was a .txt file with Unicode-box borders for
//        a year — replaced with a court-ready PDF (Arial banner, gold
//        agency strap, 5-up summary tiles, per-section tables for
//        calls/incidents/scans, two-signature block). New /mdt?call_id=
//        URL contract makes the 4th consecutive page-pass to honor
//        Dashboard's deep-link emit pattern — finds the call in
//        my-calls or pending, sets it as selectedCall, switches the
//        right tab. user_id reads from useAuth instead of localStorage
//        (stale localStorage could attribute a freshly-submitted FI to
//        the prior signed-out user). Theme: lifts UNIT_STATUSES,
//        priority colors, hazard banner, channel badges, NCIC tab to
//        semantic --sev-* tokens so a future tactical-day mode (if
//        ever) re-themes automatically.
// v1019: Dispatch deep-link + cleanup — /dispatch now honors ?call_id=
//        from Dashboard "Calls Near Me" (and any other source), auto-
//        selecting the target call and switching the filter tab so the
//        call is visible in the left rail (cleared calls land on Cleared,
//        archived on Archive, etc.). dispatch_sort preference now hydrates
//        from /api/user/preferences (was localStorage-only, lost across
//        devices). Supervisors get a "Print Cleared" button on the
//        Cleared tab — one-click PDF of every cleared call inside today's
//        Mountain-Time window, with disposition/units/duration. WS-dedup
//        Set capped at 500 entries (was unbounded — leaked for the life
//        of the dispatcher session). Quick Flags chip "off" state now
//        renders correctly (was falling back to '#888' because the
//        var(--color-rmpg-*) tokens it referenced don't exist). Theme:
//        new --brand-gold-rgb / --sev-*-rgb tokens in theme-palettes.css
//        let opacity-tinted backgrounds use the canonical palette; 30+
//        inline #d4a017 / rgba(220,38,38,…) literals lifted accordingly.
// v1018: Dashboard truth-up — /reports/dashboard now returns
//        activeWarrants/pendingServe/openCases/totalPersons (previously
//        the page read these but the endpoint never returned them, so 3
//        of 4 Status Summary cards permanently showed 0). New
//        /reports/calls-near geo endpoint powers the patrol "Calls Near
//        Me" panel with real distance-sorted active calls (was a fake
//        duplicate of the global priority grid). Title-bar LED now
//        tracks data-sync health (red=error, amber=stale>5min, green=ok)
//        with a "Synced HH:MM" chip. Toolbar gained Quick Capture /
//        Field Camera / Patrol Scan / Tasks (previously unreachable from
//        the dashboard). Deep-link cards now pass ?status=active|pending|
//        open so receiving pages land pre-filtered. BOLO nav corrected
//        to /intel/bolos. Theme + a11y nits: lifted hardcoded
//        rgba(136,136,136,…) values to rgb(var(--spm-text-muted-rgb)/α)
//        (new token in theme-palettes.css for all 3 palette blocks);
//        weather widget emoji 💧/💨 → Lucide <Droplets>/<Wind>.
// v1017: FlexCam close-query honesty (Plan E — surface 'failed' on
//        the request the moment the cron concludes a 0-downloaded
//        trip instead of marking it 'partial' and waiting 6h for the
//        drain to flip it. Trip 94 repair exposed this gap: 5 min
//        after reset the cron correctly Plan-C-early-abandoned all
//        23 chunks to 'missing', but the close-query then marked the
//        request 'partial' (which reads as "some footage retrieved"
//        when there is none). New CASE:
//          chunks_done<=0 AND any missing → 'failed'  (NEW)
//          chunks_done>0  AND any missing → 'partial'
//          else                            → 'complete'
//        Pure helper resolveCloseStatus in src/utils/footage/closeStatus.ts
//        + 4 unit tests in tests/footageCloseStatus.test.ts.
//
// v1016: FlexCam download integrity (Plan D — ensures every chunk
//        that lands in 'downloaded' state is proper, in order, and
//        not repeated/corrupted bytes). Every download now buffers
//        the response bytes, then:
//          • validateMp4Header — checks for the ftyp box at offset 4;
//            rejects JSON/HTML error bodies served as binary,
//            truncated heads, anything that wouldn't decode in <video>.
//          • crypto.subtle.digest sha256 of the bytes.
//          • Compare sha256 vs other 'downloaded' chunks in this
//            request; if duplicate (re-signed signed-URL pointing at
//            the same underlying file → URL-level dedup misses it),
//            mark this chunk 'missing' and don't write to R2.
//          • Only validated + unique bytes get put to R2 + persisted
//            with sha256 alongside.
//        New base column footage_chunks.sha256 (was previously evidence-
//        path-only; now populated on every download). The player's
//        existing seq-sorted timeline + status='downloaded' filter
//        already enforce "in order" + "skip duplicates", so no client
//        change needed. shouldDuplicateContent + validateMp4Header
//        unit-tested in tests/footageIntegrity.test.ts.
//
// v1015: FlexCam honest-failure path (Plan C — addresses the cap and
//        counter fragilities left after Plan A + B). Three small
//        orthogonal fixes:
//          • MAX_POLL_ATTEMPTS_ON_DEMAND 720 → 60. The old cap meant
//            ~75 days of real-time wait per chunk under the broken
//            per-chunk poll cadence; post-Plan-B that translates to
//            ~1 hour of honest polling before giving up.
//          • Per-request early-abandon: if source.listRequestWindow
//            returns ZERO clips AND any chunk has already polled
//            ≥10 times, fail-fast the WHOLE request's remaining
//            chunks. Stops the cron from grinding for an hour on a
//            request whose camera clearly isn't uploading.
//          • Drain dup-prune now runs BEFORE the stale-check (was
//            skipped via `continue` for stale-with-downloads). Fixes
//            the chunks_done over-count (e.g. req 93 stayed at 31
//            vs chunk_count 27 after the original drain).
//        No new migration. No client change. Same shouldEarlyAbandon
//        unit-tested in tests/footageEarlyAbandon.test.ts.
//
// v1014: FlexCam per-request poll rewrite (Plan B — addresses the
//        architecture problem the queue drain only swept around).
//        captureOrchestrator.pollAndDownload now groups pending chunks
//        by request_id, calls source.listRequestWindow ONCE per request
//        (instead of per-chunk listMedia + pickBestClip), and runs
//        assignClipsToChunks to greedy-match clips to chunks by
//        timestamp proximity. Eliminates the dedup-starvation root
//        cause: prior path had sibling chunks within one tick competing
//        for the same handful of clips returned by overlapping per-
//        chunk queries, leaving most as 'requested' forever (avg 41
//        polls/chunk before expiring to 'missing', max 712 — just under
//        the 720 cap, weeks of real time). Per-chunk pollChunk stays in
//        FootageSource for on-demand / diagnostic single-clip pulls.
//        Same close-query, max-attempts, alpr-on-thumbnail, R2 path.
//        No migration; no client change.
//
// v1013: FlexCam queue drain + player visibility — stop the LOADING…
//        silent-hang and stop the cron's per-tick poll budget from being
//        eaten by stale requests. Three pieces:
//          • POST /api/flexcam/queue/drain (admin, dry_run optional) —
//            bails out fulfilling/partial requests stalled >6h (zero
//            downloads → 'failed'; some downloads → 'partial') and prunes
//            duplicate-source-URL chunks within a request. Evidence-locked
//            rows untouched. Idempotent.
//          • Per-minute cron also runs the drain via maybeRunQueueDrain
//            (kill-switch: system_config.flexcam_drain_enabled='false').
//          • FlexCamFootagePage: <video> onError + 15s canplay timeout
//            surface playbackErr instead of hanging forever; new
//            formatPlayerStatus drives the empty-state message
//            ("Downloading footage…", "19 of 27 clips ready", "Failed: …")
//            and an inline dismissable error banner appears when a clip
//            fails after a working timeline rendered.
//
// v1012: Audit-trail completeness — close the two real gaps the safety
//        review of #1480 found. No new features, no relaxations; just
//        making the audit_log actually carry the chain-of-custody +
//        SOX-distinguishable signal the comments promised.
//
//        • Invoice paid-override: billing.ts PUT /invoices/:id wrote
//          generic 'invoice_updated' even when an admin force-paid an
//          under-paid invoice. Now branches to action=
//          'invoice_marked_paid_admin' with details carrying the
//          paid/total numbers at the moment of override. SOX reviewers
//          filtering audit_log can now spot the override row at a glance.
//
//        • Cascade per-video chain-of-custody: bodyCameras.ts DELETE
//          on a parent camera previously wrote a single audit row
//          carrying only heldCount (an integer). A subpoena later
//          asking "what happened to video #N tied to case Y" had NO
//          per-video trail. Now: SELECT every assigned video before
//          the batch, then write one recordAudit row per destroyed
//          video with action=bodycam_video_force_deleted (or
//          _deleted), entityId=videoId, and full retention/case/
//          classification context. Parent envelope row writes after
//          the per-video rows. Same audit shape as the direct
//          single-video DELETE handler — so a subpoena response that
//          greps for "video #N" finds the row regardless of which
//          path destroyed it.
//
//        Safety audit also confirmed: zero false positives in the v1010
//        wrapping-label htmlFor sweep, admin override wiring is correct
//        end-to-end, and no tests/docs/audit-log consumers depend on
//        the v1010 absolute strings.
//
//        Tests: 1524 vitests still pass. Worker typecheck clean.
//
// v1011: Soften the v1010 guards so legitimate operator workflows aren't
//        blocked. The fraud/security walls stay — but admin (the
//        operator-owner) now has audit-logged escape hatches, and the
//        139 redundant htmlFor= attributes from wrapping-pattern labels
//        come back out.
//
//        ADMIN OVERRIDES (audit-logged in every case):
//        • /api/personnel/bodycam-videos/:id?force=true  → bypass hold
//          → recordAudit action=bodycam_video_force_deleted
//        • /api/personnel/body-cameras/:id?force=true     → bypass cascade
//          → recordAudit action=body_camera_force_deleted
//        • /api/fleet/dashcam-videos/:id?force=true       → bypass hold
//          → recordAudit action=dashcam_video_force_deleted
//        • /api/billing/expenses/:id self-approval by admin
//          → recordAudit action=expense_self_approved_admin
//        • /api/billing/expenses/:id post-lock edit by admin
//          → recordAudit action=expense_locked_edited_admin
//        • /api/billing/invoices/:id status='paid'?force=true (admin)
//          (returns the canOverride flag in the 409 body so the client
//          can offer the override checkbox to admin-role sessions).
//        Non-admin roles still get the 403/409 walls — the
//        segregation-of-duties guarantees the audit was about stay
//        intact for manager/supervisor/officer/dispatcher/etc.
//
//        ROLE ADDITIONS:
//        • Evidence manifest POST allow-list adds 'dispatcher' — they
//          file on-behalf-of during in-progress CAD calls when the
//          field officer is mid-pursuit or offline. The officer_id is
//          still forced from the JWT so the manifest carries the
//          dispatcher's id (not a forged field-officer id).
//
//        DeleteRecordModal:
//        • When evidenceLocked=true AND the current user is admin, a
//          new checkbox renders: "Admin override — destroy held
//          evidence (audit-logged)". Checking it activates the
//          confirm button and sends ?force=true on the DELETE. The
//          button copy changes to "Override & Delete" so the
//          admin sees what they're about to do.
//
//        REVERTS:
//        • ConfirmDialog danger-variant backdrop-click no longer
//          requires explicit Cancel/Escape — backdrop closes again.
//          The safer Cancel-pre-focus + no global Enter behavior
//          already prevents accidental destruction.
//
//        htmlFor SWEEP CORRECTION:
//        • The PR #1476 Python sweep added htmlFor to 1,304 labels.
//          139 of those were wrapping labels (input as a child of
//          the label tag), where the explicit htmlFor was redundant
//          AND could mis-target inputs with mismatched ids. Removed
//          on 50 files via a wrapping-pattern audit script.
//
//        Tests: 1524 vitests still pass. Worker typecheck clean.
//
// v1010: Adversarial follow-up — fix the regressions PR #1476 introduced
//        and ship the 8-finding next-bug-class audit at the same time.
//
//        PR #1476 REGRESSIONS:
//        • DeleteRecordModal evidence-lock no-op button — looked active,
//          did nothing on click, silent. Now uses a real `confirmDisabled`
//          prop through ConfirmDialog → button gets disabled + aria-disabled
//          + cursor-not-allowed. The real onConfirm stays in place so a
//          buggy parent that forgets evidenceLocked doesn't silently swallow
//          clicks.
//        • Evidence-lock vocabulary mismatch — client treated 'expired' as
//          locked, which BLOCKED the lawful retention-purge workflow the
//          server explicitly enables. Replaced with a positive hold-list
//          check (`utils/evidenceLock.ts`): only legal_hold/court_hold/
//          litigation_hold/subpoena_hold/ia_review/open_case lock the row.
//          'active', 'expired', 'archived', 'purged', 'pending_deletion',
//          undefined, unknown all stay deletable.
//        • Evidence-lock was CLIENT-ONLY → bypassable with one curl DELETE.
//          Added the same hold-list check on the server side:
//          - src/routes/personnel/bodyCameras.ts DELETE /:id (video) +
//            DELETE / (camera, with cascade hold check)
//          - src/routes/fleet.ts DELETE /dashcam-videos/:id
//          All three now reject with 409 when the row is on hold AND
//          emit recordAudit on successful destruction (the old code
//          destroyed evidentiary footage with zero audit trail).
//        • DashCamVideo.retention_status was accessed via `(v as any)` —
//          a future SELECT narrowing would silently break the guard.
//          retention_status?: VideoRetention is now in the type so future
//          regressions surface as a typecheck error.
//        • Post-delete sequencing — refresh-after-delete failure used to
//          report a false "Failed to delete" toast on a row that IS gone.
//          Reordered: report delete result truthfully first, refresh as a
//          separate try/catch that reports refresh failure as a non-blocking
//          info toast. BodyCamerasPage + DashCamerasPage both reordered.
//        • alertdialog backdrop click-to-close — danger variant no longer
//          dismisses on background click. Escape, Cancel, and X still work.
//        • Stale-row click silently swallowed — handleDelete/handleVideoDelete
//          now toast + refresh when the row is gone from local state.
//
//        NEW SECURITY/INTEGRITY FINDINGS (unrelated to PR #1476):
//        • CRITICAL — Expense self-approval fraud surface in
//          src/routes/billing.ts:325. PUT /expenses accepted approved_by
//          + approved_at from the body, so an admin/manager could approve
//          their OWN expense, stamp the CEO as approver, and then raise
//          the amount AFTER the fake approval. Fixed:
//          (a) approved_by/approved_at stripped from the updatable set;
//              stamped server-side from the JWT on the approval transition.
//          (b) Reject status='approved' when submitter_id = userId.
//          (c) Once status ∈ {approved,paid,reimbursed}, amount/category/
//              expense_date freeze (409 on edit).
//          (d) recordAudit on expense_submitted + expense_approved.
//        • CRITICAL — Evidence manifest forgery in src/routes/evidence.ts:46.
//          Any authenticated user (including client_viewer + human_resources)
//          could file a chain-of-custody manifest with arbitrary sha256 /
//          officer_name / badge / case_ref, and /verify/:sha256 would then
//          "verify" the forged hash. Now POST / requires
//          admin/manager/supervisor/officer role, and officer_id is forced
//          from the JWT (body-supplied officer_id is ignored).
//        • MAJOR — Case DELETE wrote zero audit_log. Now records case_deleted
//          with case_number + case_type + status BEFORE the cascade.
//        • MAJOR — billing.ts has ~zero recordAudit calls (SOX gap). Wired
//          recordAudit into payment_recorded, expense_submitted,
//          expense_approved, expense_updated, invoice_updated, contract_created.
//        • MINOR — Incident /approve route did not log to audit, while
//          /return did. Now both log (approve is the more consequential
//          transition).
//        • MINOR — Payment amount validation: 'NaN <= 0 is false' for
//          strings like '100abc' let malformed values through. Use
//          Number.isFinite + positive check, bind the coerced number.
//        • MINOR — Contract rate_amount validation: same pattern.
//        • MINOR — Invoice PUT status: validate against
//          {draft,sent,partial,paid,overdue,void,cancelled};
//          status='paid' requires paid_amount >= total_amount.
//
//        Shared seam:
//          • client/src/utils/evidenceLock.ts (20 vitests, all pass)
//          • src/utils/evidenceLock.ts (mirror, same hold-list)
//        Tests: all 1524 client tests pass; worker typecheck clean.
//
// v1009: Audit punch-list sweep — 21 findings from the v1008 forward-looking
//        audit landed in one PR. Highlights:
//
//        DESTRUCTIVE CONFIRMATIONS — new <DeleteRecordModal> + <ConfirmDialog>
//        carrying row identity:
//          • ConfirmDialog Enter bug: was firing the destructive action even
//            when focus was on the X close button (autofocus landed on X +
//            global Enter handler). Now focus lands on Cancel for danger
//            variants and Enter is handled natively per-button, not at the
//            dialog level. data-confirm-cancel / data-confirm-action hooks
//            mark which button is the safe vs destructive target.
//          • ConfirmDialog `details` slot for structured row context.
//          • New <DeleteRecordModal> wraps ConfirmDialog with a record-
//            specific shape. Optional evidenceLocked guard for evidentiary
//            video / chain-of-custody surfaces.
//          • 4 highest-stakes pages converted to DeleteRecordModal with full
//            row context: VictimServicesPage, AffairsPage (IA), CrisisResponsePage,
//            NarcoticsPage. Each now surfaces name + case_number + crime_type
//            etc. so the operator can verify the row before destruction.
//          • BodyCamerasPage + DashCamerasPage: replaced bare window.confirm
//            (evidentiary video destroyed with zero identity check) with
//            DeleteRecordModal showing officer + capture timestamp + unit/
//            trip context. Evidence-lock guard blocks delete when video
//            retention_status != 'active' (under hold).
//          • IncidentsPage: "Remove this offense/officer/link?" prompts
//            now show the offense code + officer name + link reference
//            number.
//
//        ACCESSIBILITY:
//          • AddressAutocomplete now has the full ARIA combobox shape:
//            role=combobox + aria-expanded + aria-controls +
//            aria-activedescendant + aria-haspopup on the input;
//            role=listbox + role=option + aria-selected on suggestions.
//            Used in every call-intake form (NewCallModal / IncidentFormModal
//            / QuickPsoModal / DispatchPage QuickDispatch). Was the largest
//            assistive-tech gap in the CAD intake path.
//          • 1,304 <label> elements across 160 .tsx files got htmlFor=
//            wired to their existing id="ff-X-N" inputs. Closes the
//            single largest screen-reader regression in the codebase
//            (audit reported ~99% of labels missed it).
//          • Touch targets bumped to 44px on FieldCameraPage (Back, Flip,
//            patrol-hit Dismiss, scan Done) and ShiftCard (vehicle picker
//            min-h-[40px]→44px, Cancel h-9→h-11).
//
//        SILENT FAILURES — surfaced:
//          • DispatchPage 1336 (full-call hydrate): was silently showing
//            list-version selectedCall → operator double-wrote PSO fields.
//            Now addToast on failure.
//          • DispatchPage 1213 (serve:attempt refresh): was leaving
//            serve-link stale → dispatcher could re-dispatch same officer.
//            Now addToast.
//          • ServeIntakePage 283 (clients dropdown): tracks clientLoadError.
//          • IncidentsPage 568+578 unlink person/vehicle: was silent with
//            no confirmation. Now confirms with the person's name +
//            vehicle plate and surfaces a success toast.
//
//        STATUS ENUM PROPER-CASE STRAGGLERS (commit d147f78d missed these):
//          VictimServicesPage, NarcoticsPage, GangIntelPage,
//          AlarmManagementPage, IntelSourcesPage, BoloCard,
//          CallHistoryDrawer — all now use formatEnumValue().
//
//        DEFERRED (require server-side joins or new schema):
//          • AuditLogPage entity_label
//          • EmailPage / WebResearchPage / FlexCamPage identifier exposure
//          • Quick Dispatch dialog focus trap
//          • IncidentFormModal tab bar + priority radio ARIA
//          (These need backend changes and are tracked for a follow-up PR.)
//
//        Tests: all 1504 client tests pass; worker typecheck clean.
// v1009: Salt Lake County Assessor backfill UI lands on /records.
//        AssessorBackfillButton (admin/manager-only) sits in the Businesses
//        and Properties PanelTitleBar toolbars. It polls
//        /assessor/backfill/status every 5s and POSTs /assessor/backfill on
//        click to enqueue every business + property that has an address but
//        no parcel_number. Live counter shows {done}/{total} done · {n} need
//        review next to the button while the cron drains the queue.
//        AssessorReviewQueueBanner sits above the tab list and renders the
//        ambiguous-match queue from GET /assessor/review-queue — each row
//        expands inline into the shared AssessorSuggestionPanel, and Apply
//        POSTs /assessor/apply + reloads so the resolved row drops out.
//        Banner self-hides when the queue is empty.
// v1008: Critical safety + silent-failure sweep. Ultracode forward-looking
//        audit (4 agents, 53 findings) caught 4 critical + 13 major bugs;
//        this PR ships the safety-critical and CAD-integrity fixes.
//
//        OFFICER SAFETY (useOfficerSafety.ts):
//          • Welfare check-in (POST /dispatch/welfare/checkin/:unitId) was
//            using `.catch(() => {})` AFTER optimistically flipping local
//            state to {lastCheckin: now, missedCount: 0}. If the request
//            failed (radio dead-spot, transient 5xx, DNS blip), the OFFICER
//            saw a green ✓ and the dispatcher console heard NOTHING — the
//            WelfareWatchDO timer kept ticking with no human aware. Now
//            awaits + rolls back the optimistic flip on failure + sets a
//            visible lastFailure state for an inline "CHECK-IN FAILED —
//            RETRY" pill + logs to localStorage.
//          • Auto-escalate (POST /dispatch/welfare/escalate) had the same
//            silent swallow — supervisor was never paged on failure. Now
//            surfaces a persistent banner and writes to the same failure
//            log so a supervisor can reconstruct missed pages after the
//            fact.
//          • Adds rmpg_welfare_failures localStorage key + appendFailureLog
//            helper. Trimmed to most recent 200 entries.
//
//        CAD DATA INTEGRITY (DispatchPage.tsx):
//          • The inline incident-number editor (lines 3654 + 3668) was
//            sending body `{ case_number: val }`. The server wrote the
//            incident value into case_number, the displayed incident_number
//            never updated, and the operator saw "Linked to incident X"
//            for an action that silently corrupted the CAD→RMS linkage.
//            Now sends `{ incident_number: val }`.
//          • Same editor's blur handler was deliberately /* silent on blur */
//            and the case_number editor blur (line 3626) too. Operator
//            tabbed away thinking the write succeeded. Both now surface an
//            error toast.
//
//        SILENT SAVE SWEEP:
//          • CriminalHistorySection:154 save handler — added addToast on
//            failure (operator was hitting Save N times wondering why
//            nothing happened).
//          • AdminInvoiceTab:275 invoice-notes autosave — added addToast
//            on failure (billing/audit-trail surface, subpoena-relevant).
//          • IncidentsPage:344 chain-of-custody — opaque `addToast('Network
//            error')` discarded the error object; replaced with the actual
//            err.message so 401 / 409 / 422 surface vs being mistaken for
//            network blips.
//
//        TOUCH / KEYBOARD A11Y (sweep across 23 .tsx files):
//          • Every `opacity-0 group-hover:opacity-100` wrapper now extends
//            with `group-focus-within:opacity-100` AND `[@media(hover:none)]
//            :opacity-100`. Result: on vehicle MDT touchscreens the primary
//            D/ER/OS/CL/X dispatch buttons (CallCard:617), document-attach
//            controls (EmailPage, DocumentsPage, CallDocumentsPanel), and
//            similar hover-gated functional controls are now permanently
//            visible. On desktop the keyboard user reveals them by Tab focus.
//
//        Tests: existing 1504 tests still pass; worker typecheck clean.
//        No new tests added for useOfficerSafety because the hook composes
//        with apiFetch + localStorage which the test harness mocks at the
//        module boundary — would need miniflare-style integration test.
// v1007: Picker polish + audit-driven fixes — keyboard nav, ARIA, race fix,
//        and a load-bearing route that was orphaned.
//
//        Keyboard navigation (every picker, no exceptions):
//          • Shared useTypeaheadKeyboard hook (15 unit tests) wires
//            ArrowUp/Down + Home/End + Enter + Esc into all 11 pickers.
//            Enter on a fresh dropdown picks the top hit (Chrome URL
//            bar / Google search convention). Esc closes. Up from -1
//            jumps to the last result; Down wraps.
//          • Active item is visually distinct from selected (active
//            highlights on the listbox/option ARIA shape; selected
//            keeps its gold left border).
//          • Full ARIA combobox pattern: role=combobox + aria-controls
//            + aria-activedescendant + aria-expanded on the input,
//            role=listbox on the dropdown, role=option + aria-selected
//            on each result.
//
//        Race fix (self-heal hydration v2):
//          • PersonPicker / WarrantPicker / CitationPicker use a debounced
//            server fetch to self-heal. The .then() callback used to call
//            setQuery(name) unconditionally, which would CLOBBER the
//            user's typed query if they started typing before the fetch
//            resolved. Now all three use functional setQuery((current) =>
//            current === '' ? name : current), preserving in-flight typing.
//
//        Routing fix (audit caught this — PR #1471's "mobile PSO auth fix"
//        was a no-op until now):
//          • Added /m/cfs/:id → MobilePsoCfsPage to App.tsx. The component
//            existed and had the OfficerPicker auth fix from v1006 wired
//            in, but it was never imported by the router. The QR-token
//            authed PSO call flow now actually reaches end users.
//
//        Tests:
//          • 15 hook tests for useTypeaheadKeyboard
//          • 32 parameterized cross-picker tests for the 8 client-filter
//            pickers (Officer/Incident/Unit/Call/Case/Client/Contract/
//            Arrest) covering combobox ARIA, self-heal hydration, clear,
//            listbox role on open
//          • Existing 9 PersonPicker tests still pass through the race fix
// v1006: Picker rollout finale — Warrant/Citation/Arrest pickers + self-healing
//        hydration + mobile PSO auth fix + iOS FK leak. Closes the entire
//        picker rollout work.
//
//        New pickers (close the RecordPicker numeric fallback):
//          • WarrantPicker  — debounced POST /warrants/search-all; routes
//            digit-only queries to warrantNumber, anything else to lastName.
//            Returns local hits only (external warrant indices have no DB id
//            to FK against).
//          • CitationPicker — debounced GET /citations/search?q=.
//          • ArrestPicker   — one-shot GET /jail/inmates?per_page=200,
//            client-filter on booking_number + first/last name + housing.
//
//        Mobile critical fix (audit caught this):
//          • mobile/MobilePsoCfsPage PSO auth screen used a raw numeric
//            <input type="number" placeholder="e.g. 1572"> for the
//            officer's user_id. A typo silently authenticated the wrong
//            officer to a live call (then drove status updates, narrative,
//            PSO service entries under that wrong identity). Replaced with
//            OfficerPicker. The chosen officer's full_name + badge + unit
//            now render in a confirmation strip BEFORE the "Open Dispatch"
//            tap so the guard verifies identity pre-auth.
//
//        Self-healing hydration (defends every wired edit-mode form
//        without touching the 6 server endpoints or 6 modal forms):
//          • Every picker (Person/Officer/Incident/Unit/Call/Case/
//            Client/Contract/Warrant/Citation/Arrest) now auto-hydrates
//            its visible name when given a `value` (FK) but no
//            `displayValue`. Client-filter pickers look the row up in
//            their already-loaded list; server-search pickers (Person,
//            Warrant, Citation) fetch the specific record by id.
//          • Fixes the major hydration gaps surfaced by the audit:
//            BillingFormModal client+contract, TaskFormModal officer+
//            linked_entity, JailFormModal officer+incident,
//            AffairsFormModal officer, DashcamPage unit, QAPage officer.
//            Editing an existing record now shows the linked name
//            immediately instead of an empty input that looks like
//            "no record assigned" (the bug that risked accidental
//            silent reassignment on every edit).
//
//        iOS cosmetic:
//          • FieldFormat.swift no longer renders owner_person_id as the
//            user-facing label "Owner (Person #)". Aligns with
//            FieldToolkitView's existing filter on `_id`-suffix keys
//            so internal FKs don't leak into the UI.
//
//        After this PR, RecordPicker has zero numeric-input fallbacks
//        — every LinkableRecordType resolves to a name-search picker.
// v1005: Picker rollout audit follow-up — adversarial verification of v1004
//        caught 3 surfaces the first audit missed plus 1 picker bug:
//
//        Missed surfaces:
//          • BillingFormModal.client_id   (numeric input → new ClientPicker
//            via /clients?status=active, filters name + contact + phone)
//          • BillingFormModal.contract_id (numeric input → new ContractPicker
//            via /billing/contracts?client_id=<picked>, scoped to the picked
//            client; auto-clears stale selection when client changes)
//          • TaskFormModal: assigned_to (numeric input → OfficerPicker),
//            linked_entity_type (free-text → typed <select>),
//            linked_entity_id (numeric input → polymorphic RecordPicker)
//
//        Picker bug:
//          • PersonPicker's onChange handler didn't setOpen(true) — the other
//            5 inline pickers do, so typing into PersonPicker after picking
//            left the dropdown closed until the 300ms debounce fired. Now
//            consistent with the rest.
//
//        After v1004 + v1005, ALL FK-by-ID input surfaces in the React client
//        are picker-driven (modulo the warrant/citation/arrest fallback inside
//        RecordPicker, which still types numeric — those are rarer types in
//        the cross-link modals and can get dedicated pickers in a follow-up).
// v1004: System-wide search-by-name picker rollout — sweep follow-up to v1003.
//        Four new pickers (UnitPicker via /dispatch/units, CallPicker via
//        /dispatch/calls, CasePicker via /cases, plus a polymorphic
//        RecordPicker that switches between Person/Incident/Call/Case by a
//        `type` prop). Wired into the remaining 5 FK-by-ID surfaces:
//        AffairsFormModal (subject_officer_id), IncidentsPage Add-Officer
//        modal (officer dropdown + manual_officer_id fallback replaced with
//        a single OfficerPicker driven by a hidden FormData input),
//        IncidentsPage cross-link modal (linked_type select + linked_id
//        numeric input replaced with RecordPicker that hot-swaps based on
//        the type), ForensicLabPage intake wizard (incident_id),
//        DashcamPage device assignment (unit_id), QAPage review form
//        (reviewed_officer_id). Same DB FKs; only the input surfaces change.
//        Warrant/Citation/Arrest types in the cross-link modal fall back to
//        typed numeric input for now (rare in practice; dedicated pickers
//        can land in a follow-up when the operator hits them).
// v1006: PSO Notice court-paragraph layout DELETED. The old format was already
//        unreachable (PR #1539 made generateNoticeOfCommunication delegate to
//        the line/box generateNoticeOfAttempt and renamed the legacy body to
//        _legacyCourtParagraphLayout for "back-compat"). Operator was still
//        seeing the old format from a stale cached bundle — removing the dead
//        function (215 lines + private layout constants + helpers) guarantees
//        the old PDF format can never be served again, even from a hostile
//        cache or a missed import. psoNoticePdfGenerator.ts is now a pure
//        adapter to the unified line/box generator.
// v1005: Notice of Attempt PDF — recipient-readability polish. The disclaimer
//        body paragraphs now render in mixed case instead of shouting in
//        ALL CAPS (police-form caps stay on field labels + table cells via
//        sanitizePdfText's preserveCase opt-out). The "lead" anti-simulation
//        line ("THIS IS NOT A COURT ORDER...") is centered, slightly larger,
//        and flanked by horizontal rules so the subject can't miss it.
//        Next-attempt note renders as an italic call-out below the disclaimer
//        instead of an all-caps field-pair. The "police-report style" frame
//        (NIBRS header, line/box sections, signature block) is preserved;
//        only the recipient-facing prose was unstuck from caps.
// v1004: Salt Lake County Assessor lookup wired into Business + Property
//        records forms. Address blur (typed or picked) → /assessor/parcels;
//        AssessorSuggestionPanel renders the 0/1/N matches below the address
//        input. Apply posts to /assessor/apply with the record id + parcel
//        number; server's never-clobber patch merges into the form state and
//        a "N field(s) skipped (already filled)" hint flashes for ~5 s. Apply
//        short-circuits when the record is unsaved (the panel still surfaces
//        the match list; a hint asks the operator to save first).
// v1003: Search-by-name record pickers — operator can no longer be expected
//        to know that "Camden Clark is ID 4" when linking records. Three new
//        reusable components: PersonPicker (debounced /records/persons/search,
//        2-char min, dropdown shows name + DOB + phone + city/state),
//        OfficerPicker (one-shot /personnel?status=active fetch + client
//        filter on name/badge/rank/unit call sign), IncidentPickerInline
//        (the existing IncidentPicker is panel-shaped; inline variant has the
//        same dropdown UX). Replaces five numeric-ID text inputs:
//        UseOfForcePage subject_person_id + incident_id; JailFormModal
//        arresting_officer_id + arrest_incident_id; EvidencePropertyPage
//        incident_id. The DB FK columns are unchanged — pickers just emit
//        the selected record's id via onChange, so existing rows continue to
//        link correctly.
// v1002: Patrol Mileage Audit gap auto-fixer — new POST /mileage/auto-fix-gaps
//        endpoint walks the unified CFS+PATROL chain and closes remaining
//        +/- gaps left after Rebuild has aligned PATROL forward. Per pair:
//        (a) gap >0 with intervening PATROL → re-stamp last patrol's
//        end_mileage up to next CFS's starting_mileage; (b) gap >0 with
//        no PATROL between → synthesize ONE patrol row (close_reason
//        'gap_fill_auto'), capped at 100 mi single-gap synthesis;
//        (c) gap <0 with intervening PATROL → contract last patrol's
//        end_mileage down to CFS observation; (d) gap <0 with no PATROL
//        between → reported for manual review (requires /mileage/fix on
//        one of the two CFS rows). CFS row mileages NEVER auto-edited.
//        New "Auto-fix gaps" toolbar button + post-run review panel
//        showing unbridgeable CFS-to-CFS negative gaps. Every change
//        audited via auditTripChange.
// v1001: Patrol noise filter widened — operator request after seeing both
//        literal-zero AND 0.1/0.3 mi micro-shuffle rows on the chain side-
//        by-side. tripStore now discards any closed PATROL trip with
//        distance_m ≤ 805 m (== 0.5 mi) regardless of duration. The
//        admin /trips/discard-zero-mile sweep uses the same threshold (URL
//        kept for back-compat with the deployed Pages bundle, semantics
//        widened). UI button renamed "Discard 0-mi" → "Discard ≤0.5 mi";
//        result toast reports threshold from server response.
// v1000: Patrol Mileage Audit follow-up — close the +/-60 mi gap between
//        the CFS and PATROL chains visible on prod after v999. Two root
//        causes: (1) tripStore was reading mileage_anchor for the PATROL
//        auto-stamp, but anchor is only written by admin /mileage/fix —
//        the LIVE running odometer is fleet_vehicles.current_mileage (what
//        calls.ts reads via vehicleOdometerForUnit). The two paths were
//        using different sources, so PATROL stamps drifted ~60 mi behind
//        the CFS chain. tripStore now reads fleet_vehicles first, anchor
//        as fallback. (2) The noise filter required (<50m AND <180s),
//        letting through long parked-engine-running sessions as 0.0 mi
//        rows that flooded the chain. Tightened to discard any closed
//        PATROL trip with distance_m == 0 regardless of duration. Plus
//        the backfill endpoint was rewritten as a UNIFIED-chain walker:
//        pulls CFS + PATROL rows for (officer, unit) ordered by time,
//        treats CFS observations as authoritative, re-stamps PATROL rows
//        to match. New POST /trips/discard-zero-mile and a "Discard 0-mi"
//        toolbar button clean up the historical noise rows. The old
//        "Backfill PATROL odo" button is now "Rebuild chain" — same
//        endpoint, smarter algorithm.
// v999: Patrol Mileage Audit — pin sub-tab nav + scope picker (sticky so
//       changing officer/unit no longer requires scrolling back past hundreds
//       of chain rows), auto-stamp odometer on GPS-detected PATROL trips
//       (tripStore derives end_mileage = start + distance_m/1609.34, with a
//       75-mi outlier guard to keep one bad GPS run from poisoning the
//       anchor), pre-fill Add-Trip form from /mileage/suggest, and add an
//       admin-only one-shot POST /mileage/backfill-patrol-trips for the 87
//       historical "—"-odometer rows. Shared utils/mileageAnchor.ts is the
//       single source for both the endpoint and the trip-engine seam.
// v998: caseActivity — replace Unicode arrow with ASCII -> in status.changed
//       label so it renders correctly in PDF (sanitizePdfText strips U+2192).
// v997: FlexCam capture pipeline — batch chunk INSERTs (prevents 720-row
//       Worker timeout on multi-hour drives); gap-fill cron for truncated
//       requests; remove on_demand-only gate from full-drive cron pass.
// v996: ErrorBoundary chunk-reload guard — import shared CHUNK_RELOAD_KEY/
//       CHUNK_RELOAD_WINDOW_MS/isChunkLoadError from chunkRetry.ts (was
//       duplicated hardcoded strings); handleReload clears the guard key so
//       a manual "Reload Page" click resets the anti-loop timer, allowing
//       auto-retry on the fresh load during CF Pages propagation windows.
// v996: AdminPage CRUD + AI provider testing — closes the remaining 404s
//       from the 2026-06-21 prod console dump that PR #1541 didn't cover.
//       New server routes:
//         - POST   /api/admin/config       (insert system_config row)
//         - PUT    /api/admin/config/:id   (validates id is numeric>0, so
//           the prod `PUT /admin/config/undefined` URL returns 400
//           INVALID_ID instead of cascading from a cached bad id)
//         - DELETE /api/admin/config/:id   (admin only)
//         - GET    /api/admin/config-items (grouped Record<category,
//           ConfigItem[]> shape AdminSystemTab needs for inline editing —
//           sibling to flat /admin/config which stays as-is for
//           DispatchPage/IncidentsPage backwards compat)
//         - GET    /api/ai/test/:provider  (real HTTP probe to groq/gemini/
//           openai /models endpoints; ollama short-circuits with a clear
//           "private/local address unreachable from CF Worker" error)
//       Client: AdminSystemTab fetches /admin/config-items and guards
//       against undefined ids interpolating into PUT/DELETE URLs.
// v995: FlexCam chunk stream — force Content-Type video/mp4 (was
//       application/octet-stream from ClearPath, breaking video playback).
// v994: Dashcam AI full-footage upgrade — event clips always download to R2
//       on first play (fire-and-forget waitUntil) so they survive pre-signed
//       URL expiry; GET /driving-events/:id/media now prefers the full-drive
//       chunk covering the event timestamp over the short AI clip; response
//       includes footage_request_id so ForensicDashcamPlayer can show a
//       "▶ Full Trip" link into the FlexCam trip viewer.
// v1001: Map crash fixes — (a) replaced two `var(--surface-base)` literals
//       seeded into useGeoJsonLayers + useMapConfig with `#0d1722` (tactical
//       map shell is always-dark, so hardcoded hex is correct); the CSS-var
//       string crashed mapbox.addLayer's style-spec validator and zeroed the
//       county fill layer. (b) New `upsertGeoJsonSource` helper makes the
//       three breadcrumb addSource blocks setStyle-diff-race-safe (was
//       throwing "There is already a source with ID rmpg-breadcrumb-dots"
//       during theme/basemap switches). (c) `safeMapboxColor` guard at the
//       addLayer boundary so any future config drift falls back gracefully
//       instead of crashing the whole layer.
//       (Numbered v1001 to avoid collision with the existing v995/v996
//       entries below — the comment number is documentation only; the
//       actual cache name is auto-stamped from the git short SHA by the
//       stamp-sw-version Vite plugin, so collisions don't affect cache
//       invalidation.)
// v996: PSO ↔ Process Server unification + structured PS code library.
//       PDF: psoNoticePdfGenerator delegates to generateNoticeOfAttempt so
//       Dispatch-CFS close and Process-Server "Notice of Attempt" both
//       produce the same line/box NIBRS document (the historical
//       court-paragraph layout is preserved as _legacyCourtParagraphLayout
//       but no longer reachable from any caller).
//       Codes: client/src/constants/processServiceCodes.ts +
//       src/utils/processServiceCodes.ts mirror — PS/00..PS/45 hierarchy
//       with 5-increment categories + .01/.05/.10 sub-codes. Full library:
//       PS/00 Non-Service, PS/05 Personal, PS/10 Substitute, PS/15 Evasion,
//       PS/20 Posting, PS/25 Mail, PS/30 Publication, PS/35 Court-Ordered,
//       PS/40 Administrative, PS/45 Pending. codeToLegacyResult/Queue map
//       the structured code to the existing enum surfaces.
//       Wizard: failedReason picker REPLACED with a two-step category→
//       sub-code PsoCodePicker (color-toned by category tone). The picker
//       also surfaces on Personal/Substitute/Posting attempts so the
//       operator can pick PS/05.05 (photo-ID) vs PS/05.10 (verbal) etc.
//       "Show all 10 categories" widens the picker when needed.
//       Server: POST /api/process-server/:id/attempt accepts disposition_code,
//       derives the legacy `result` from it, persists both (columnExists-
//       guarded). serve_attempts.disposition_code → migration 0143.
//       Cross-link: NEW src/utils/psoServeCrosslink.ts — when a CFS with
//       incident_type='pso_client_request' transitions to cleared/closed/
//       cancelled, mirrors the close into the Process Server queue: find/
//       create serve_queue row from the call's PSO fields, log one
//       serve_attempts row with the disposition-mapped PS code, update
//       queue.status + attempt_count. Wired into both POST /:id/status
//       AND the CFS Action Bus POST /:id/action. Idempotent within a
//       60-second window. Response includes pso_crosslink so the
//       dispatch client can toast + jump to the queue row.
// v995: Notice of Attempt to Serve — full PDF + data-input overhaul.
//       PDF: CONFIDENTIAL watermark rotated 45° + wrapped in save/restore
//       GState (was rendering inline through body text); empty Date/Time/
//       Notes cells fall back to created_at → em-dash so the recipient
//       notice is never blank; GPS coords + "GPS coordinates recorded
//       on-scene" attribution line under the attempt table; hiring-party
//       label shows "Atty (atty) for Client" when both are on record;
//       signature image from the latest attempt now actually flows
//       through to the notice (was unwired). Modal: failed attempts take
//       a 3-step fast path (Location → Reason → Submit) and skip the
//       signature step entirely (failed notices are unsworn); next-
//       attempt picker (date + start/end time) auto-builds an editable
//       sentence persisted on serve_queue.next_attempt_note (migration
//       0142); "Other (specify)" free-text reason prepends to notes;
//       notes field shows a live 90-char counter against the PDF
//       truncation limit. Server /api/process-server/:id/attempt now
//       persists next_attempt_note when the column exists, falls back
//       gracefully when migration 0142 hasn't landed.
// Stamped at build time by the stamp-sw-version Vite plugin (vite.config.ts)
// with the git short SHA → 'rmpg-flex-<sha>'. Dev server serves 'rmpg-flex-BUILD'.
const CACHE_NAME = 'rmpg-flex-BUILD';
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
