// ============================================================
// RMPG Flex — Service Worker
// Provides offline caching for static assets while always
// fetching API data fresh from the network.
// Supports automatic updates with client notification.
// v1125: NSOPW Offender Registry — deep-link setSearchParams strip, N shortcut, Esc cascade, parseTimestamp for last-run display.
// v1114: Victim Services — role gates (canManage: admin/manager/supervisor), ?victim_id= / ?case_id= deep-link, N shortcut, Esc cascade, 3-state empty (loading/error/no-data/no-results), ConfirmDialog replaces DeleteRecordModal, search filter, dead-code cleanup.
// v1113: Crisis Response — ?crisis_id=/?incident_id= deep-link (strip after mount),
//        N shortcut (admin|manager), Esc cascade (delete->form->search), search bar
//        with distinct empty states (loading/no-data/no-results), role-gated create
//        and delete (admin|manager only), text-green-400 -> text-blue-400 brand token.
// v1111: Gang Intel (/gang-intel) — Page 88 of the full-app frontend pass.
//        Replaced inline delete modal with ConfirmDialog (danger variant, shows
//        name/moniker/gang in details). Added N shortcut (new member), Esc
//        cascade (form → delete confirm, stopPropagation). Deep-link:
//        ?member_id= auto-opens that member in the edit form after load,
//        ?gang_id= accepted and stripped; both removed with { replace: true }.
//        Role gate: Delete button + context-menu item hidden for non-admin/
//        manager/supervisor (mirrors Worker DELETE 403 guard). Distinct empty
//        states: "Loading…" spinner on initial fetch, "No results for X" when
//        search has no hits vs "No gang members tracked yet" when data is truly
//        empty. Search bar filters by name/moniker/gang in-client. Removed dead
//        EMPTY_GANG constant and unused `gangs` render path. Brand tokens: no
//        hardcoded hex (was using CSS-var-backed Tailwind tokens already).
//        formData type tightened from `any` to `typeof EMPTY_MEMBER`.
// v1110: Interagency (/interagency) — ConfirmDialog replaces hand-rolled delete modal,
//        ?agency_id= deep-link (strip with replace:true), N shortcut for New Partner,
//        Esc cascade closes form/dialog, 3-state empty states (loading/no-data/no-results),
//        admin|manager role gates on edit/delete UI, search filter, typed Partner interface.
// v1109: Risk Management (/risk) — Page 86 frontend audit. Replaced inline
//        delete div with ConfirmDialog. Added ?risk_id= deep-link (opens edit
//        modal, stripped with replace:true). N shortcut opens New Assessment
//        (admin/manager only). Esc cascade: delete confirm → form. Empty states
//        now distinguish loading vs no-data vs no-search-results. Role gates:
//        canWrite (admin|manager) hides New/Edit/Delete from other roles.
//        API envelope correctly unwraps .data array from /risk/assessments.
//        Dead state removed (showForm erroneously derived from editingRecord
//        !== null). Hardcoded hex (#888888) migrated to text-rmpg-400 token.
//        Filter bar with live client-side search added to toolbar.
// v1108: Billing (/billing, /invoices) — Page 85 of the full-app frontend
//        pass. BillingPage: replaced todayLocal() helper with localToday()
//        from dateUtils (consistent timezone handling). InvoicesPage: added
//        ?invoice_id= deep-link (opens + selects invoice after load) +
//        ?client_id= pre-filter; N shortcut (canEdit only, skips while
//        typing) opens New Invoice; Esc cascade (payment form → line-item
//        form → detail panel → create panel); ConfirmDialog for delete-
//        payment and delete-line-item (were instant no-confirmation deletes);
//        useToast feedback on delete success/error; distinct empty states —
//        loading spinner / "no invoices match filters" + clear CTA / "no
//        invoices yet" + create CTA.
// v1107: QA (/qa) — Page 84 of the full-app frontend pass. Replaced inline
//        delete dialog with ConfirmDialog (with review details). Added ?qa_id=
//        / ?review_id= deep-link (stripped after mount with replace:true). Added
//        N shortcut (new review when not in input) and Esc cascade (close modal
//        or delete dialog). Role gates: admin/manager/supervisor for create/edit,
//        admin/manager for delete. DataTable loading prop wired for skeleton vs
//        empty-state distinction. Removed `showForm = editingRecord !== null`
//        dead pattern — replaced with separate formOpen boolean. Migrated
//        hardcoded hex (#888888, #991b1b, #f87171) to CSS variable tokens via
//        ConfirmDialog. Fixed created_at column to use formatDateTime().
// v1106: Asset Management — ?asset_id= deep-link, Esc cascade, N shortcut, search bar,
//        distinct empty states, ConfirmDialog delete, role-gated delete (admin|manager).
// v1105: Jail Management — role gate delete (admin|manager), parseTimestamp in
//        fmtRelativeAge, JailRecordsPage: deep-link ?source_key=, N shortcut,
//        Esc cascade, loading/empty states, role gate ingest (supervisor+),
//        brand tokens (no hardcoded hex), booking search filter.
// v1104: Tasks page — role gates (delete=admin|manager, urgent-priority=supervisor+),
//        notificationRouting: add task/task_assignment entity types + fix case_task
//        routing from /cases?task_id= (no-op) to /tasks?task_id= (correct deep-link).
// v1102: Crime Analysis (/crime-analysis) — Page 79 of the full-app frontend
//        pass. Added ?days= / ?date_range= deep-link (also seeds ?start_date=
//        / ?end_date= for custom range), stripped after mount. Fixed BlueGradient
//        stops (were both #888888, now steel-blue CSS vars). Cell keys changed
//        from array index to stable d.name. Empty states now distinguish "no data
//        for this period" vs "no data available" based on filterActive flag.
// v1101: Reports pages (/reports, /reports/custom) — Page 78 of the full-app
//        frontend audit. Backend: added 7 missing endpoints (comparison,
//        daily-briefing, weekly-digest, patrol-tracking, POST /reports/custom,
//        POST /records/reports/:id/approve, POST /records/reports/:id/return);
//        fixed citation-revenue and response-times response shapes (were
//        returning wrong field names → cards showed all-zeros); fixed
//        crime-trends to return monthlyTrend[] + per-type MoM/YoY table rows
//        instead of raw day/type/count triples. Frontend: CustomReportBuilder
//        gains ?type= deep-link (pre-selects source), Esc cascade
//        (preview→filters→columns→source→/reports). No window.confirm/prompt.
// v1100: Communications — Page 77 of the full-app frontend pass.
//        Implemented messages CRUD backend (GET/POST/PUT read+ack/DELETE)
//        + emergency-broadcast (accepts content not message) + drafts POST
//        + activity-feed real D1 query in stubs router. Client: BOLO search
//        field + distinct empty states (no-BOLOs vs no-results), role gates
//        (canCreateBolo: supervisor+ only sees New BOLO/resolve/archive/N
//        shortcut), Esc cascade clears boloSearch, subject not required in
//        compose (auto-derived from content).
// v1099: Training pages — Page 76 of the full-app frontend audit.
//        TrainingDocsPage: replaced window.confirm() with ConfirmDialog,
//        removed dead isGodMode variable, fixed stale-closure keyboard
//        shortcut (loadDocuments now in deps), added ?doc_id= deep-link,
//        improved empty-state (no-data vs filtered vs no-category).
//        TrainingManagementPage: fixed critical bug where "New Course"
//        modal never opened (showForm was editingRecord !== null, but
//        openNew sets editingRecord = null); added separate showForm boolean,
//        role gate (admin/manager/hr only), Esc cascade, N shortcut,
//        replaced inline delete div with ConfirmDialog, added Docs Library
//        cross-link button. Worker: added 3 missing endpoints —
//        GET /personnel/training-materials, GET /personnel/training-alerts,
//        POST /personnel/training-bulk-assign.
// v1098: Dashcam pages (Page 75) — fixed status panel shape mismatch
//        (DashcamPage read enabled/deviceCount/port/models/uptime which the
//        API never emitted; now reads total_devices/online_devices/active_devices).
//        Removed broken POST /howen/enable stub call and unguarded power-toggle
//        button. Added ?device_id= deep-link + Esc cascade to DashcamPage.
//        Added role-gate (canManage) imports. Replaced 6x hardcoded #d4a017
//        with text-brand-400. Distinct empty states for no-devices vs no-results.
//        Removed unused AlertTriangle + Smartphone imports. Removed dead
//        isGodMode duplicate (= isAdmin) from DashCamerasPage.
// v1097: Body Cameras (/body-cameras) — Page 74 audit. Fixed canManage to
//        include manager role (matched backend WRITE_ROLES). Added ?camera_id=
//        and ?officer_id= deep-links (camera row highlight + officer search
//        seed). Added N shortcut to open Assign Camera. Distinct empty-state
//        messages (no data vs no search results). Removed dead isGodMode alias.
// v1096: Fleet v2 (FleetShell) — Page 73 of the full-app frontend pass.
//        Added N shortcut (open New Vehicle modal when not typing),
//        Esc cascade (closes New Vehicle modal before propagating),
//        ?unit_id= deep-link param (alongside ?vehicle_id= and ?fleet_id=),
//        VehicleDetailRoute now distinguishes loading vs 404 (no more
//        silent blank on a bad ID), GpsTrackingRoute link updated from
//        /fleet-legacy to /map (the actual GPS map surface).
// v1095: Personnel (/personnel) — Page 72 of the full-app frontend pass.
//        Removed dead state (analytics, analyticsLoading, dashcamEvents,
//        deviceMappings, dashcamLoading, refreshDashcamData — never read).
//        Role gate: terminate/archive/restore buttons in detail panel now
//        hidden for officer/dispatcher/client_viewer (admin|manager|supervisor|
//        human_resources only). N shortcut extended to credentials, training,
//        and deployment tabs (was roster+equipment only). Fixed hex tokens:
//        #0a1a0a → bg-green-950/30 (DutyBoard/Deployment/Training),
//        #1a0a0a → bg-red-950/30 (DashCam impact alert). FitnessCommendations
//        apiFetch now guards against wrapper objects {data:[]} on both loads.
// v1089: Community (/community) — Page 71 of the full-app frontend pass.
//        Fixed critical bug: "New Event" modal never opened (showForm was
//        `editingRecord !== null`, but openNew() set it to null). Separate
//        showForm boolean state introduced. Replaced inline delete div with
//        ConfirmDialog. Added Esc cascade (delete → form), N shortcut,
//        ?event_id= deep-link, tab nav for Tips/Watch Groups/Alerts,
//        role-guard hiding write buttons for read-only roles, per-tab lazy
//        loading, and distinct empty-state messages.
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

// v1088: Criminal History (/criminal-history) — Page 70 of the full-app
//        frontend pass.
//        (1) Fixed silent search bug: name/DOB/DL searches sent ?name=/?dob=/?dl=
//            params the server does not read, returning the full 500-person
//            unfiltered list instead of matching records. Name now routes to
//            /records/persons/search?q= (proper LIKE); DOB/DL use the bulk
//            list's ?search= param.
//        (2) Switched person history to /records/persons/:id/system-history
//            (single round-trip, FK-joined) — previously 4 separate fetches
//            used fuzzy name-text search for citations/FIs, returning records
//            for anyone with a similar name, not the selected person.
//        (3) Added CriminalHistorySection panel — formal arrest/conviction/
//            charge records from the criminal_history table were absent.
//        (4) Added WarrantNsopwStatus panel — NSOPW nationwide SOR cross-ref.
//        (5) Esc smart-cascade: Esc while person selected returns to list.
//        (6) ?subject= URL param pre-fills and auto-fires name search.
//        (7) ConfirmDialog on CriminalHistorySection delete (was bare click).
//        (8) normPerson() handles dob/gender/dl_number aliases from bulk list.
// v1086: Daily Activity Reports (Page 68 audit). Fixed: search param was sent
//        by the client but silently ignored by the Worker (no LIKE clause);
//        pagination.totalPages missing from API response (client showed page 1
//        always); client sent limit= but Worker read per_page=; reviewed_by_name
//        never populated (only officer join, no reviewer join). Added:
//        ?officer_id= and ?date= URL deep-links (pre-seed filter + strip);
//        equipment_issues + recommendations edit fields (were in PDF + type but
//        no UI to write them); ensureTable idempotent ALTER for new cols.
// v1083: Evidence (Page 65) — add 8 missing backend sub-resource endpoints
//   (chain-action, checkout, checkin, disposition, request-release,
//   approve-release, custody-validation, linked-records); fix ?id= deep-link
//   from QuickSearchCard; gate Approve/Deny release to supervisor+; seed
//   ?status= and ?case_id= URL filters on mount.
// v1084: Citations (/citations) — Page 66 of the full-app frontend pass.
//        (1) Stats bar was always showing zeros: GET /citations/stats returned
//        byStatus as a row array (camelCase) but CitationsPage read it as
//        by_status: Record<string,number>. Worker now returns both shapes plus
//        the missing fines_issued, fines_collected, and today_count fields.
//        (2) Deep-links: ?plate=<plate> pre-fills the search box (incoming from
//        PlateLog "View citations for plate"); ?officer_id=<id> pre-fills with
//        the officer id (incoming from Personnel). ?citation_id=<id> already
//        existed. (3) Plate in detail view now has an "ALPR" button that
//        navigates to /intel/plate-log?plate=<plate> for history. Right-click
//        context menu also gets "View plate history" when plate is present.
//        (4) Court Information section header now has a "Court Tracker" link
//        that navigates to /court.
// v1082: Incidents (Page 64) — source-call buttons now deep-link to
//        /dispatch?call_id=<id> so clicking the call number from an incident
//        auto-selects that call in the Dispatch CAD board. Previously both
//        "SOURCE CALL" header and "Linked Call" info-panel buttons navigated
//        to /dispatch with no context, leaving operators to find the call
//        manually. No schema or API changes.
// v1081: Patrol (/patrol) — Page 63 of the full-app frontend pass. Added Esc
//        smart-cascade (QR modal → Checkpoint modal), N shortcut to open the
//        New Checkpoint form on the Checkpoints tab, four-way empty-state
//        distinction (no-checkpoints-ever / no-scans-with-filters / no-scans-
//        ever / no-active-checkpoints-for-compliance), and removed dead
//        coverageData/handleLoadCoverage state that was defined but never
//        rendered anywhere in the JSX.
// v1070: Cmd+K Global Search — scope recent-search history per user.id
//        instead of sharing one bare 'rmpg-recent-searches-v2' localStorage
//        key across every operator on the MDT. A shared patrol laptop was
//        leaking one officer's recent name/plate/badge queries to the next
//        person who opened the dialog. Now keyed on
//        `rmpg_globalsearch_recent_${user.id}`, with a one-time read-through
//        migration that copies the legacy bare key into the first
//        signed-in user's slot and then deletes the legacy key so the
//        next user doesn't inherit it. Reads/writes are skipped entirely
//        when no user is signed in (mid-login first render). Mirrors the
//        SkipTracerPage history pattern (PR #1657 / SW v1065).
//        SW name auto-stamps via vite plugin — bump here is documentation.
// v1079: Web Research (/web-research) — Page 61 of the full-app frontend pass.
//        WebResearchPage was a Firecrawl-backed search + saved-results
//        surface but had no court-ready export, no URL deep-link, no
//        per-user privacy on the (PII-sensitive) recent-query log, no
//        Esc cascade, no N shortcut, and a silent window.confirm() guarding
//        the destructive delete path. Audit fixes:
//          * Court-ready PDF — new webResearchReportPdf renders the active
//            filter slice of saved results into the canonical Arial+gold
//            audit-series artifact (banner, export context, per-row entries
//            with title/URL/metadata/notes/scraped excerpt capped at 2000
//            chars, OSINT chain-of-custody disclaimer in the footer). Six
//            vitest smoke tests cover normal/empty/truncated/optional-attr
//            shapes. PDF entry point lives in the page header toolbar.
//          * URL deep-link contract — ?research_id=<n>, ?query=<text>,
//            ?tab=<search|saved>. Consumed once + stripped with replace:true
//            so a hard refresh doesn't re-pin to a stale row.
//          * ConfirmDialog — replaces window.confirm() on delete (shows
//            title/URL/query/linked-entity context) AND adds a new clear-
//            history confirm where the older "Clear" link silently nuked
//            localStorage on a single click.
//          * Per-user recent-query history — scoped to user.id under
//            rmpg_web_research_history_<uid> so a shared MDT can't leak
//            one operator's subject-name/plate-number queries to the next.
//            Capped at 20 entries; click-to-rerun chips below the search.
//          * Esc smart-cascade — link modal -> notes editor -> results ->
//            query -> filter (newest-open-first; one Esc per layer).
//          * N shortcut — opens a new search (typing-suppressed).
//          * Firecrawl-offline banner — replaces the LED-only signal so
//            operators see WHY a search returns empty when the API key
//            isn't configured.
//          * Hydrate-on-mount — saved-results count now loads on mount
//            so the tab-strip badge advertises existing research from any
//            deep-link landing, not just from clicking the Saved tab.
//          * notificationRouting — `research_result` + `web_research`
//            entity_types now deep-link to /web-research?research_id=
//            (covered by 2 new vitest assertions). Client-only PR; no
//            Worker route changes, no D1 migration.
//        SW name auto-stamps via vite plugin — bump here is documentation.
// v1076: Documents (/documents) — Page 58 of the full-app frontend pass.
//        URL deep-link (?folder=&q=&file_id=) so cross-page links and
//        refreshes land on the same view; ?folder= hydrates the initial
//        directory, ?file_id= opens that file once contents load, both
//        stripped after applying. Three native window.confirm() prompts
//        (deleteFolder / deleteFile / bulkDelete) replaced with shared
//        ConfirmDialog (danger variant, Cancel pre-focused, identifying
//        details — subfolder/file counts, file size + MIME, bulk count).
//        Esc cascade: file-info modal → rename → new-folder → confirm
//        dialogs → clear search → clear selection → up one folder. 'N'
//        opens the file picker (parity with Equipment / FlexCam / CRM
//        audits). Emoji file icons (🖼️📄🎬🎵📝📊📦📃📎) replaced with
//        Lucide File* components — emojis don't pick up theme variables
//        so they read pure-color against the Spillman day/night skin and
//        were flagged by the page-audit emoji-chrome rule. Two
//        `hover:text-[#d4a017]` hardcoded hex swapped to `hover:text-brand-400`
//        so the Edit-PDF affordance follows brand-gold token instead of
//        a literal.
// v1075: Document Intake (/document-intake) — Page 57 of the full-app
//        frontend pass. Layout was a clean three-state finite-state-machine
//        but lacked the per-page contract every v1024+ audited surface
//        exposes: no keyboard cascade (Esc was a no-op, N didn't reopen the
//        picker), no deep-link (`?new=1` now lands directly on the picker),
//        a "Upload Another" button that silently dropped pending clerk
//        edits, inline hex (#d4a017 / #888 / #0a0a0a / #10b981 / #eab308 /
//        #ef4444) instead of theme tokens, and no print path for the
//        extraction. This bump adds the cascade + N shortcut + `?new=1`,
//        gates the destructive reset through a ConfirmDialog when the
//        clerk has dirty edits, sweeps the page + reviewer onto the
//        brand-gold-* / sev-* / rmpg-* tokens (so the night/day shift now
//        re-themes), and lands a new utils/documentIntakePdf.ts emitting
//        a clerk-trail one-pager (source + detected kind + per-field
//        confidence band + value + OCR original + raw-text preview) so a
//        supervisor reviewing the intake queue or a discovery responder
//        has a printed record of what got pulled before it landed in
//        records. Covered by 21 unit tests in documentIntakePdf.test.ts.
//        SW name auto-stamps via vite plugin — bump here is documentation.
// v1074: Quick Capture (/intel/quick-capture) — Page 56 of the full-app
//        frontend pass. Officer's 30-second on-scene contact logger; the
//        page already did the one-POST dedupe-or-create person + vehicle
//        + FI + screening dance, but was missing every audit-series
//        contract.
//          • ?call_id= / ?incident_id= deep-link — when launched from a
//            dispatch call card / incident detail with a context query
//            string, the resulting FI is now stamped on the server
//            (field_interviews.associated_call_id /
//            associated_incident_id columns existed since baseline) so
//            the contact appears on the call's / incident's timeline.
//            A persistent chip at the top of the page tells the operator
//            "Logging contact on Call #123" with an X to unlink. Context
//            persists across multiple captures on the same scene
//            (different from login-style flash banners that strip on
//            mount) — logging several FIs against one call is the
//            dominant on-scene pattern.
//          • Esc smart-cascade — busy gate first (lets the network
//            finish), then close the result panel, then clear typed-but-
//            unsaved form. Single Esc never blasts past a state the
//            operator wanted to keep. Suppressed during in-flight POST.
//          • N shortcut — clears the form and focuses First Name. Same
//            N=New convention as Citations / Warrants / FI / Arrests /
//            Cases / etc. Suppressed inside inputs and modifier chords.
//          • Print FI — court-ready PDF for the just-written FI via the
//            existing recordPdfGenerator field_interview type and the
//            shared PrintRecordButton. The FI is hydrated from
//            /field-interviews/:id on click rather than constructed from
//            the local form, so officer name, badge, canonical fi_number,
//            and the resolved person/vehicle ids come from the server.
//            Lazy load (no fetch unless the operator asks to print).
//          • Privacy mask — DOB is the most sensitive field on this page;
//            digits render as bullets by default with an eye-toggle
//            reveal (focus reveals so the operator can type, eye-icon
//            re-hides). Plate stays visible because it's the operator's
//            only visual confirmation that the correct vehicle attached.
//            autocomplete=off + spellCheck=false on the DOB field so
//            password managers and dictation engines don't pick it up.
//          • GPS visibility — explicit re-acquire button (Crosshair
//            icon) with hover-title showing the actual lat/lng + meter
//            accuracy that will be stamped on the FI. The first-mount
//            fix is the same silent best-effort as before (GPS is a
//            bonus, manual location always works); but mid-shift /
//            mid-drive on-foot operators were typing locations because
//            the page showed no signal that the fix was 10 minutes old
//            and 800m off. Permission-denied surfaces an error toast;
//            timeout / position-unavailable surface a warning + retry.
//          • Theme tokens throughout — no hardcoded #d4a017 / #888888 /
//            arrow glyph in chrome. text-brand-400, text-rmpg-400/500,
//            border-brand-400, AlertTriangle icon, ArrowRight icon
//            (the "→" was the only Lucide-able chrome glyph on the
//            page; the "⚠" in the critical banner became AlertTriangle).
//            Red critical-hit banner kept verbatim (bg-red-950 etc.) —
//            the audit's "no hardcoded hex" rule is about brand surface
//            tokens; semantic alert colors stay opaque so a stuck/
//            mistuned palette can't make a critical-records-hit banner
//            blend into a normal info row.
//        Server: src/routes/intel.ts /quick-capture accepts call_id +
//          incident_id in the body and writes them to
//          associated_call_id / associated_incident_id on the new FI
//          row, and echoes them on the response. Number-coerced (NaN →
//          null) so a stringly-typed body doesn't trip D1.
//        Tests: 4 new vitest cases (deep-link call/incident, N shortcut
//          focus, Esc clears form). Existing critical-hit test kept.
//        SW name auto-stamps via vite plugin — bump here is documentation.
// v1072: Court Records (/court-records) — Page 54 of the full-app frontend
//        pass. CourtRecordsPage is the historical-disposition counterpart to
//        CourtTrackerPage (/court, which is the upcoming-dates view); both
//        sit on the same court_events table. The page shipped with the
//        right column set and a usable filter bar but had a one-line Esc
//        handler that wrote `setShowCreateModal(false); setShowCreateModal(
//        false)` twice — a duplicate that not only never closed the
//        Outcome modal but also obviously survived a copy/paste — no
//        deep-link contract, no print path even though the renderer
//        (courtAppearancePdf, already wired into Court Tracker) was
//        sitting one import away, no confirmation on the outcome submit
//        (recording an outcome legally closes the docket entry with no
//        silent undo), and `useFormDraft` keys leaking half-typed case
//        numbers / fines / sentences between operators on shared MDTs.
//        Operators jumping from a notification or context-menu link had
//        nowhere to land — every "open court event" deep link 404'd at
//        the routing layer because no `court_event` entry existed in
//        ENTITY_ROUTE_BUILDERS (and during the audit, the `arrest_record`
//        / `arrest` entries the Page 43 PR added tests for had ALSO never
//        been merged into the routing map — fixed alongside).
//
//        What changed:
//          • URL deep-link contract: ?event_id=<n> / ?court_event_id=<n>
//            (the alias matches Court Tracker's contract so a single
//            notification deep-link works from both pages), ?case_id=<n>
//            (resolves to the case's court_case_number via /cases/:id and
//            seeds the search), ?docket=<str> (free-text docket lookup
//            seeding the search box), ?status=<scheduled|continued|…>
//            and ?type=<arraignment|trial|…> (preselect filters BEFORE
//            the first fetch settles, so the request already hits the
//            filtered server view and there's no flash of unfiltered
//            data). All one-shot — params are consumed and stripped with
//            replace:true so a refresh doesn't re-pin. Direct-fetch
//            fallback when the event id isn't in the current paged view
//            (prepend pattern, matching ArrestRecordsPage).
//          • notificationRouting: `court_event` → /court-records?event_id=
//            entry added so a "hearing reminder" / "outcome recorded" /
//            "continuance granted" notification lands on the docket entry
//            itself rather than fall through to the null default. While
//            in that file the audit caught that the Page 43 PR (#1655)
//            added two routing tests for `arrest_record` and `arrest`
//            but never actually merged the matching entries into
//            ENTITY_ROUTE_BUILDERS — every arrest notification was
//            silently routing to "/" via the type-fallback path. Both
//            entries added alongside (3 routing tests now green).
//          • Court-ready PDF: reuses the courtAppearancePdf renderer
//            CourtTrackerPage uses — Arial + RMPG-gold-banner courtroom
//            sheet covering case header, parties, judge, witnesses, fees,
//            bail, continuances, outcome, signature line. Wired into the
//            expanded-row toolbar AND the right-click menu; PDF reads
//            from the hydrated single-event detail (which parses the
//            witnesses / officer_confirmations / continuance_log /
//            court_fees JSON columns) when available, falls back to the
//            list-row snapshot when not. Operator-attribution footer
//            pulled from the logged-in user.
//          • Native dialogs → ConfirmDialog: the Outcome modal's "Save
//            Outcome" was a single-click submit that wrote outcome +
//            sentence + fine + status='completed' in one shot. Now
//            ConfirmDialog (warning variant) intercepts with the
//            event #, defendant, case #, selected outcome label,
//            sentence, and fine in the details slot so the operator
//            sees what they're about to legally finalize. Saving and
//            cancellation flows preserved.
//          • Esc smart-cascade (highest-priority layer first): outcome
//            confirm → outcome modal → create modal → expanded row →
//            error banner → active filters. Each branch returns so a
//            single Esc doesn't collapse multiple layers. The previous
//            duplicated handler only ever closed the create modal — and
//            even that was the literal repeated line.
//          • N shortcut: opens New Event (typing-suppressed; suppressed
//            inside open modals/dialogs). Matches the Trespass / Field
//            Interview / Equipment / Notifications / Arrests / Forensic
//            Lab / Skip Tracker / Use of Force / Tasks / CRM / Court
//            Records muscle memory built up over the page-pass sweep.
//          • Per-user form drafts: bare `rmpg_court_records_create` /
//            `_outcome` keys would leak a half-typed prosecutor name,
//            sentence string, or fine amount from operator A's screen
//            to operator B on a shared MDT — especially bad for outcomes,
//            where the leaked text is a literal pre-decided ruling.
//            Scoped to user.id; outcome-form key further scoped to the
//            event id so switching events doesn't carry the prior
//            event's draft sentence forward (the most reported source of
//            cross-event outcome contamination during the audit).
//          • Hydrate state from server: expanding a row now fetches
//            /court/events/:id (which parses the witnesses /
//            officer_confirmations / continuance_log / court_fees JSON
//            columns and includes judge_notes / bail_*). The list
//            endpoint returned the bare row, which the PDF could only
//            render partially. Used for both detail-pane display and
//            the court-ready PDF.
//          • Cross-link to Court Tracker (#1613): expanded row + right-
//            click menu both offer "Open in Court Tracker" (navigates
//            to /court?event_id=<id>) and "Open linked case" when
//            case_id is set — closing the loop between the two
//            counterpart pages on the same court_events table.
//          • Empty-state distinction: collapsed "no records" and
//            "filters hiding everything" into one ambiguous string.
//            Filter-empty state surfaces the unfiltered total + Clear
//            button; no-data state shows the create CTA + N hint.
//          • Document title: reflects the expanded event ("CRT-2026-
//            00042 — Court Records") so a tab switcher can tell two
//            court-record panels apart.
//          • Theme tokens: three hardcoded `text-[#d4a017]` heading
//            colors → `text-brand-gold-500` so the gold re-themes
//            correctly between night and day (Spillman day/night theme
//            compliance — see project-systemwide-daynight-theme).
//          • A11y: added aria-label to the previously unlabeled error-
//            dismiss X button, status/type/date filter selects, the
//            paging Previous/Next buttons, both modal close-X buttons,
//            and both modal dialog containers (aria-label on the
//            role=dialog element so a screen-reader announces which
//            modal opened).
//          • Bug fix — Esc handler was the literal duplicated line
//            `setShowCreateModal(false); setShowCreateModal(false);`
//            with no outcome-modal branch, no expanded-row branch, and
//            no filter branch. The Outcome modal therefore could only be
//            dismissed by clicking the X — the rest of the cascade is
//            new contract.
//
//        No D1 migration, no Worker route changes — client-only. The
//        court_event routing test plus the previously-failing arrest
//        routing tests now all pass; 16/16 notificationRouting tests
//        green where the baseline was 15/16 (the broken arrest test
//        was the one chronic failure on main).
// v1070: Internal Affairs (/affairs) — Page 52 of the full-app frontend pass.
//        IA complaints are court / civil-rights material the moment a 42 USC
//        1983 or POST decertification proceeding starts. The page shipped with
//        a list + form modal but no detail panel, no URL deep-link contract,
//        no court-ready PDF, no Esc handler, no N shortcut, no privacy banner,
//        no investigations surfacing at all (the /affairs/complaints/:id/
//        investigations endpoint existed but was never called), and zero
//        recordAudit() hooks anywhere on the IA route.
//        Client (client/src/pages/AffairsPage.tsx, +affairsComplaintPdf.ts):
//          - URL deep-link: ?complaint_id=<n>, ?investigation_id=<n>, ?new=1
//          - Split list / detail surface; detail loads the investigations
//            list on demand from the existing route.
//          - Court-ready PDF (affairsComplaintPdf) with the same RMPG-gold
//            CONFIDENTIAL banner, tamper-evidence statement, payload-hash
//            trailer and signature lines as forensicCasePdf / arrests /
//            evidenceItemPdf — UT GRAMA §63G-2-302 + POST §53-6-211 cited
//            on the confidentiality strip.
//          - Esc smart-cascade: delete → form → error → detail → filters.
//          - N opens "new complaint" (typing-suppressed). Visible "(N)" hint.
//          - Privacy advisory banner on the page itself + CONFIDENTIAL footer
//            on every PDF page.
//          - Status / type / free-text filter bar with distinct empty states
//            for "nothing filed yet" vs "filter matches nothing".
//          - Document title reflects the selected complaint.
//          - 17 unit tests for affairsComplaintPdf helpers + smoke generation.
//        notificationRouting.ts: ia_complaint + ia_investigation entity types
//          deep-link to /affairs?complaint_id= / ?investigation_id= so a
//          watchlist hit / supervisor referral notification lands directly
//          on the row instead of the IA list. +2 tests.
//        Worker (src/routes/affairs.ts):
//          - recordAudit() wired into create / update / delete on complaints,
//            create / update on investigations, raise / resolve on early-
//            intervention flags — IA edits are now part of the central audit
//            seam (audit_log + flex_events mirror). Actions:
//            IA_COMPLAINT_FILED / IA_COMPLAINT_UPDATED / IA_COMPLAINT_DELETED
//            / IA_INVESTIGATION_OPENED / IA_INVESTIGATION_UPDATED /
//            IA_FLAG_RAISED / IA_FLAG_RESOLVED.
//          - Missed auto-stamp: status='reviewed' now stamps reviewed_at via
//            COALESCE alongside the existing status='completed' →
//            completed_at stamp.
//        No D1 migration — ia_complaints / ia_investigations /
//        early_intervention_flags schema unchanged.
// v1077: Help (/help) — Page 59 of the full-app frontend pass. URL
//        deep-linking: ?topic=overview|shortcuts|modules|dispatch|faq|system
//        +?faq=<idx> +?search=<term>; back/forward buttons stay in sync.
//        Added a content search across shortcuts, modules, and FAQ
//        (press / to focus, Esc smart-cascade: clear search → collapse
//        expanded FAQ → drop back to Overview). New Quick Reference Card
//        PDF (helpQuickReferencePdf.ts) — 2-page tear-off with shortcuts,
//        priorities, statuses, and CAD commands — exposed from the Help
//        page sidebar AND the MenuBar Help → Training & Docs submenu.
//        Single source of truth for reference data extracted to
//        utils/helpReferenceData.ts so HelpPage + the PDF builder + the
//        MenuBar item all consume the same constants. Stale System Info
//        fixed: "Express + SQLite" → "Cloudflare Workers + Hono / D1 /
//        R2 / KV / Durable Objects"; auth now reflects "JWT (TOTP/
//        WebAuthn not yet ported)". DB schema version + user count
//        surfaced from /api/health response.
// v1073: Mass Notification Templates (/alerts) — Page 55 of the
//        full-app frontend pass. AlertsPage manages Rave-Alert-parity
//        notification templates (the API at /api/alerts is templates +
//        batches; this surface is templates-only). What this PR adds:
//          - URL deep-link contract: ?template_id (highlight + scroll
//            into view; toast + filter-clear if a current filter is
//            hiding it; param stripped on consume so a refresh doesn't
//            re-pin to a stale link), ?category, ?channel.
//          - Filter bar (channel + category) with the category
//            dropdown distilled from the server payload (no useless
//            empty selects on a fresh install). Empty-state distinction:
//            "No notification templates" (server returned zero) vs
//            "No templates match the current filter" (a filter is
//            hiding everything; one-line description suggests Esc /
//            Clear to recover — same pattern as v1056 Notifications).
//          - ConfirmDialog replaces the inline delete modal. The old
//            modal hardcoded #888888 body text, #991b1b border, #f87171
//            confirm text — all gone. ConfirmDialog pre-focuses Cancel,
//            traps focus, body-scroll-locks, owns its own Esc.
//          - Esc smart-cascade: delete confirm (handled by
//            ConfirmDialog) → edit modal → clear filters. Falls
//            through (no preventDefault) when nothing on the page is
//            open so a global upstream handler can still react.
//          - "N" shortcut opens New Template (skipped when typing in
//            an input/textarea/select, when a modal is open, or when
//            any modifier key is held).
//          - Cmd/Ctrl+Enter inside the edit modal saves.
//          - Highlight ring on the deep-linked row via DataTable's
//            existing `selectedKey` prop; fades after 4s.
//          - aria-label on the icon-only Edit/Delete row buttons
//            (was just `<Pencil />` / `<Trash2 />` with no a11y label).
//        Entity-aware routing / severity colors / alert-source
//        attribution from the prompt = N/A. This page is template
//        management, not an alert feed. Distinct from the
//        /notifications inbox (Page 39, v1056) and the per-user
//        NotificationCenter dropdown.
//        SW name auto-stamps via vite plugin — bump here is documentation.
// v1071: Person Dossier (/intel/person/:id) — Page 53 of the full-app
//        frontend pass. The 360° subject workspace already aggregated
//        identity, flags, cluster, timeline, associates, vehicles,
//        addresses, escalation, and watched-state from a single
//        /api/intel/dossier/person/:id call — and the server has shipped
//        `linked_intel` (disseminated intel reports naming this subject)
//        for a year — but the page never rendered it. The data was only
//        reachable from the Intel Reports list, never from the subject
//        whose name was in the report. New LINKED INTELLIGENCE section
//        (left column, below Addresses) lists each report with number,
//        threat level (color-coded), role, title, dissemination date,
//        and handling code; each row deep-links to /intel/reports/:id.
//        A header-band chip ("N INTEL REPORTS") flags presence at a
//        glance. Court-ready dossier PDF (dossierPdfGenerator) gained
//        matching LINKED INTELLIGENCE + ACTIVITY TREND sections — the
//        printed packet now reflects the screen, including the 30d-vs-
//        90d escalation metric that was previously chip-only. Esc cascade
//        added (photo zoom → navigate back; read-only page, short stack
//        by design). 404 from the dossier endpoint now renders a
//        distinct "No person on file for #id" empty state instead of
//        the generic red error line — important when a merged/deleted
//        person id is followed from a stale link. Photo click-to-
//        enlarge modal (full-bleed, Esc to close, click-outside to
//        dismiss). PDF export button now disabled-while-generating
//        with a 600ms debounce to defeat the double-press-two-PDFs
//        race when jsPDF Arial-font registration is slow. Escalation
//        chip carries a tooltip with raw recent/baseline counts.
//        Tests extended: linked_intel rendering, escalation tooltip
//        content, 404 empty state distinction, Esc handler wiring.

// v1069: Invoices — wire up GET /api/invoices/:id/pdf-data on the Worker.
//        No client code changed; the endpoint already had three callers in
//        client/src/pages/admin/AdminInvoiceTab.tsx (Preview, Download PDF,
//        Print) but the route did not exist on the Worker — every Download
//        PDF / Preview / Print click silently 404'd. Caught during the
//        Billing audit (PR #1648). The new route returns the denormalized
//        payload shape the client-side invoicePdfGenerator expects (invoice
//        + line items + payments + client / billing fields) under
//        { data: { invoice: …, line_items: […], payments: […] } }, with
//        sensible COALESCE defaults for schema columns we never landed
//        (period_start/end, discount_amount, late_fee_amount, line_type).
//        SW name auto-stamps via vite plugin — bump here is documentation.

// v1078: Knowledge Base (/knowledge-base) — Page 60 of the full-app frontend
//        pass. The page is the system-wide one-search-box destination — the
//        twin of the global Cmd+K palette — and shipped with a thin URL
//        contract (?q= only, so a reload of an active filter chip silently
//        dropped it), no keyboard navigation (Cmd+K had ↑↓/Enter; the
//        dedicated page didn't, despite operators expecting parity), no Esc
//        handler at all (Esc inside the input did the browser default — a
//        hidden noop on macOS), no print path (operators were screenshotting
//        the list into case folders, which is not a record), and a global
//        chrome that hardcoded the brand gold (#d4a017) and the surface-base
//        almost-black (#0a0a0a) — so neither would re-theme between night
//        and day. Recent-searches existed in the global palette but were
//        unscoped (rmpg-recent-searches-v2), which had been called out as a
//        cross-operator privacy leak in v1065 (SkipTracker per-user key
//        rollout).
//
//        What changed:
//          • URL deep-link contract — ?q=<query>&type=<typeFilter>. The
//            active type chip now round-trips on reload / share so a
//            "?q=smith&type=warrant" link reopens to exactly the same view
//            the operator saw when they grabbed the URL. ?q clears once the
//            field empties, ?type persists across query edits inside the
//            same session.
//          • Keyboard contract matches GlobalSearch — ↑↓ navigate, Enter
//            opens the highlighted row, Esc smart-cascades: filter chip →
//            query → blur. Hovering a row syncs the keyboard cursor so a
//            mouse-and-keyboard mix doesn't fight itself.
//          • Per-user recent searches — rmpg_kb_recent_${user.id}. A shared
//            MDT no longer leaks one operator's queries (subject names,
//            plates, badge numbers) to the next person to sit down. Bare
//            key intentionally not migrated: the previous page never
//            persisted anything locally, so there's nothing to carry.
//            Surfaced as an interactive list on the empty state with a
//            one-click Clear (no ConfirmDialog: low-cost, easy to refill).
//          • Court-ready PDF export — new client/src/utils/
//            knowledgeBaseSearchPdf.ts (11 unit tests covering ellipsize,
//            groupByType, empty-results, single-type, multi-type-grouping,
//            many-rows-pagination, active-type-filter header, missing
//            officer attribution, and case-number capture). Same Arial +
//            RMPG-gold visual contract as darPdf / skipTracerReportPdf /
//            shiftReportPdf / forensicCasePdf so a multi-surface court
//            binder keeps a consistent look. "Print Results" toolbar
//            button appears once a search has returned rows.
//          • Empty-state distinction widened — three states now: no query
//            yet (recent-list + keyboard-cheatsheet), 0 results matched
//            (with "try a shorter substring" hint), and "0 results in
//            this filter" (with one-click "Show all N results" reset so
//            the operator doesn't have to remember which chip is active).
//          • Auto-drop a stale chip — if the new result set has zero rows
//            of the active type, the chip releases itself. Otherwise the
//            operator stares at "0 results in this filter" with no way
//            back without finding the chip.
//          • Theme-token chrome — the search-box top accent and the active
//            "All N" chip background/foreground now read var(--brand-500)
//            and var(--surface-base) instead of #d4a017 / #0a0a0a, so both
//            re-theme between night and day. The per-type accent chips
//            keep their decorative per-type hex (call=#22c55e etc.) by
//            design — same call-out the SkipTracker (v1065) made for its
//            per-mode chips.
//
//        Worker: untouched. /api/knowledge-base/search is the same shared
//        endpoint Cmd+K already calls.
//
//        Not in scope for this PR (deferred):
//          • The Cmd+K global palette (client/src/components/GlobalSearch
//            .tsx) still uses the unscoped rmpg-recent-searches-v2 key.
//            Migrating it to a per-user key has the same leak shape as the
//            KB page above and should land as a follow-up so the two
//            surfaces stay in lockstep — see spawned task.
//          • Server-side search ranking is unchanged. The page is a
//            presentation layer over the existing endpoint.
//
//        SW name auto-stamps via vite plugin — bump here is documentation.

// v1065: Skip Tracker (/skip-tracer) — Page 48 of the full-app frontend pass.
//        Two-part fix. (1) The page's server surface was dead: every
//        client search hit /skiptracer/search/{byname,byaddress,bynameaddress,
//        byphone,byemail}, /skiptracer/person/:id, and /api/skiptracer/export/csv
//        — none of which existed on the rewrite Worker. The legacy VPS
//        "v2 worker" that historically owned those round-trips was
//        decommissioned 2026-06-15 (memory: project-vps-decommissioned),
//        so every search 404'd silently. src/routes/skiptracer.ts now
//        implements the full surface against the rewrite's own D1 corpus
//        — persons + dl_records + microbilt_searches as a search cache —
//        with per-mode audit_log entries via recordAudit. Result rows are
//        returned in the legacy "PeopleDetails" envelope so the client
//        (and NcicQueryPanel which also calls these paths from the QS
//        cross-reference) doesn't need a parser branch for local-vs-
//        external. Microbilt-style "Lives in"/"Person ID" fields are
//        synthesised from the local row so the same renderer works.
//        (2) The page itself is brought up to the audit-series contract:
//          • URL deep-link: ?subject_id=<n>&mode=<m>&search=<q> — consumed
//            once and stripped (replace:true) so a refresh doesn't loop.
//          • ConfirmDialog over silent destroy: "Clear" search history
//            was a one-click localStorage.removeItem — now a danger-
//            variant dialog with the entry count + most-recent query in
//            the detail block. Matches FlexCam / Geography / DAR pattern.
//          • Esc smart-cascade: extended detail → selected → error →
//            results → empty. Suppressed while typing.
//          • `N` shortcut: clears the form + focuses the active mode's
//            input. Suppressed inside fields/dialogs/modifier chords.
//          • Per-user search-history (DlSearch #1601 pattern): the bare
//            `rmpg_skiptracer_history` key leaked one operator's name/
//            phone queries to the next person to use a shared MDT. Scope
//            is now `rmpg_skiptracer_history_${user.id}` with a one-time
//            read-through migration so existing local history isn't lost.
//          • Court-ready investigator-handoff PDF: new client/src/utils/
//            skipTracerReportPdf.ts (5 unit tests covering Microbilt
//            envelope shape, lower_snake local rows, mixed-shape arrays,
//            empty subjects, and officer-attribution footer). Operators
//            previously screenshotted the detail pane to file a lead in
//            a case folder. Toolbar PDF button appears once a subject is
//            selected; same generator is also wired into the result-row
//            right-click menu.
//          • Empty-state distinction: "no search yet" vs "search ran, 0
//            hits" — the right pane now shows a "Start over" CTA on
//            zero-results so the operator has a one-click reset instead
//            of having to re-find the form on a mobile collapse.
//          • setTimeout(handleSearch, 100) race in rerunSearch replaced
//            with an effect-driven pendingRerunRef that waits for the
//            updated handleSearch closure to see the freshly-set query
//            state before firing. The 100ms guess was visibly flaky on
//            slow MDTs (search ran with the previous query).
//
//        Theme: per-mode chip accent hex values kept (decorative
//        per-mode icon tints that don't re-theme in either direction);
//        the single rgba(136,136,136,0.15) avatar background tile
//        migrated to var(--surface-raised).
//
//        Worker: src/routes/skiptracer.ts gains 7 endpoints. No D1
//        migration — only reads existing tables. recordAudit wired so
//        every skip-trace becomes part of the central audit seam (and
//        therefore reaches flex_events). Existing /status, /stats,
//        /dossiers, /dossiers/:id endpoints untouched.
//
// v1066: Forensic Lab (/forensic-lab) — Page 49 of the full-app frontend pass.
//        Forensic case files are direct court-record material: defense
//        counsel subpoenas them during discovery to challenge lab
//        methodology and exhibit chain-of-custody. The page shipped with
//        rich in-app detail panels (case header, exhibits with custody
//        chain, analyses, QC, timeline) but had no print path, no URL
//        deep-link contract, two `window.prompt()` calls capturing court-
//        record results as single-line text, a one-line Esc handler that
//        ignored every modal except the analysis one, and silently broken
//        case-detail hydration (the `apiFetch<ForensicCase>` typing did
//        not match the server's `{ data: row }` envelope, so the entire
//        detail view was populated with `undefined` fields and rendered
//        the empty-state path).
//
//        What changed:
//          • client/src/utils/forensicCasePdf.ts — new court-ready PDF
//            generator (gold banner, agency strap, TAMPER-EVIDENCE
//            statement, overdue alert, full case header, synopsis,
//            exhibits with mini chain-of-custody tables, analyses with
//            methodology/results/conclusion, findings/conclusion,
//            DOCUMENT INTEGRITY trailer with grouped SHA-256 payload
//            hash + per-page footer carrying the hash prefix, lead-
//            examiner + reviewing-supervisor signature lines). Same
//            Arial + RMPG-gold visual contract as evidenceItemPdf /
//            auditLogPdf / bodycamVideoCustodyPdf / equipmentCustodyPdf
//            so a multi-surface court binder keeps a consistent look.
//            Payload hash is computed via pdfIntegrity.computePayloadHash
//            on the canonical case + exhibits + analyses bundle BEFORE
//            generation, so the same hash printed in the trailer is what
//            a future Ed25519 signer (the existing /api/pdf-tools/sign-
//            payload endpoint) would sign over. Generator + helpers are
//            unit-tested in tests/forensicCasePdf.test.ts (12 cases —
//            empty case, full case with hash, no hash, many exhibits
//            paginating, missing chain_of_custody, findings/conclusion,
//            overdue-alert path, the wrapText / fmtTimestamp / fmtDate /
//            parseChain / prettyLabel helpers). New "Court PDF" button
//            sits next to "View Connections" on the case overview tab,
//            with a loading spinner.
//          • fetchCaseDetail unwrap fix — `apiFetch<ForensicCase>` used
//            to discard the server's `{ data: row }` envelope, so every
//            field on `selectedCase` was undefined. Now reads `raw.data
//            ?? raw` so both shapes work. This was THE bug that made
//            the detail view's Exhibits / Analyses / Timeline tabs
//            silently render "no exhibits yet" even when the underlying
//            case had data — the apiFetch return-type lie cascaded into
//            every detail-tab JSX branch.
//          • lab_case_number → lab_number column alignment — the
//            client interface declared `lab_case_number: string` but
//            the server column is `lab_number` (forensics.ts row shape).
//            Renders fell back to undefined → blank chip. Added a
//            `lab_number` field on the interface + a deprecated alias
//            for `lab_case_number`, and updated the 3 render sites to
//            read either, with a `FC-${id}` fallback.
//          • URL deep-link contract — `?case_id=<n>` opens the case
//            detail, `?tab=<overview|exhibits|analyses|timeline|links|
//            hashes|qc|turnaround>` jumps to that detail tab, `?new=1`
//            opens the New Case wizard. Params are stripped after first
//            paint so a refresh doesn't repeatedly re-pin the operator
//            to a stale link. One-shot guard via a useRef so React
//            strict-mode's double-invoke doesn't fire twice.
//          • Two `window.prompt()` → real modal — the "Mark Complete"
//            (exhibit) and "Complete Analysis" buttons captured
//            examination results + conclusion via single-line browser
//            prompts. Both now go through a state-driven FormModal
//            with required multi-line RichTextArea Results + optional
//            Conclusion (analyses only) + busy state on submit + an
//            info banner reminding the examiner the text becomes part
//            of the court record. The Conclusion field is hidden for
//            exhibits since the underlying API ignores it there.
//          • `window.confirm` → ConfirmDialog — `handleUnlinkEntity`
//            used the native confirm for removing a linked entity;
//            now opens a themed ConfirmDialog with danger variant +
//            busy state + a description that clarifies the underlying
//            person/vehicle/case row is NOT affected by the unlink.
//          • Esc smart-cascade — previously closed the analysis modal
//            only. Now cascades topmost-open-first: complete-modal →
//            unlink-confirm → analysis modal → exhibit modal → edit
//            modal → custody modal → link search results → filter
//            chip → error banner → back to list. Typing-surface
//            targets (INPUT/TEXTAREA/SELECT) are ignored so native
//            blur-on-Esc still works in the filter inputs.
//          • `N` shortcut — jumps to the New Case tab from the list
//            view (mirrors the audit-pass convention). Suppressed
//            when a modal is open or a case is selected so it doesn't
//            fight a richtext field somewhere in the detail panels.
//          • Empty-state distinction — `cases.length === 0` previously
//            rendered the same "No forensic cases found" copy whether
//            the operator's filter selected an impossible slice or the
//            DB was actually empty. Now branches on hasActiveFilters
//            and the filtered case shows the active filter summary +
//            a one-click "Clear all filters" CTA. The genuine-empty
//            copy nudges N for keyboard-first operators.
//          • Theme tokens — 14 hardcoded hex values in PRIORITIES,
//            STATUS_CONFIG, the exhibit/analysis status pickers, and
//            the wizard priority selector replaced with severity
//            tokens (`--sev-warn`, `--sev-critical`, `--sev-ok`,
//            `--sev-ok-soft`, `--sev-warn-soft`, `--sev-special-soft`,
//            `--text-muted`) from theme-palettes.css. Re-themes
//            automatically between night (steel-blue) and day (light-
//            grey) without baking the legacy hex in.
//          • Server-side chain-of-custody view-event emit — GET
//            /api/forensics/:id now logs `case_viewed` to
//            forensic_activity_log on every successful read (skipped
//            when Cache-Control: no-cache, i.e. a useLiveSync poll, so
//            polling doesn't spam the activity log). Mirrors the body
//            cameras "case opened" pattern from PR #1619. Defense can
//            now reconstruct "who saw this file, when" from the audit
//            trail without relying on web-server logs.
//          • Dead state purge — removed `labQueue` / `reportTemplates`
//            / `capacity` / `analysisTemplates` state + the 4 fetcher
//            handlers (`handleLoadLabQueue`, `handleLoadTemplates`,
//            `handleLoadCapacity`, `fetchAnalysisTemplates`,
//            `handleEvidenceIntake`) — declared in v1024+ but never
//            wired to a UI. The /forensics/queue/priority, /templates/
//            report, /capacity/planning, /:id/evidence-intake server
//            endpoints they targeted also don't exist on live; bringing
//            them back belongs in the PR that ships the corresponding
//            tabs, not a frontend audit.
//          • Dead client/src/pages/ForensicsPage.tsx deletion — 954
//            lines of unused code (an older Canvas-based reimplemen-
//            tation of Connection Analysis using react-force-graph-2d).
//            The /forensics route already redirects to /connections,
//            which renders ConnectionsPage (the live d3-force version).
//            ForensicsPage.tsx was the only consumer of the
//            react-force-graph-2d dependency + the vendor-graph chunk
//            in vite.config.ts — both removed. Net bundle reduction
//            around 120KB.
//          • Unused PanelTitleBar import removed (the detail header
//            was hand-rolled, the import was lint noise).
//
//        Privacy / role-gating — re-verified. /api/forensics is gated
//        by authMiddleware (forensics router mounted with auth:
//        'required'). Write endpoints (POST/PUT/DELETE) call
//        requireRole('admin', 'manager', 'officer', 'supervisor') —
//        non-officers get 403. The new GET /:id view-event respects
//        the same gate; no PII is leaked by the activity log row (just
//        userId + full_name from the users table, which the operator
//        could already see in the case header).
//
//        Out of scope (deferred):
//          • Server endpoints for `/links`, `/hashes`, `/timeline` —
//            the client calls these but they're not yet implemented in
//            src/routes/forensics.ts. The detail tabs continue to render
//            empty states; building those endpoints is its own PR.
//          • Photo evidence attach to exhibits — needs a server schema
//            column on forensic_exhibits + an R2 upload path. Treat as
//            a separate spike alongside the missing endpoints.
//          • Structured DNA / chemistry / ballistics result fields —
//            today everything is free-text. Significant scope, needs
//            domain-specific validation, separate PR.
//          • Privacy redaction of examiner / QC reviewer names for
//            non-admin viewers — currently every authenticated user
//            sees the full chain. A role-aware redaction layer is a
//            cross-cutting concern (also affects evidence / equipment),
//            tracked separately.

// v1057: Audit Log (/audit) — Page 40 of the full-app frontend pass.
//        The audit log is THE highest-evidentiary surface in the app: it
//        proves chain-of-custody, who saw/edited what, and when. Defense
//        counsel will subpoena it during discovery, so the gap the audit
//        caught was that the page shipped with a CSV export but no court-
//        signable PDF, no URL deep-link contract (a supervisor could not
//        share a link to a specific entry / filter snapshot), no row-to-
//        source-record navigation (a "warrant 47 updated" row had no way
//        to jump to /warrants?warrant_id=47), and a generic empty state
//        that conflated "filtered to nothing" with "log is empty".
//
//        What changed:
//          • Court-ready PDF export — new client/src/utils/auditLogPdf.ts
//            (gold banner, agency strap, TAMPER-EVIDENCE statement, filter-
//            context block, paginated landscape rows with zebra striping
//            and per-page footer, signature block for exporting + reviewing
//            supervisor). Same Arial + RMPG-gold visual contract as the
//            bodycam / dashcam / conversation-transcript / FI / evidence
//            PDFs, so a court package built from multiple surfaces has a
//            consistent "RMPG record" look. New "Court PDF" toolbar button
//            sits next to "Export CSV"; both disabled when no rows.
//          • URL deep-link contract — useSearchParams hydrates filters
//            from `?action=`, `?entityType=`, `?user_id=`, `?date_from=`,
//            `?date_to=`, `?search=` (plus legacy camelCase: entity_type,
//            userId, startDate, endDate, q). `?entry_id=<n>` highlights +
//            scrolls a specific row (brand-gold left rail, toast on miss
//            so the operator knows to widen filters). All consumed params
//            are stripped after first paint so a refresh doesn't re-pin
//            the operator to a stale link. `entry_id` is mirrored back
//            into the URL via the right-click menu's new "Copy deep-link
//            to entry" action so a supervisor can paste an IA-package
//            link straight from a row.
//          • Row-to-source-record navigation — new pure util
//            `getAuditEntityRoute(entity_type, entity_id)` maps every
//            entity_type recorded by the codebase (15+ distinct types,
//            from `call` / `incident` / `warrant` through `dashcam_video`
//            and `inmate`) onto the SPA route + cross-page deep-link
//            param the target page already accepts (`?warrant_id=`,
//            `?call_id=`, `?incident_id=`, etc — the same contract the
//            v1024–v1052 pages established). Routable rows now show an
//            ExternalLink glyph in the Entity column, get a click cursor,
//            and left-click navigates; modifier-click + the right-click
//            "Open …" menu item still work for "new tab" muscle memory.
//            Non-routable entity types (system / config / alpr_capture /
//            field_photo / fleet_vehicle / fleetio) fall through cleanly.
//            Tested in client/src/utils/__tests__/auditEntityRoute.test.ts
//            (16 cases — empty inputs, plural/snake/camel tolerance,
//            URL-encoding of composite ids, system-event passthrough).
//          • Esc smart-cascade — was previously a no-op; now smallest-
//            open: error banner → row highlight → active filter set.
//            Typing-surface targets (INPUT/TEXTAREA/SELECT) are ignored
//            so the browser's native blur-on-Esc still works in the
//            filter inputs.
//          • Tamper-evidence indicator — new inline amber-token pill
//            below the toolbar describing the operational guarantee:
//            audit_log is append-only at the application layer, no
//            UPDATE/DELETE API, retention purges are admin-only and
//            themselves generate audit entries. Same statement is
//            embedded in the court PDF so a clerk receiving the
//            document can read it without context from the operator.
//          • Compliance gaps — `/audit/compliance-report?days=30` was
//            already fetched, but only the headline numbers (login
//            failure rate, active users) were rendered; the `gaps[]`
//            array was dropped on the floor. Now surfaced inline below
//            the compliance row as a horizontally-flowing chip list
//            (date + tooltip = "n entries — below daily minimum"),
//            capped at 30 visible with a "+N more" tail.
//          • Empty-state distinction — same audit finding as the prior
//            16 pages: "no entries found" used the same copy whether
//            the filter selected an impossible slice or the table was
//            actually empty. Now branches on `hasActiveFilters` — the
//            filtered case includes a one-click "Clear all filters"
//            button so the operator can recover without scrolling back
//            up to the filter bar.
//          • Theme-token sweep — replaced one hardcoded `#0a1a0a`
//            literal (the "today entries > 0" highlight background,
//            which read as pure-black-green on the new steel-blue night
//            theme) with a green-rail-on-token-surface pattern so the
//            highlight remains visible on both palettes without baking
//            the legacy black in.
//          • Dead code — removed two unused `i` index args in
//            `stats.topActions.slice(1,4).map((a, i) => …)` and
//            `stats.topUsers.slice(1,4).map((u, i) => …)` (the keys are
//            stable strings; the index was never read).
//
//        Privacy / role-gating — re-verified. /audit is gated by
//        `AdminRoute` (admin OR manager) in client/src/App.tsx, and
//        `src/routes/audit.ts` enforces the same gate at the API
//        (`audit.use('*', authMiddleware role-check)`) plus an extra
//        admin-only requirement on the destructive retention endpoints.
//        The cross-page "Open …" links emitted by the audit row do not
//        bypass any target page's auth (the destination route resolves
//        through the normal React Router → AuthGuard chain).
//
//        Out of scope (deferred):
//          • Sub-/supra-page `?entry_id=` direct-fetch. Pagination is
//            100 rows per page and the audit log is ~6 MB on live, so
//            a deep-linked entry from an older page surfaces a toast
//            instead of a hidden refetch. A future GET /audit/:id +
//            "Locate" affordance would close that loop without forcing
//            a server scan on every link click.
// v1055: Personnel — Equipment (Page 38 of the full-app frontend pass).
//        The Equipment tab + per-officer detail tab + Issue/Edit modal
//        get the same v1024–v1054 court-ready / deep-link contract every
//        other audited surface has. Operator-side equipment custody is
//        the natural counterpart to evidence custody — a firearm or
//        body camera tied to a use-of-force review needs an issuance
//        receipt, a return-condition log, and the officer name on a
//        signed line. The in-app tab showed all of this but had no
//        print path before now.
//
//        What changed:
//          • client/src/utils/equipmentCustodyPdf.ts — new court-ready
//            PDF (banner + agency strap + lost/damaged alert banner +
//            item block + notes + checkout/return log table +
//            issuing supervisor / receiving officer signature lines +
//            generated-on footer). Pure helpers (logEntryDate /
//            logEntryActor / prettyAction) unit-tested in
//            client/src/utils/__tests__/equipmentCustodyPdf.test.ts.
//          • EquipmentTab — FileText action button on every row + right-
//            click "Open custody PDF" menu entry. Per-item checkout log
//            is fetched on demand from
//            GET /personnel/equipment/:id/checkout-log and cached so a
//            repeat open doesn't refetch. Search box (serial / asset
//            tag / make-model / officer name) + CSV export of the
//            filtered view (equipment_<date>.csv).
//          • EquipmentDetailTab — same FileText button on each per-
//            officer card, reusing the already-loaded per-item checkout
//            log when it's expanded.
//          • PersonnelPage URL deep-link contract — ?item_id= /
//            ?serial= / ?assigned_to= and ?tab=equipment auto-redirect
//            to the Equipment tab, validate the target resolves to a
//            row, scroll the matched row into view + flash-highlight
//            (ring-2 ring-brand-400/70), and strip the params so a
//            refresh doesn't re-trigger. ?item_id / ?serial that
//            don't resolve surface a "not found" toast; ?assigned_to
//            seeds the search filter without pinning (officers can
//            have multiple items). Implicit equipment params skip
//            the persisted-tab default on first paint.
//          • Distinct empty states — "no equipment matches your
//            filters" (with Clear-filters button + 0-of-N counter) vs
//            "no equipment issued yet" (with the N shortcut hint).
//            The original generic "No equipment found" couldn't tell
//            an operator whether their filter chip was too narrow or
//            the table was truly empty.
//          • N shortcut — extended from roster-only to also open
//            "Issue Equipment" when activeTab === 'equipment'. Still
//            typing-suppressed (search/select/textarea/contentEditable
//            don't swallow the letter as a shortcut).
//          • Privacy — EquipmentFormModal draft key now scopes to
//            user.id (rmpg_personnel_equipment_form_<uid>) so a half-
//            typed serial number / officer assignment from operator A
//            doesn't leak onto operator B on a shared MDT. Matches the
//            tabKey privacy scope at the top of PersonnelPage that was
//            previously the only user-scoped key on the page.
//
//        No D1 migration, no Worker route changes — client-only. Reuses
//        the existing /personnel/equipment* routes (GET list, GET log,
//        GET /:id/checkout-log, POST /:officerId/equipment, PUT, DELETE,
//        POST /:id/checkout, POST /:id/checkin) without modification.
// v1054: Training Management (/training) — Page 37 of the full-app frontend
//        pass. TrainingPage.tsx (1641 lines) holds the dashboard /
//        records / requirements / calendar tabs and is the supervisor's
//        compliance surface. Officer training jackets are court-record-
//        adjacent — defense counsel routinely subpoenas POST, firearms-
//        qual, and UoF / first-aid records to challenge credibility or
//        arrest authority. Before this PR there was no court-ready print
//        path, two destructive flows used un-themeable window.confirm()
//        prompts, Esc only closed the record modal, and there was no
//        deep-link contract so cross-page "view this cert" links from
//        personnel detail / dashboard couldn't land on the right row.
//
//        Court-ready Training Record PDF
//        - New client/src/utils/trainingCertificatePdf.ts — RMPG-gold
//          banner, audit alert when a "completed" row is missing BOTH
//          certificate # and completion date (court-discovery artifact
//          would leave the building with no documentary backing),
//          sub-minimum-hours warn banner when an hours-logged value
//          falls below the matched requirement's minimum_hours, expiry
//          urgency banner (EXPIRED / EXPIRING SOON within 30 days),
//          officer block, course block, documentation block (cert #,
//          completed, expires, hours, score, record id), regulatory
//          requirement block when a matching requirement row is found
//          (minimum hours, renewal cadence, required-for roles,
//          mandatory flag, description), notes block (HTML-stripped),
//          provenance block (created / updated), two-signature block.
//          Pure helpers (prettyCategory, prettyStatus, formatScore,
//          formatRenewal, expiryStatus, needsAuditAlert,
//          isSubMinimumHours) covered by 25 unit tests.
//        - Printer button on each row in the Records tab (admin tier)
//          opens the PDF in a new tab. Finds the matching requirement
//          row by course_name and threads it through so the discovery
//          printout shows the regulatory cadence alongside the actual
//          completion.
//
//        URL deep-link contract
//        - /training?tab=<dashboard|records|requirements|calendar>
//          switches the active tab on mount AND on every tab click
//          (replace-history, no spam) — refresh / browser-back / paste-
//          into-MDT lands on the same view.
//        - /training?cert_id=<id> opens the Edit Record modal for that
//          training row (and switches to Records tab when invoked from
//          the Dashboard).
//        - /training?course_id=<reqId> opens the Edit Requirement modal.
//        - /training?officer_id=<id> pre-filters Records to one officer
//          (passed through to RecordsTab's officerFilter; previously
//          there was no way for a personnel-detail deep-link to land on
//          one officer's training jacket).
//        - /training?status=<completed|in_progress|scheduled|overdue|
//          expired|expiring_soon> pre-filters Records by status.
//        - Each param is one-shot (stripped after applying) so refresh
//          doesn't re-pop the modal; a not-found id surfaces a toast
//          warning instead of silently ignoring the link.
//
//        Esc smart-cascade — was a single setShowRecordModal(false) +
//        setEditRecord(null) so the Requirement modal, the Bulk Assign
//        modal, and the two confirm dialogs all ignored Esc. Now
//        smallest-open-first: delete-record confirm → delete-
//        requirement confirm → Bulk Assign modal → Requirement modal →
//        Record modal. Each branch returns so one Esc never blasts
//        multiple layers.
//
//        N keyboard shortcut — press N (admin tier) opens New Training
//        Record. Mirrors the New-X binding on Dispatch / FI / Patrol /
//        Evidence / Dash Cameras / Records. Suppressed inside any
//        input/textarea/select/contenteditable; ctrl/meta/alt-modified
//        N is ignored so the browser-print binding still works.
//
//        ConfirmDialog × 2 — killed both window.confirm() calls:
//        - handleDeleteRecord — now ConfirmDialog with course name,
//          officer, completion/expiry dates, cert #, and status as the
//          identifying context so a misclick on a similar-named row
//          can't quietly destroy a court-discoverable record.
//        - handleDeleteRequirement — ConfirmDialog with course name,
//          category, mandatory flag (loudly red when mandatory — losing
//          it drops the compliance gate for an entire role), and the
//          minimum-hours requirement so the supervisor sees what the
//          dashboard will stop tracking.
//
//        Empty-state distinction — RecordsTab's "No training records
//        found." now disambiguates: zero records in the DB → "No
//        training records yet" + Add CTA (admin); records exist but
//        all filtered out → "No records match your filters" + Clear
//        filters button that resets search / status / category /
//        officer. Same pattern as v1043 dash-cameras + v1048 serve.
//
//        Theme sweep — lifted ~12 inline hex literals (#22c55e, #ef4444,
//        #f59e0b, #8b5cf6, #888888, #6b8aad, etc.) on the dashboard
//        stat cards / progress bars / compliance bars to Tailwind
//        semantic-color tokens (text-green-400, bg-amber-500, etc.) so
//        the cards re-color between night and day automatically. The
//        StatCard component prop shape changed from { color,
//        borderColor } to { tone } with seven semantic tones (brand /
//        green / amber / red / orange / purple / neutral).
//        Replaced the ⚠ / ✕ emoji glyphs in the fetch-error banner
//        with Lucide AlertTriangle / X icons.
//
//        Dead code — removed the `trainingCompletion` state +
//        accompanying apiFetch('/personnel/training-completion') call
//        that fired on every records change and was never rendered.
//        The dashboard derives the same numbers from records +
//        requirements in-page. Removed the unused `isGodMode` variable
//        (audit already shipped role-based gating via isAdmin).
// v1053: Shift Plans (/shift-plans) — Page 36 of the full-app frontend
//        pass. The supervisor's deployment board got the same court-ready
//        / native-dialog / deep-link contract every other audited page
//        carries:
//          • URL deep-link — ?date=YYYY-MM-DD and ?plan_id= so a "open
//            this plan" link in a Slack message lands the operator on
//            the right date with the right plan selected; params are
//            stripped after consumption so a refresh doesn't re-fire.
//          • Court-ready supervisor briefing PDF (shiftPlanPdf.ts) —
//            same Arial + RMPG-gold idiom as the v1024–v1048 series;
//            includes coverage tiles, warning blocks for understaffed /
//            OT notifications, double-book conflict callouts, the full
//            area-assignment table, and a supervisor signature line.
//            The prior "Export" was admin CSV only — unusable as a
//            hand-off artifact in the briefing room.
//          • 3 native confirm() prompts (delete plan, delete via header,
//            clear-all assignments) replaced with ConfirmDialog so the
//            operator sees what they're acting on (plan name, date,
//            shift type, assignment count) instead of a generic
//            window-prompt blocking the page.
//          • Esc smart-cascade — confirm dialogs → create form → plan
//            deselect. The prior handler only closed the create form,
//            leaving every other modal state captive to its X button.
//          • N → New Plan (typing-suppressed) — matches Citations /
//            Personnel / Process-Server / Fleet / Comms / Dash.
//          • Lucide ChevronLeft/Right replace the Unicode "◀ ▶ Back to
//            Plans" arrows so the surface doesn't depend on OS-font
//            availability for chrome icons.
//          • Per-user privacy — selected-date + selected-plan persist
//            under rmpg_shift_plans_state_<user.id> so a shared
//            workstation doesn't leak "Lt. Smith was looking at the
//            night shift" across logins. Mirrors the Personnel
//            user-scoped tab key pattern from v1040.
//          • Hardcoded rgba() literals in PlanStatusBadge swapped for
//            theme tokens (var(--surface-sunken) / var(--rmpg-*)) so
//            day/night palette swaps apply.
//          • Dead-code prune: 4 pieces of state (editingAssignment,
//            assignOfficerIds, assignUnitIds, assignNotes) were
//            declared and never read — the assignment-edit modal
//            actually lives on the Map page's shift planning overlay.
// v1052: Geography (/geography) — Page 35 of the full-app frontend pass.
//        Dispatch geography admin (4-column Miller drilldown over
//        Areas → Sectors → Zones → Beats) was working but missed every
//        cross-page contract the rest of the audit established:
//
//          • URL deep-link — ?area_id=N / ?sector_id=N / ?zone_id=N /
//            ?beat_id=N auto-select the deepest tier plus all its
//            ancestors so the drilldown columns are correct, then strip
//            the params (replace:true) so a refresh doesn't re-pin. Same
//            shape Trespass / Fleet / Communications / Serve use.
//          • Native dialogs killed — window.prompt() (Add a tier) and
//            window.confirm() (Delete) replaced with ConfirmDialog. Add
//            now shows the parent code so a mid-shift misclick is
//            obvious before save; Delete shows tier + code + name so the
//            operator sees exactly what they're about to drop.
//          • Esc smart-cascade — single press unwinds exactly one layer:
//            delete dialog → add dialog → editing → search → selection.
//            Each branch returns so a fast double-Esc never collapses
//            two layers.
//          • N shortcut for New — opens Add at the deepest selected tier
//            (Beat if a Zone is selected, Zone if a Sector is selected,
//            etc.; Area if nothing is selected). Suppressed inside any
//            input, dialog, or modifier chord.
//          • CSV export — Download button next to refresh dumps a flat
//            tier / area / sector / zone / beat sheet with the key
//            dispatch attributes (codes, units, radio, population, sq
//            mi, active) plus a Denver-local datestamped filename. The
//            sheet is the court-ready hierarchy snapshot MOU exhibits
//            and supervisor rosters were asking for.
//          • Privacy / shared-MDT — useFormDraft storage keys
//            (rmpg_geo_*_form) were system-wide unscoped per the memory
//            note. Scoped per-user (_${user.id}) with a one-time
//            read-through migration from the bare key so existing
//            drafts aren't lost. Same per-user scoping pattern fleet-v2
//            InsightsRoute landed in v1041.
//          • Theme tokens — six `#d4a017` literals (column headers,
//            selected-row border, detail-pane heading, checkbox accent,
//            Save/Edit buttons) → `text-brand-gold-500` /
//            `border-brand-gold-500` / `accent-brand-gold-500`. The gold
//            stays #d4a017 at night per CLAUDE.md but darkens slightly
//            in day mode for legibility — exact same migration the
//            other audited pages did.
//
//        No D1 migration, no Worker route changes — the
//        POST/PUT/DELETE endpoints for areas / sectors / zones / beats
//        already exist in src/routes/dispatch/geography.ts (created in
//        the original Phase 3 ship). Client-only. Typecheck passes;
//        1946 client tests still pass.
// v1051: Settings (/settings) — Page 34 of the full-app frontend pass.
//        SettingsPage is the per-user prefs hub (voice persona, voice
//        alerts, Motorola tones, PTT, map view/overlays/GPS/markers) — it
//        was missing the systemwide day/night theme picker entirely; the
//        only place to flip themes was UserProfileModal (modal nested in
//        the personnel detail tab) + the Layout topbar quick toggle.
//        Operators looking for "Settings" reasonably expected the picker
//        there, found nothing, and dropped to the modal.
//        - New "DISPLAY & THEME" SectionCard: Day / Night / Auto (shift)
//          segmented control writes through writeThemeOverride() — same
//          source of truth Layout + UserProfileModal already use — and
//          best-effort syncs theme_preference to /api/user/preferences
//          for cross-device follow-along. Font-scale slider mirrors the
//          UserProfileModal control (0.8–1.4, step 0.05) and live-applies
//          via the --user-font-scale CSS variable + html.fontSize the
//          UserPreferencesContext already drives. Legacy pure-black
//          kill-switch toggle exposes the documented rmpg_theme_legacy=1
//          escape hatch (per memory [[project-systemwide-daynight-theme]]).
//        - URL deep-link contract: /settings?section=<id> scroll-into-
//          views the named SectionCard on mount, strips the param so a
//          hard refresh doesn't re-pin. Whitelisted IDs:
//          display | voice | alerts | tones | ptt | map | overlays | gps
//          | markers. Lets MenuBar / docs / support tickets paste a deep
//          link to "this one toggle" rather than "scroll the page".
//        - Theme-token sweep: 9 hardcoded literals lifted off the page —
//          #d4a017 → var(--brand-gold) (5 sites: toggle on-state, segmented
//          on-state, Test-voice button, org-defaults button, status text);
//          #000 → var(--surface-overlay) (toggle knob + segmented on-state
//          text); #888 → var(--text-muted) (segmented off-state text);
//          #222 → var(--border-default) (segmented off-state border); the
//          PTT capturing-key state's #3a0d0d/#ef4444/#fca5a5 trio →
//          rgb(var(--sev-critical-rgb)/0.15) + var(--sev-critical) +
//          var(--sev-critical-soft). The page now re-themes cleanly
//          between night and day instead of pinning a steel-blue surface
//          under day-mode gold accents.
//        - Emoji chrome: "Published to all users ✓" → CheckCircle2 from
//          lucide-react, with the badge color flipping to var(--sev-
//          critical) on save-failure (was a flat brand-gold regardless).
//        - Esc cascade: PTT key-capture description now reads "Press any
//          key to bind, or Esc to cancel" so the existing Esc-cancels-
//          binding behavior is discoverable (the cancel path was always
//          there — it was just invisible).
//        - Hydrate from server: font_scale reads from UserPreferences-
//          Context on mount (was effectively a write-only control before;
//          the underlying value already lived on /user/preferences via
//          UserProfileModal but Settings never pulled it back).
//        - 5 vitest cases covering: render of the new section, manual
//          theme persists to localStorage + hits /user/preferences,
//          Auto clears the active flag, legacy-black kill-switch flip,
//          ?section= scroll + param-strip, and the unknown-section
//          no-op + param-retain.
//        Out of scope (deferred):
//          • Compact mode + show_map_labels + default_map_style server-
//            side prefs are still UserProfileModal-only. Map default
//            style is already on the page as a localStorage pref (not the
//            same key) — unifying the two requires the SETTINGS_KEYS ↔
//            user_preferences columns reconciliation that's tracked
//            separately.
//          • Password change / 2FA / WebAuthn enrollment — the legacy
//            VPS TOTP stack (per memory [[project-vps-decommissioned]])
//            has not been ported to the Worker yet; there's no endpoint
//            to call. Surface a placeholder section here when the
//            backend lands.
//        No D1 migration, no worker change.
// v1050: Admin (/admin) — Page 33 of the full-app frontend pass, applied to
//        the load-bearing AdminPage hub (1145 lines, 30+ tabs) plus its
//        two most-used destructive sub-tabs (Users + Cloudflare). AdminPage
//        is the privileged-access surface — every confirm bypassed our
//        keyboard trap / day-night surface, and the previous Esc handler
//        only closed one of the four open dialogs.
//        - URL deep-link contract: /admin?tab=<id> now ROUND-TRIPS — the
//          existing init-time read stayed, but clicking a tab also writes
//          the URL via setSearchParams({replace:true}). Bookmark, copy-
//          paste, and back-button all resolve to the right section now.
//          /admin?user_id=<id> auto-selects a user on the Users tab once
//          the roster hydrates (warning toast on miss + param strip);
//          /admin?client_id=<id> the same on Clients. wallet_ids was
//          missing from VALID_TABS — added so legitimate deep-links no
//          longer silently fall back to localStorage.
//        - Kill native dialogs: AdminUsersTab's four window.confirm()
//          calls (Suspend / Reactivate / Reset 2FA / Revoke Sessions)
//          and AdminCloudflareTab's one (Purge Zone Cache) all route
//          through ConfirmDialog with explicit confirmVariant (warning
//          for state-change, danger for revoke / purge). Each message
//          now NAMES the side effect ("sessions will be terminated",
//          "every visitor will re-fetch", "this action is audited")
//          instead of the generic "are you sure?" the operators had been
//          dismissing reflexively. AdminClientsTab + AdminAuditTab were
//          already ConfirmDialog-clean (verified) — no churn there.
//        - Esc smart-cascade: AdminPage's hard-coded
//          "Esc closes editingUser only" replaced with a cascade:
//          user-delete confirm → client-delete confirm → user modal →
//          client modal → selected user → selected client. The two
//          tab-local ConfirmDialogs (AdminUsersTab's, AdminCloudflareTab's)
//          handle their own Esc via the dialog's built-in escape handler,
//          so the cascade stays consistent regardless of which dialog
//          surface is in front. Mirrors the contract shipped in v1040
//          (Personnel) and v1048 (Process Server).
//        - N keyboard shortcut: opens Add User on the Users tab or Add
//          Client on the Clients tab. Typing-suppressed (INPUT, TEXTAREA,
//          SELECT, contentEditable) so an admin filtering the user list
//          with a name containing "n" doesn't pop the new-user dialog
//          mid-type. Suppressed entirely when any modal already owns
//          the page — admin's destructive flows must not be racing the
//          N shortcut.
//        - Verified already-shipped (not re-implemented):
//          * AdminAuditTab already exports CSV with date filters +
//            empty-state distinction ("matching filters" vs no entries).
//          * AdminPage already uses ConfirmDialog for the two delete
//            flows (client + user) — only their open-state was missing
//            from the Esc cascade.
//          * AdminClientsTab uses no native dialogs.
//        Deferred:
//          * 30+ remaining admin sub-tabs (System / Integrations /
//            ClearPathGPS / Microbilt / IPED / Fleet.io / AI Settings /
//            Email / Sessions / Departments / NotifRules / WalletId /
//            etc.) — each is its own surface with its own confirm/deep-
//            link/keyboard contract. This PR touches the hub +
//            load-bearing two; future passes will sweep them.
//          * The 200px sidebar still uses hardcoded `#888888` / `#ffffff` /
//            `rgba(136,136,136,…)` for the active-tab border + neutral
//            chrome (1145-line file). These are the intentional neutral
//            gray that renders identically in both themes, but a strict
//            token sweep would replace them with `--text-*` / `--border-*`.
//            Left as-is to keep the diff scoped to behavior fixes; theme
//            audit baseline tracks this in docs/theme-hex-audit-baseline.txt.
//          * `setActiveTab` writes to localStorage AND the URL — these can
//            drift if the URL is stripped by an outer redirect; the URL
//            wins on next mount but the LS key lingers. Acceptable for
//            now (LS is fallback only).
// v1049: Email (/email) — Page 32 of the full-app frontend pass. The
//        Outlook-style EmailPage.tsx (3220 LOC) was deferred from the
//        Communications PR #1625 because the chrome + state surface is the
//        largest single page in the SPA. Applies the same v1024–v1048
//        court-ready / native-dialog / deep-link / privacy contract every
//        other operator page now honors.
//
//        Court-ready PDF
//          • New client/src/utils/emailThreadPdf.ts — "Email Thread
//            Transcript" with RMPG-gold banner, importance-aware alert bar
//            (high → red, low → grey, normal → no bar), conversation
//            summary block (subject/folder/participants/message-count/
//            attachment-count/first/last/thread-id), per-message envelope
//            (sender → recipient + CC, importance + flag + read-state
//            tags, word-wrapped HTML-stripped body), per-message
//            attachments listing (non-inline only), and a two-signature
//            block (exporting officer + supervisor). Same Arial pattern as
//            fiCardPdf / courtAppearancePdf / conversationTranscriptPdf.
//          • Pure helpers (wrapText, stripHtmlForText, highestImportance,
//            participantsOf) covered by 24 new vitest cases plus 6 jsPDF
//            smoke tests (empty thread, very-long-word body, 60-message
//            page-break exercise, attachments listing, high+flagged+unread
//            tag overlap).
//          • New "Court-ready thread PDF" toolbar button (FileDown icon)
//            next to Print. Uses the hydrated `fullMessage` (which has
//            bodyHtml, To/CC populated) merged into the thread list so a
//            single-message export still renders correctly when only one
//            message of the conversation is on-page. Email threads ARE
//            court records (subpoenas, IA inquiries, records requests,
//            vendor billing) — before this PR the only export was raw
//            .eml (not human-readable) or Outlook's print-to-PDF (no
//            agency banner, no signature block).
//
//        Native dialogs killed
//          • 3 window.confirm() prompts replaced with themed ConfirmDialog:
//              · Block sender — "Future mail goes to Junk; not reversible
//                from this dialog" + sender details (name, address,
//                subject).
//              · Sweep sender to Archive — folder context + From details.
//              · Empty Deleted Items / Junk Email — danger variant.
//          • Folder-delete (right-click → Delete on user folders) used to
//            fire DELETE with NO confirmation at all — a right-click slip
//            on a deeply nested case-correspondence folder erased every
//            message inside it. Now goes through the same ConfirmDialog
//            machinery with message-count detail.
//
//        URL deep-link contract (23rd consecutive page-pass)
//          • /email?folder=<name>      — switch to that folder on mount
//            (well-known keys like "inbox", "sentitems", "drafts",
//            "trash"→"deleteditems", "junk"→"junkemail", or the Graph
//            folder id).
//          • /email?thread_id=<convId> — once messages hydrate, auto-
//            select the matching conversation's latest message.
//          • /email?message_id=<id>    — once messages hydrate, auto-
//            select that specific message.
//          • /email?compose=1          — open the New Message modal on
//            mount (useful for `mailto`-style deep-links from other RMPG
//            pages, e.g. a case detail panel's "Email contact" button).
//          • Misses surface a snackbar ("Linked message is not on this
//            page — try searching or switch folders") instead of silently
//            failing.
//          • Every consumed param is stripped (replaceState) so a manual
//            refresh doesn't re-trigger the lookup. The pre-existing
//            ?enrolled=1 OAuth-callback strip was rewritten to preserve
//            other params — previously it `replaceState({}, '', '/email')`
//            and nuked any deep-link the OAuth bounce was about to land on.
//
//        Esc smart-cascade
//          • Closes the top-of-stack layer first: ConfirmDialog →
//            Headers/AutoReply modals → attachment viewer → snooze/
//            category/more menus → folder-context-menu → folder rename
//            → new-folder → search-filters → scheduled-emails panel →
//            message context menu → compose modal → search query →
//            selected message. Previous handler only handled the last
//            three.
//
//        N keyboard shortcut
//          • Bare `N` opens Compose. Typing-suppressed (INPUT/TEXTAREA/
//            SELECT/contentEditable) AND modal-suppressed (every menu/
//            popover/modal/confirm above). Ctrl/Cmd+N still works.
//          • Title hints added to both Compose buttons ("New Message (N)").
//
//        User-scoped localStorage (privacy sweep)
//          • 5 keys promoted from bare → suffixed with the user id, with
//            a one-time migration from the legacy bare key so existing
//            operators don't lose their preference on first paint:
//              · email_compose_draft_<id>     (draft restore, was the
//                biggest leak — half-typed case email to the city
//                attorney was restored under the next officer's session)
//              · email_reading_theme_<id>     (dark/light reading pane)
//              · email_notifications_enabled_<id>
//              · email_folder_collapsed_<id>
//              · email_list_width_<id>        (list/reading split)
//          • Shared MDT pattern is real (dispatch ↔ patrol on the same
//            keyboard across a shift). Same fix Fleet Insights used in
//            v1041 + Intel panel-collapsed in v1047.
//
//        Empty-state distinction
//          • "No messages in this folder" (with an N hint) is now
//            distinct from "No results for X" (with Clear-search) AND
//            from "No messages match the active filters" (with the
//            hidden-count + Clear-filters CTA). Operators with a stale
//            filter combo no longer stare at a blank list assuming the
//            folder is empty.
//
//        Theme / hex / chrome hygiene
//          • Avatar palette refactor — index 0 and 7 were BOTH `#888888`
//            in two inline copies of AVATAR_COLORS. The duplicate halved
//            the effective hash space for every other color so neutral
//            grey rendered for ~2/10 of senders instead of 1/10. Replaced
//            with blue-500 and lifted to a single module-level constant
//            (+ avatarColorFor() helper) so the message-list and reading-
//            pane avatars stay in sync.
//
//        Out of scope (deferred):
//          • The OAuth admin-flow (status?.configured/authorized gates,
//            integration setup) was not touched — that's an admin page.
//          • Folder-tree drag-and-drop (currently click + right-click)
//            and message-list drag-to-folder.
//          • Composer rich-text upgrade (currently markdown-style
//            insertFormat) — that's a 1k-LOC separate effort.
//          • The print stylesheet still uses raw hex (#1a1a1a, #888888);
//            those run inside a `window.open()` blob document outside the
//            React theme system, so the values stay literal (same
//            decision as the existing printEmail helper).
//
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
// v1061: Use of Force (/use-of-force) — Page 44 of the full-app frontend
//        pass. UoF reports are simultaneously court-admissible, IA-
//        reviewable, and Utah POST state-DOJ reportable — among the
//        highest-stakes records in the system. The page had a working
//        list + create flow but was missing every operator affordance
//        the adjacent court surfaces (BWC, dashcam, audit) had landed:
//        - URL deep-link contract: ?uof_id=<n> opens that report (with
//          a /:id direct-fetch fallback when it's outside the current
//          50-row slice, plus a toast on 404 instead of silent miss);
//          ?incident_id=<n> + ?subject_id=<n> pre-filter the list AND
//          pre-fill the create-form's pickers so an officer drilling
//          in from a person/incident record doesn't re-pick the entity.
//          uof_id is mirror-stripped after consumption; the two filter
//          deep-links are also stripped so a refresh doesn't silently
//          re-apply over operator edits.
//        - Court-ready PDF: useOfForceReportPdf.ts — RMPG-gold banner,
//          stacked lethal-force + injuries alerts, incident block,
//          officer/subject demographics, force details, justification,
//          de-escalation, injuries, narrative, linked footage table
//          (BWC + dashcam clips fetched from the new /:id/footage
//          endpoint which joins footage_evidence_links populated by
//          autoPreserve at submission), supervisor review block, and a
//          two-signature block for reporting officer + reviewer. Mountain
//          Time everywhere. Helpers unit-tested. Print available from
//          both the detail panel header and the row right-click menu.
//        - Server additions: GET /use-of-force/:id (single-row fetch
//          for the deep-link fallback) + GET /use-of-force/:id/footage
//          (returns { flexcam: FootageRequest[], bodycam: BodycamVideo[] }
//          — schema-tolerant so older D1 column gaps soft-fail the join
//          instead of 500'ing). No migration needed; both endpoints sit
//          on top of existing tables and the autoPreserve entity_type
//          'use_of_force' linkage that's been in place since #1261.
//        - Esc smart-cascade: closes the create modal → review confirm
//          dialog → error banner → detail-panel selection → active
//          filter set (in that order). Ignores typing surfaces.
//        - N shortcut: opens the New Report modal from anywhere on the
//          page that isn't a typing surface (matches Records / Citations
//          / Incidents). Modifier-keys skip the shortcut so OS bindings
//          (Cmd-N) aren't hijacked.
//        - Per-user form draft (24h TTL via useFormDraft, keyed on
//          user id) — UoF narratives are long-form and the prior loss
//          of a half-typed report to an accidental tab close was a real
//          operator complaint. "Draft restored" banner inside the modal
//          with a one-click Discard.
//        - ConfirmDialog for supervisor Approve / Return: previously
//          a single click immediately mutated the report; now both
//          decisions route through the shared dialog with an optional
//          (recommended for Return) review-notes textarea that round-
//          trips to the server's `notes` body field and lands in the
//          new "Supervisor Review" detail block.
//        - Linked-footage panel on the detail surface: lists BWC clips
//          + FlexCam dashcam requests tied to the report, with the
//          evidence-locked chip + evidence number when present, so an
//          IA reviewer can see at a glance what video evidence backs
//          the report without leaving the page.
//        - Theme tokens: STATUS_COLORS' hard #888888/#22c55e/#f59e0b
//          hex strings are now token-backed tones (text-rmpg-300/
//          text-green-400/text-amber-400 + matching swatch + border
//          classes) so the status pills + stat counters re-theme
//          between night (steel-blue) and day (light-grey).
//        - Empty-state distinction: loading spinner with "Loading
//          reports…" label, hard error with the message, and a zero-
//          rows panel that branches between "no reports filed" (cold
//          start) and "no matching reports" (filters applied) — the
//          previous shared "No reports" string left operators unsure
//          whether to wait, escalate, or widen filters.
//        - Notification routing: added 'use_of_force' → /use-of-force?
//          uof_id= to notificationRouting.ts so an IA-emitted alert
//          like "UoF #42 returned for revision" deep-links to the
//          report instead of dumping the operator on the list page.
//        - Migration: none. The /:id and /:id/footage routes are net-
//          new but read from existing tables (use_of_force + the
//          footage_evidence_links table already in place since #1261);
//          no column adds. recordAudit still fires on CREATE / REVIEW.
// v1058: FlexCam — Page 41 of the full-app frontend pass. FlexCamPage
//        (327 lines, request list) + FlexCamFootagePage (1225 lines,
//        MDT-style chunk player with evidence lock / court package /
//        burn-clip workflow) + TripPlaybackPage (full-trip stitched
//        playback) are the operator surfaces for the source-agnostic
//        full-trip dashcam program (project-flexcam-footage-program).
//        Custody-on-view was already emitted server-side at
//        /chunk/:seq/stream → logCustody({action:'viewed'}) with a
//        per-hour viewSessionKey dedup — no client-side mirror needed
//        (verified in src/utils/footage/evidence.ts + flexcam.ts).
//        Court-package signing (Ed25519 in signTriple) ships from PR
//        #1261; the page already wires it to the COURT PACKAGE button
//        on both list and detail views.
//        - URL deep-link: /flexcam?request_id=<n> auto-scrolls to that
//          row, highlights it for 4s, and opens its custody panel.
//          /flexcam/:id?event_id=<idx> jumps the playhead to that marker
//          on hydrate; /flexcam/:id?t=<ms> opens at an absolute offset.
//          Both are one-shot and stripped after consumption.
//        - Esc smart-cascade: FlexCamPage closes custody errors first,
//          then result banners, then any open custody dropdown.
//          FlexCamFootagePage closes the shortcuts panel, exits
//          fullscreen, dismisses the inline playback-error banner, then
//          pauses playback. TripPlaybackPage exits fullscreen, else
//          navigates back to /flexcam — previously a deep-linked landing
//          on a still-downloading trip was a browser-back-only dead-end.
//        - Inline error surfaces: the native window.alert() on the
//          custody-fetch failure path now renders as a dismissable
//          inline banner under the row (the alert blocked the UI thread
//          and escaped the steel-blue theme); the lockEvidence failure
//          path now writes into the EVIDENCE action-bar message strip
//          instead of setErr(), which had blanked the whole player.
//        - Overlay-mode persistence: 'classic' / 'minimal' / 'none' HUD
//          choice is now stored in localStorage under
//          rmpg_flexcam_overlay_mode so officers don't have to re-set
//          their preferred HUD every time they open a different request.
//        - Distinct empty states on TripPlaybackPage: loading vs hard
//          error vs no-manifest vs manifest-exists-but-zero-clips-yet
//          (uses manifest.stillDownloading to message "X chunks pending,
//          auto-refresh every 10s") — collapsing the latter two into
//          one string left operators unsure whether to wait or escalate.
//        - Lucide replacement: the row-level "▶ Play whole trip" link
//          (the page's only emoji) is now the Lucide Play glyph in a
//          proper styled button matching the PLAY / REPAIR / CUSTODY
//          / COURT PKG row.
//        - Shared header on every TripPlaybackPage state (loading /
//          error / pending / ready) so the back-to-/flexcam affordance
//          and the channel switcher stay reachable regardless of fetch
//          status.
//        - No migration; no server route changes; no SW behavior changes
//          (this version is a content bump only).
// v1063: Plate Log (/intel/plate-log) — Page 46 of the full-app frontend
//        pass. PlateLogPage.tsx is the manual + ALPR-camera plate sighting
//        surface that an officer uses on a felony stop or a pursuit; every
//        capture is a potential court exhibit, and the page already had the
//        review queue, gallery, and dossier wired up.
//
//        What the audit caught and what changed:
//        - `?capture_id=` deep-link was DECLARED in notificationRouting.ts
//          (`alpr_capture → /plate-log?capture_id=`) but the page never read
//          it. Clicking an ALPR-capture notification dropped the operator
//          on the page with no context. The page now hydrates the scan tile
//          from `GET /api/alpr/capture/:id` and switches to the SCAN view.
//          `?plate=ABC123` opens the per-plate dossier directly. Both are
//          one-shot — params are stripped after first paint (FlexCam pattern).
//        - Court-record PDF — new client/src/utils/plateCapturePdf.ts (same
//          RMPG-gold banner + signature-block contract as dashcamReviewPdf,
//          evidenceItemPdf, auditLogPdf). Renders the annotated image +
//          plate/state/vehicle/trust/source/device, an UNVERIFIED-READ alert
//          banner when review_status is anything but `confirmed*` (the v963
//          TrustBadge audit catches the false-100% case at the screen layer;
//          this is the same protection at the printed-page layer), screening
//          hits, GPS + location + linked call/incident #, AND the full review
//          history pulled from /api/alpr/capture/:id/history so the chain-of-
//          review is embedded in the printout. New "COURT PDF" header button
//          on the scan tile.
//        - Esc smart-cascade — close-newest-open-first: dossier → editing
//          modal → reviewMsg banner → scanErr → scan tile. Skips while
//          typing in any field so plate/notes editing isn't disrupted.
//        - `N` shortcut focuses the plate input from anywhere on the page
//          (same convention as the dispatch board's `N` for new call) and
//          auto-switches the view back to SCAN if the operator was in the
//          CAPTURES gallery — previously the only way to start a manual
//          entry was to scroll-and-tap, awkward on a mobile keyboard.
//        - `⚠` glyph in HitBanners replaced by Lucide AlertTriangle. The
//          glyph rendered as tofu on some Android WebView builds and on the
//          iOS app's older fallback font (same symptom the FieldInterviews
//          audit flagged) — Lucide is consistent across every platform.
//        - No migration; no server route changes; no SW behavior changes;
//          all existing endpoints (the /capture/:id GET and /capture/:id/
//          history GET were already shipping from PR #1269/#1278).
//
// v1056: Notifications — Page 39 of the full-app frontend pass. The
//        /notifications page (NotificationsPage.tsx, 452 lines) plus the
//        global NotificationCenter dropdown (NotificationCenter.tsx, 567
//        lines) plus notificationTones.ts. The biggest fix here is wiring
//        the entity_type + entity_id pair that the server has been
//        stamping on every notification for over a year — every
//        INSERT INTO notifications site (footageAlpr, intelWatchlist,
//        caseTaskNudges, serveNudgeSweep, emailProcessor, alpr.ts,
//        intel.ts, intel/development.ts, notificationEngine.ts, etc) sets
//        them, but the client collapsed all of that to a single
//        type → /dispatch | /warrants | /communications | …
//        map and discarded the entity_id. A "Warrant hit on John Doe"
//        notification landed the operator on the warrants list instead
//        of John's record. New shared client/src/utils/notificationRouting.ts
//        builds a deep-link path per (entity_type, entity_id) pair:
//          call           → /dispatch?call_id=
//          warrant        → /warrants?warrant_id=
//          case           → /cases?case_id=
//          person         → /records?tab=persons&person_id=
//          vehicle        → /records?tab=vehicles&vehicle_id=
//          bolo           → /communications?tab=bolos&bolo_id=
//          intel_report   → /intel/reports?report_id=
//          serve_job      → /serve?job_id=
//          citation       → /citations?citation_id=
//          field_interview→ /field-interviews?fi_id=
//          trespass       → /trespass-orders?order_id=
//          incident       → /incidents?incident_id=
//          email_message  → /communications?tab=messages&message_id=
//          alpr_capture   → /plate-log?capture_id=
//        Falls back to the type-default route when only the type is
//        known (no entity_type/entity_id pair). NotificationsPage and
//        NotificationCenter both call routeForEntity() now; the per-page
//        type map is gone.
//
//        URL deep-link contract on /notifications (matches the v1019 /
//        v1041 / v1044 / v1048 cross-page pattern):
//          ?notification_id=<id> — highlight + scroll the row into view;
//                                  toast + filter-reset hint if the id
//                                  isn't in the current view.
//          ?category=<type>      — preselect a category filter.
//          ?unread=1             — preselect the Unread filter.
//        All three are consumed once and stripped (replace:true) so a
//        manual refresh doesn't re-pin the operator to a stale link.
//
//        Native window-confirm-less destructive sweeps → ConfirmDialog:
//          "Clear Read" used to fire DELETE on the entire read corpus on
//          a bare button click with zero confirmation — a misclick from
//          the top-right of a busy CAD layout silently nuked every read
//          notification. Same for "Cleanup 30d+". Both now flow through
//          the same ConfirmDialog every other destructive surface uses
//          (pre-focuses Cancel, body-scroll-lock, no global-Enter
//          destructive action). The Clear Read dialog shows the
//          estimated row count (total − unread) so the operator can see
//          what's about to disappear; the 30d+ dialog clarifies that
//          notifications already linked to audit_log / case timeline
//          rows live in their own tables and aren't affected.
//
//        Esc smart-cascade (matches the v1024–v1048 pattern):
//          confirm dialog → preferences panel → category filter →
//          unread filter. Falls through (no preventDefault) when nothing
//          is open. Previous handler: none — Esc on /notifications did
//          nothing, you had to click the X yourself.
//
//        Empty-state distinction:
//          "all caught up" (server returned 0, no filter) vs "no
//          notifications match this filter" (filter is hiding the
//          inbox). Before, both rendered the same flat "No notifications"
//          line and an operator with a stale category filter could not
//          tell which. The filter-empty state also gets a one-click
//          "Clear filter" button so a deep-linked filter is recoverable.
//
//        Privacy — per-user notification-sound scope:
//          notificationTones.ts now reads `rmpg_notification_sounds_<uid>`
//          first and falls back to the legacy global key, so a shared
//          MDT no longer inherits the previous operator's "off" pref.
//          UserProfileModal's sound switch routes through the new
//          isNotificationSoundEnabled / setNotificationSoundEnabled
//          helpers (was reading + writing localStorage directly with
//          inline hex colors, both fixed here). Legacy global key stays
//          a read-only fallback so an existing operator's "off" pref
//          isn't silently flipped back to "on" after the rollout.
//
//        Theme token sweep:
//          NotificationCenter badge — hardcoded #888888 background +
//          #ffffff text + rgba shadow → bg-red-600 + text-white +
//          currentColor-keyed shadow (an unread count needs to be visible
//          at a glance in both day and night; the gray was barely legible
//          in day mode). NotificationCenter dropdown top border + row
//          unread marker — #888888 → var(--border-strong) so the chrome
//          re-themes with the palette.
//
//        Sidebar "All (N)" count correction:
//          Previously displayed pagination.total, which flips to the
//          *filtered* total the moment any category is selected — the
//          "All" label was lying about the inbox size as soon as you
//          clicked any sub-category. Now uses the sum of the categories
//          breakdown (which is unfiltered) and falls back to
//          pagination.total when categories haven't hydrated yet.
//
//        Dead code:
//          NotificationsPage's `useAuth` import + `user` destructure
//          removed — never read. The old NOTIFICATION_ROUTES map in
//          NotificationCenter is gone (replaced by the shared helper).
//
//        Tests:
//          New client/src/utils/__tests__/notificationRouting.test.ts
//          (15 cases) covers entity-first routing, URL-encoding, type
//          fallback, the "no route at all" case, and hasDeepLink.
//          Existing dispatchTones.test.ts still passes — the legacy
//          global key remains a valid read fallback.
//
//        Out of scope:
//          The 30 day cleanup confirm dialog estimates "30d+" rows from
//          a count we don't currently fetch — it tells the operator what
//          the operation does instead of the exact row count. Adding a
//          /notifications/cleanup-preview?days=30 endpoint to surface
//          the precise count is a separate API change.
//          The notification preferences panel itself ("Preferences"
//          toolbar button) is still server-backed but the Esc handler
//          treats it as a single layer to close — closing the panel
//          mid-edit currently discards unsaved checkbox/quiet-hours
//          changes. A "Save changes?" confirm on Esc-when-dirty would be
//          a separate scope.
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
// v1112: Special Ops — ConfirmDialog for delete, ?op_id= deep-link, N shortcut,
//        Esc cascade, three-state empty (loading/empty/search), admin/manager/supervisor
//        role gate for create/delete, parseTimestamp for dates, search filter bar.
// v1103: CRM/Overwatch — task delete ConfirmDialog, role gate for intel tabs
//        (webintel/competitors/firecrawl/deepresearch now require supervisor+),
//        ?section= URL param stripped after seeding, ?contact_id= deep-link
//        routes to Contacts tab, Esc cascade covers task-delete confirm.
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
