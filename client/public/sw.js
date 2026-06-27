// ============================================================
// RMPG Flex — Service Worker
// Provides offline caching for static assets while always
// fetching API data fresh from the network.
// Supports automatic updates with client notification.
// v1243: Warrants — isAdminOrManager gates toolbar New Warrant button+mobile FAB+empty-state create action; OffenseLevelBadge dead import removed; all ConfirmDialogs, deep-link (?warrant_id=/?personId=), N+Esc cascade, 3-state empty states, API shape, brand tokens verified.
// v1234: Statute Analytics — ?statute_id=/?section= deep-link pre-fills search+scrolls+highlights matching row+toast+strip+useRef guard; dead enhancement-calculator and statute-comparison state+handlers removed; brand tokens verified (LEVEL_COLORS CSS vars, no raw hex).
// v1233: Special Ops — ConfirmDialog gates delete (canDelete admin|manager separate from canCreate admin|manager|supervisor); ?op_id=/?operation_id= deep-link (useRef guard+strip+toast); N+canCreate (admin|manager|supervisor) opens new-record form; Esc cascade (formOpen→deleteTarget) stopPropagation full deps; 3-state empty (loading/no-data/no-results) distinct; canDelete gates Trash2 + context-menu delete; API shape verified (no .data unwrap); no raw hex.
// v1227: Serve Intake — ConfirmDialog gates remove-document (canManage admin|manager|supervisor|officer|dispatcher, danger variant); ?case_id= deep-link navigates to dispatch (useRef guard+strip+toast); ?intake_id= toasts intake id on mount; Esc cascade adds confirmReset+confirmRemoveFileIdx branches (stopPropagation full deps); removeFile gated to canManage (X button hidden for non-managers); clientLoadError rendered in client selector; empty state (no docs+not processing) distinguishes no-data from loading; useToast added.
// v1230: Settings — N focuses voice selector (non-admin) / publishes org default (admin|manager); Esc cascade stopPropagation on capturingKey branch; PTT channels loading state distinct from empty (no channels configured); voiceSelectRef wired for N shortcut; duplicate ff-settingspage-* ids removed.
// v1226: Security Dashboard — ConfirmDialog gates unblock-IP (warning variant, admin-only); ?tab= deep-link (strip+toast); ?ip= deep-link (scroll+highlight+toast blocked IP row+strip, useRef guard); N refreshes security data; Esc cascade (unblockTarget) e.stopPropagation(); isAdmin useMemo; admin-only tabs (threats/sessions/timeline) show access-denied empty state for non-admins; Blocked IPs panel always rendered for admins (empty-state "No IPs currently blocked"); unblock success toast; useToast added.
// v1233: Special Ops — ConfirmDialog gates delete (canDelete admin|manager separate from canCreate admin|manager|supervisor); ?op_id=/?operation_id= deep-link (useRef guard+strip+toast); N+canCreate (admin|manager|supervisor) opens new-record form; Esc cascade (formOpen→deleteTarget) stopPropagation full deps; 3-state empty (loading/no-data/no-results) distinct; canDelete gates Trash2 + context-menu delete; API shape verified (no .data unwrap); no raw hex.
// v1228: Serve — ?serve_id=/?case_id= deep-link aliases (useRef guard, toast on miss, strip); brand tokens: MARKER_COLORS.pending #888888→var(--text-muted), header divider #d4a017→brand-400/30, Route tab progress bar/stop-badge/status-badge hex→Tailwind classes; N+canManage (admin|manager|supervisor) role-gated; Esc cascade + ConfirmDialog + role gates verified.
// v1231: Shift Plans — deepLinkRef guard + success/miss toast on ?plan_id= deep-link; e.stopPropagation() per Esc cascade branch (clearAllConfirm→deletePlanTarget→showCreateForm→activePlanId); active badge rgba(34,197,94)/hex → rgba(var(--sev-ok-rgb))/var(--sev-ok) tokens; shift-type selector #000 → var(--surface-base); useRef added.
// v1232: Skip Tracer — loading/no-results/pre-search 3-state right-panel empty states; canExport (admin|manager) gates CSV ExportButton; SEARCH_MODES accent hex (#34d399/#a78bfa/#f59e0b/#f472b6) → var(--sev-ok/special/warn/info) tokens; renderArraySection same token migration; useMemo canExport role gate.
// v1231: Shift Plans — deepLinkRef guard + success/miss toast on ?plan_id= deep-link; e.stopPropagation() per Esc cascade branch (clearAllConfirm→deletePlanTarget→showCreateForm→activePlanId); active badge rgba(34,197,94)/hex → rgba(var(--sev-ok-rgb))/var(--sev-ok) tokens; shift-type selector #000 → var(--surface-base); useRef added.
// v1230: Settings — N focuses voice selector (non-admin) / publishes org default (admin|manager); Esc cascade stopPropagation on capturingKey branch; PTT channels loading state distinct from empty (no channels configured); voiceSelectRef wired for N shortcut; duplicate ff-settingspage-* ids removed.
// v1226: Security Dashboard — ConfirmDialog gates unblock-IP (warning variant, admin-only); ?tab= deep-link (strip+toast); ?ip= deep-link (scroll+highlight+toast blocked IP row+strip, useRef guard); N refreshes security data; Esc cascade (unblockTarget) e.stopPropagation(); isAdmin useMemo; admin-only tabs (threats/sessions/timeline) show access-denied empty state for non-admins; Blocked IPs panel always rendered for admins (empty-state "No IPs currently blocked"); unblock success toast; useToast added.
// v1234: Statute Analytics — ?statute_id=/?section= deep-link pre-fills search+scrolls+highlights matching row+toast+strip+useRef guard; dead enhancement-calculator and statute-comparison state+handlers removed; brand tokens verified (LEVEL_COLORS CSS vars, no raw hex).
// v1229: Serve Scheduler — ConfirmDialog gates dismiss-slot (danger/DELETE) + unassign-slot (warning/PATCH officer→null); ?serve_id= alias for ?schedule_id= + ?officer_id= deep-link (lane highlight+scroll+toast+useRef guard+strip); N+canManage (admin|manager|supervisor) opens Rebalance; Esc cascade (pendingAction→showRebalance→blur) stopPropagation per branch; canDelete (admin|manager) gates dismiss+unassign chip buttons; error state adds Retry button; brand tokens verified (no raw hex).
// v1228: Serve — ?serve_id=/?case_id= deep-link aliases (useRef guard, toast on miss, strip); brand tokens: MARKER_COLORS.pending #888888→var(--text-muted), header divider #d4a017→brand-400/30, Route tab progress bar/stop-badge/status-badge hex→Tailwind classes; N+canManage (admin|manager|supervisor) role-gated; Esc cascade + ConfirmDialog + role gates verified.
// v1227: Serve Intake — ConfirmDialog gates remove-document (canManage admin|manager|supervisor|officer|dispatcher, danger variant); ?case_id= deep-link navigates to /dispatch (useRef guard+strip); ?intake_id= toasts id on mount (strip); Esc cascade adds confirmReset+confirmRemoveFileIdx branches (stopPropagation full deps); X button gated to canManage; clientLoadError rendered in client selector (AlertTriangle); empty state (no docs+not processing) distinct from loading; useToast added.
// v1230: Settings — N focuses voice selector (non-admin) / publishes org default (admin|manager); Esc cascade stopPropagation on capturingKey branch; PTT channels loading state distinct from empty (no channels configured); voiceSelectRef wired for N shortcut; duplicate ff-settingspage-* ids removed.
// v1226: Security Dashboard — ConfirmDialog gates unblock-IP (warning variant, admin-only); ?tab= deep-link (strip+toast); ?ip= deep-link (scroll+highlight+toast blocked IP row+strip, useRef guard); N refreshes security data; Esc cascade (unblockTarget) e.stopPropagation(); isAdmin useMemo; admin-only tabs (threats/sessions/timeline) show access-denied empty state for non-admins; Blocked IPs panel always rendered for admins (empty-state "No IPs currently blocked"); unblock success toast; useToast added.
// v1234: Statute Analytics — ?statute_id=/?section= deep-link pre-fills search+scrolls+highlights matching row+toast+strip+useRef guard; dead enhancement-calculator and statute-comparison state+handlers removed; brand tokens verified (LEVEL_COLORS CSS vars, no raw hex).
// v1225: Screening — ?screening_id=/?subject_id= deep-link aliases (useRef guard+toast+strip); N+canCreate (admin|manager) role gate focuses surname; Esc cascade (pendingReview in workspace, editingInterval→pendingScrape in SourcesTab) stopPropagation; search empty states split (loading/not-searched/no-results); WatchlistTab loading/empty states distinct; role split canCreate (admin|manager) vs canManage (admin|manager|supervisor); brand tokens verified (no raw hex).
// v1222: Reports — ConfirmDialog gates delete report (canDelete admin|manager); ?report_id= deep-link (scroll approval-queue+toast+strip+useRef guard); ?type= deep-link scrolls named card; N+canCreate (admin|manager) gates Custom Builder nav; Esc cascade (error→custom-range) stopPropagation per branch full deps; approval-queue loading/no-data distinct empty states; canDelete gates Trash2 button+context-menu; convertToCSV dead code removed; #888888/#d4a017 hex → var(--text-muted)/var(--brand-gold) tokens.
// v1218: QA — ConfirmDialog delete gate; ?review_id=/?qa_id= deep-link (toast on hit+miss, useRef guard, strip); ?officer_id= pre-fills new review; N+canWrite role gate (admin|manager|supervisor); Esc cascade (formOpen→deleteId) stopPropagation; loading/no-data empty states; canDelete (admin|manager) gates delete; .data unwrap; no raw hex.
// v1214: Patrol — ?checkpoint_id= deep-link (rowRefs scroll+flash-highlight+strip+useRef guard); N+canCreate role gate (admin|manager|supervisor|officer); Esc cascade stopPropagation per branch (deleteConfirmId→QR modal→checkpoint modal); canDelete (admin|manager) gates Delete button+context-menu; text-[var(--brand-gold)] → text-brand-gold-500 (4 sites); dead patrolTabs+TabBar+Wrench/DollarSign/FileText/ClipboardCheck removed; useMemo role gates.
// v1213: NSOPW Lookup — canPrint (admin|manager|supervisor) gates Print Offender Card, ?name= alias for ?surname= deep-link + strip on mount, deep-link offender_id toast (success+error), useRef guard already present, N focuses surname field, Esc cascade full deps + stopPropagation, 4-state empty (pre-search/loading/no-results/results), brand tokens verified (no raw hex).
// v1212: Notifications — ConfirmDialog gates per-row delete + Clear Read + Cleanup 30d+; per-row delete gated to canManage (admin|manager|supervisor); ?notification_id= deep-link (scroll+highlight+toast+useRef guard+strip); N marks all-read (suppressed when any confirm open); Esc cascade (confirmDeleteId→confirmClearRead→confirmCleanupOld→showPrefs→filterType→filterRead) full deps; 3-state empty (loading/no-results/no-data) distinct; .data envelope unwrapped; no raw hex.
// v1208: Narcotics — GET /cases/:id route added (deep-link fallback), ConfirmDialog gates delete, ?narcotics_id=/?case_id= deep-link (useRef guard+strip+toast), N+canManage (admin|manager|supervisor) gate, Esc cascade (deleteTarget→formOpen) stopPropagation, 4-state empty (loading/error/no-results/no-data), role gates on create/edit/delete, brand tokens verified.
// v1211: Navigation — ConfirmDialog gates clear-route (warning variant), ?lat=&lng=&destination= deep-link auto-routes on map ready (useRef guard+strip), N opens+focuses destination search, Esc cascade (clearRouteConfirmOpen→searchOpen→tripOpen→logOpen→tripsOpen) stopPropagation per branch, map-init loading state distinct from map-error, canExport (admin|manager) gates GPX/CSV export cluster, 7 toolbar button hex (#d4a017/#f59e0b/#e5e7eb/#666) → var(--brand-400)/var(--sev-warning)/var(--rmpg-200)/var(--rmpg-600) tokens.
// v1206: Login — ?username= deep-link pre-fills username field (useRef guard+strip), N shortcut focuses username (credentials step only, skips if target is INPUT/TEXTAREA), Esc cascade adds clearError() as first branch, #888888 hex → text-rmpg-400 tokens (labels, icons, InfoRow, accentColor, "Secure Authentication" subtitle).
// v1209: National Warrant Search — useToast no-results warning on deep-link auto-search (fromDeepLink flag), canPrint (admin|manager) gates court-ready PDF button on each result row, canPrint prop threaded to WarrantRow; Esc cascade + N + deep-link + 4-state empty already in place; no raw hex; API shape verified (no .data unwrap needed).
// v1208: Narcotics — GET /cases/:id route added (deep-link fallback), ConfirmDialog gates delete, ?narcotics_id=/?case_id= deep-link (useRef guard+strip+toast), N+canManage (admin|manager|supervisor) gate, Esc cascade (deleteTarget→formOpen) stopPropagation, 4-state empty (loading/error/no-results/no-data), role gates on create/edit/delete, brand tokens verified.
// v1207: Mobile Shift — ConfirmDialog gates Complete pre-shift/Finish review (warning variant), ?officer_id=/?shift_id= deep-link (advisory useSearchParams+useRef guard), N focuses odometer input, Esc cascade (confirmCompleteOpen→blur soft-keyboard) stopPropagation, role gates n/a (token-authenticated page, no JWT roles), loading skeleton distinct from token-invalid error state, #d4a017/#1a1a0d hex → brand-400/surface-sunken tokens (header/sections/fuel/photos/complete button/DoneView).
// v1206: Login — ?username= deep-link pre-fills username field (useRef guard+strip), N shortcut focuses username (credentials step only, skips if target is INPUT/TEXTAREA), Esc cascade adds clearError() as first branch, #888888 hex → text-rmpg-400 tokens (labels, icons, InfoRow, accentColor, "Secure Authentication" subtitle).
// v1205: Law Book — ConfirmDialog gates clear-recent-history (canManage), ?statute_id=/?citation=/?section= deep-link (useRef guard+toast on missing target), N shortcut focuses search (any authed user), Esc cascade (clearRecentConfirm→openSection→search→chapter) e.stopPropagation() per branch, loading/no-data/no-results distinct empty states + landing skeleton, CATEGORY_META hex→CSS vars (sev-special/sev-high/sev-ok-soft/sev-caution), LEVELS dot hex→CSS vars, active-button color #0a0a0a→var(--surface-base).
// v1195: Document Intake — ConfirmDialog gates discard-review (Esc→confirm or button), ?doc_id= deep-link (scroll review panel + toast if not loaded), N+canUpload role gate (admin|manager|supervisor|officer|dispatcher), Esc cascade stopPropagation per branch (discardConfirmOpen→review), 4-state empty (idle/processing/error/review), canUpload gates drop-zone+picker+drag, AlertTriangle error state with retry, reviewPanelRef scroll target.
// v1200: Interaction Recorder — ConfirmDialog gates stop/discard (warning variant), ?recording_id= deep-link (scroll+toast+strip+useRef guard), N focuses location input (any-role gate), Esc closes stop-confirm, canDelete (admin|manager) gates DEL button, 3-state loading/no-data empty states, #888888/#d4a017 hex → rmpg-400/brand-400 tokens, parseTimestamp for row timestamps.
// v1199: Gang Intel — canCreate (admin|manager) gates New Member button + N shortcut, ?person_id= deep-link alias + missing-target toast, gangs dead-fetch removed, bg-black/70 token replaces rgba(0,0,0,0.70), Gang interface removed.
// v1203: Jail — canCreate (admin/manager/supervisor) gates New Inmate button, N shortcut, and empty-state hint; deep-link ?inmate_id=/?booking_id=/?booking_number=/?status=/?q= with useRef guard+strip; Esc cascade (deleteId→formOpen→filtersActive) stopPropagation per branch; ConfirmDialog for delete; 3-state empty (loading/no-data/no-results); parseTimestamp in fmtRelativeAge.
// v1204: Knowledge Base — ConfirmDialog guards clear-recent-searches, ?article_id= deep-link highlights result (deepLinkRef guard+toast), N focuses search input (any authed user), Esc cascade e.stopPropagation() per branch (clearConfirm→typeFilter→query→blur), loading skeleton distinct from no-data/no-results, canPrint (admin|manager) gates Print Results button, brand tokens verified (no raw hex).
// v1202: IPED — ConfirmDialog gates cancel-job + remove-hash-set, ?job_id= + ?search= deep-links, N focuses hash search, Esc cascade (cancelJobTarget→removeHashSetTarget→showNewJob→showImportHashSet→selectedJob→hashSearch), canManage (admin|manager) gates New Job / Import / cancel / remove buttons, 3-state empty (loading/no-data/no-results) on job queue, .data envelope unwrap on fetchJobDetail.
// v1197: Forensic Lab — canDelete (admin/manager) gates Cancel Case (ConfirmDialog), ?sample_id= deep-link alias + invalid-id toast, e.stopPropagation() per Esc cascade branch (completeTarget→confirmUnlinkId→confirmCloseCase→modals→filters→selectedCase), primaryInputRef focuses title on N, confirmCloseCase added to keyboard-effect deps.
// v1195: Document Intake — ConfirmDialog gates discard-review (Esc→confirm or button), ?doc_id= deep-link (scroll review panel + toast if not loaded), N+canUpload role gate (admin|manager|supervisor|officer|dispatcher), Esc cascade stopPropagation per branch (discardConfirmOpen→review), 4-state empty (idle/processing/error/review), canUpload gates drop-zone+picker+drag, AlertTriangle error state with retry, reviewPanelRef scroll target.
// v1203: Jail — canCreate (admin/manager/supervisor) gates New Inmate button, N shortcut, and empty-state hint; deep-link ?inmate_id=/?booking_id=/?booking_number=/?status=/?q= with useRef guard+strip; Esc cascade (deleteId→formOpen→filtersActive) stopPropagation per branch; ConfirmDialog for delete; 3-state empty (loading/no-data/no-results); parseTimestamp in fmtRelativeAge.
// v1199: Gang Intel — canCreate (admin|manager) gates New Member button + N shortcut, ?person_id= deep-link alias + missing-target toast, gangs dead-fetch removed, bg-black/70 token replaces rgba(0,0,0,0.70), Gang interface removed.
// v1201: Interagency — status field added to create/edit form (server-persisted, shown in table), EMPTY_FORM includes status:'pending' default.
// v1200: Interaction Recorder — ConfirmDialog gates stop/discard (warning variant), ?recording_id= deep-link (scroll+toast+strip+useRef guard), N focuses location input (any-role gate), Esc closes stop-confirm, canDelete (admin|manager) gates DEL button, 3-state loading/no-data/no-results empty states, #888888 hex → text-rmpg-400 + brand-400 tokens, parseTimestamp for row timestamps, dead focus:border-[#d4a017] → focus:border-brand-400.
// v1198: Forgot Password — ?email= deep-link pre-fills input (strip+useRef guard), N shortcut focuses email field, Esc resets form, #888888 hex → text-rmpg-400 tokens (label/footer/icon), hover:text-rmpg-400 replaces inline onMouseEnter/Leave handlers.
// v1196: Documents — ?file_id= deep-link toasts on missing target (addToast in effect deps), DossierGrid 3-state empty (loading/no-results/no-data via isLoading+searchQuery props), delete folder/file/bulk gated to isAdmin via ConfirmDialog, Esc cascade full deps, SW v1196.
// v1199: Gang Intel — canCreate (admin|manager) gates New Member button + N shortcut, ?person_id= deep-link alias + missing-target toast, gangs dead-fetch removed, bg-black/70 token replaces rgba(0,0,0,0.70), Gang interface removed.
// v1198: Forgot Password — ?email= deep-link pre-fills input (strip+useRef guard), N shortcut focuses email field, Esc resets form, #888888 hex → text-rmpg-400 tokens (label/footer/icon), hover:text-rmpg-400 replaces inline onMouseEnter/Leave handlers.
// v1197: Forensic Lab — canDelete (admin/manager) gates Cancel Case (ConfirmDialog), ?sample_id= deep-link alias + invalid-id toast, e.stopPropagation() per Esc cascade branch (completeTarget→confirmUnlinkId→confirmCloseCase→modals→filters→selectedCase), primaryInputRef focuses title on N, confirmCloseCase added to keyboard-effect deps.
// v1196: Documents — ?file_id= deep-link toasts on missing target (addToast added to effect deps), DossierGrid 3-state empty (loading/no-results/no-data via isLoading+searchQuery props), isLoading+searchQuery passed from DocumentsPage dossier view.
// v1195: Document Intake — ConfirmDialog gates discard-review (Esc→confirm or button), ?doc_id= deep-link (scroll review panel + toast if not loaded), N+canUpload role gate (admin|manager|supervisor|officer|dispatcher), Esc cascade stopPropagation per branch (discardConfirmOpen→review), 4-state empty (idle/processing/error/review), canUpload gates drop-zone+picker+drag, AlertTriangle error state with retry, reviewPanelRef scroll target.
// v1194: DL Search — brand-gold-500 tokens replace text/bg/border [var(--brand-gold)] (19 sites), fromDeepLinkRef guard toasts on no-results deep-link, addToast in handleSearch deps.
// v1191: Dashboard — ?panel=/?widget= deep-link (scroll+strip+useRef guard), N shortcut opens New Call (canCreate gate), Esc cascade (NewCallModal→IncidentModal stopPropagation per branch), canCreate gates newCall/newIncident/newCitation/quickCapture toolbar buttons, 3-state activeBolos empty (loading/no-BOLOs/list), panel id attrs for deep-link targets.
// v1190: DashCameras — e.stopPropagation() per Esc cascade branch (videoToDelete→editing→linking→upload→playing→detail), ?camera_id= deep-link (was clip_id), isAdminOrManager gates upload/delete/N-shortcut, list-view 3-state empty (loading/no-data/no-results), parseTimestamp replaces new Date(string) in delete-label/details, purple led-dot uses --sev-special/--sev-special-rgb, camera-channel overlay migrated to rmpg/purple Tailwind tokens.
// v1192: Dashcam AI — ConfirmDialog gates AI result discard (admin/manager), ?session_id=/?clip_id= deep-link with scroll+toast+strip+useRef guard, N focuses source filter, Esc cascade (discardTarget→playerEventId→selected) stopPropagation per branch, 3-state empty (loading/no-data/no-results), canConfigure (admin/manager) gates Discard button, brand-400 token replaces inline #d4a017 (5 sites), DetailRow icon typed as ComponentType.
// v1186: Crisis Response — ConfirmDialog for delete, ?incident_id= deep-link, N shortcut (canCreate), Esc cascade e.stopPropagation() per branch (deleteTarget→form→search), canCreate/canDelete (admin|manager) role gates, 3-state empty (loading/error/no-results/no-data).
// v1185: Court Tracker — ?hearing_id= deep-link alias, Esc cascade e.stopPropagation() per branch (cloneEventId→witnessOpen→feeOpen→prosecutorOpen→judgeNotesOpen→bailOpen→continuanceOpen→outcomeOpen→citationSearchOpen→formOpen), text-[var(--brand-gold)] → text-brand-gold-500 token (14 sites).
// v1188: Custom Report Builder — ConfirmDialog for reset/start-over, ?report_id= deep-link (missing-target toast + strip), N focuses first source card or jumps to source step, Esc cascade e.stopPropagation() per branch (resetConfirm→preview→filters→columns→source), canCreate (admin|manager) gates source cards/Run Query/Re-run/Reset, 3-state loading/no-data/no-results empty states in preview step.
// v1193: Dashcam — ConfirmDialog for device deactivation (admin/manager), ?device_id= deep-link with deepLinkRef guard, N refreshes, Esc cascade stopPropagation (deactivateTarget→selectedDevice), canEdit (admin/manager/supervisor) gates label/unit-assignment fields, canManage gates deactivate, 3-state loading/no-data/no-results empty states, bg-[#d4a017] → bg-brand-gold-500 token, parseTimestamp replaces raw event_at/last_gps_at/last_connection_at display.
// v1189: DashCam Detail — ConfirmDialog for Burn HUD (admin/manager gate), ?clip_id= deep-link, N triggers Download Original, Esc cascade (burnConfirm→editModal→fullscreen→back) stopPropagation, 3-state empty (loading/error/no-data), isAdminOrManager gates reclassify+burn, .data envelope unwrap, dead duplicate title+Esc effects removed, Video icon for no-data state.
// v1193: Dashcam — ConfirmDialog for device deactivation (admin/manager), ?device_id= deep-link with deepLinkRef guard, N refreshes, Esc cascade stopPropagation (deactivateTarget→selectedDevice), canEdit (admin/manager/supervisor) gates label/unit-assignment fields, canManage gates deactivate, 3-state loading/no-data/no-results empty states, bg-[#d4a017] → bg-brand-gold-500 token, parseTimestamp replaces raw event_at/last_gps_at/last_connection_at display.
// v1190: DashCameras — e.stopPropagation() per Esc cascade branch (videoToDelete→editing→linking→upload→playing→detail), ?camera_id= deep-link (was clip_id), isAdminOrManager gates upload/delete/N-shortcut, list-view 3-state empty (loading/no-data/no-results), parseTimestamp replaces new Date(string) in delete-label/details, purple led-dot uses --sev-special/--sev-special-rgb, camera-channel overlay migrated to rmpg/purple Tailwind tokens.
// v1189: DashCam Detail — ConfirmDialog for Burn HUD (admin/manager gate), ?clip_id= deep-link, N triggers Download Original, Esc cascade (burnConfirm→editModal→fullscreen→back) stopPropagation, 3-state empty (loading/error/no-data), isAdminOrManager gates reclassify+burn, .data envelope unwrap, dead duplicate useEffects removed, Video icon for no-data state.
// v1188: Custom Report Builder — ConfirmDialog for reset/start-over, ?report_id= deep-link (missing-target toast + strip), N focuses first source card or jumps to source step, Esc cascade e.stopPropagation() per branch (resetConfirm→preview→filters→columns→source), canCreate (admin|manager) gates source cards/Run Query/Re-run/Reset, 3-state loading/no-data/no-results empty states in preview step.
// v1187: CRM — ConfirmDialog for contact delete, canManage (admin|manager) gates task/contact delete + N shortcut on tasks, Esc cascade e.stopPropagation() per branch + contactToDelete added, ?account_id= deep-link alias for ?client_id= with missing-target toast, 3-state empty (loading/no-data/no-results) on Properties/Contacts/Invoices, contact delete button + context menu.
// v1186: Crisis Response — ConfirmDialog for delete, ?incident_id= deep-link, N shortcut (canCreate), Esc cascade e.stopPropagation() per branch (deleteTarget→form→search), canCreate/canDelete (admin|manager) role gates, 3-state empty (loading/error/no-results/no-data).
// v1194: DL Search — brand-gold-500 tokens replace text/bg/border [var(--brand-gold)] (19 sites), fromDeepLinkRef guard toasts on no-results deep-link, addToast in handleSearch deps.
// v1185: Court Tracker — ?hearing_id= deep-link alias, Esc cascade e.stopPropagation() per branch (cloneEventId→witnessOpen→feeOpen→prosecutorOpen→judgeNotesOpen→bailOpen→continuanceOpen→outcomeOpen→citationSearchOpen→formOpen), text-[var(--brand-gold)] → text-brand-gold-500 token (14 sites).
// v1179: Body Cameras — Esc cascade e.stopPropagation() per branch, parseTimestamp replaces new Date(string) in video-delete label/details.
// v1191: Dashboard — ?panel=/?widget= deep-link (scroll+strip+useRef guard), N shortcut opens New Call (canCreate gate), Esc cascade (NewCallModal→IncidentModal stopPropagation per branch), canCreate gates newCall/newIncident/newCitation/quickCapture toolbar buttons, 3-state activeBolos empty (loading/no-BOLOs/list), panel id attrs for deep-link targets.
// v1181: Code Enforcement — Esc cascade e.stopPropagation() per branch (confirmOpen→showReinspection→tFormOpen→vFormOpen), canEnforce added to keyboard-effect deps, text-[var(--brand-gold)] → text-brand-gold-500 token migration (6 sites).
// v1180: Case Management — ConfirmDialog for delete-case, N shortcut opens new-case modal, Esc cascade stopPropagation per branch + caseToDelete guard, canDelete/canArchive (admin|manager) + canAssign (admin|manager|supervisor) role gates, 3-state empty (loading/no-data/no-results), dead StatusBadge import removed, rgba(0,0,0,0.55) inline → bg-black/60 backdrop-blur-sm token.
// v1179: Body Cameras — Esc cascade e.stopPropagation() per branch, parseTimestamp replaces new Date(string) in video-delete label/details.
// v1177: Assets — canCreate/canEdit role gates (admin|manager|supervisor) on New Asset button, edit pencil, row-click, context-menu, and N shortcut; toast for missing ?asset_id= deep-link target.
// v1176: Alarm Management — dead React import removed, DataTable loading prop wired, emptyDescription added for error/no-data/no-results states.
// v1182: Colorado DOC — ?doc_number= deep-link auto-runs DOC lookup (toast if missing), N shortcut focuses search input, Esc cascade (close detail panel→clear search), canManage (admin/manager/supervisor) gates Create Person Record, loading skeleton distinct from no-results/empty, #888888 hex → rmpg-400 CSS var token.
// v1181: Code Enforcement — Esc cascade e.stopPropagation() per branch (confirmOpen→showReinspection→tFormOpen→vFormOpen), canEnforce added to keyboard-effect deps, text-[var(--brand-gold)] → text-brand-gold-500 token migration (6 sites).
// v1179: Body Cameras — Esc cascade e.stopPropagation() per branch, parseTimestamp replaces new Date(string) in video-delete label/details.
// v1177: Assets — canCreate/canEdit role gates (admin|manager|supervisor) on New Asset button, edit pencil, row-click, context-menu, and N shortcut; toast for missing ?asset_id= deep-link target.
// v1176: Alarm Management — dead React import removed, DataTable loading prop wired, emptyDescription added for error/no-data/no-results states.
// v1175: Accreditation — deep-link ?standard_id= with missing-record toast, DataTable loading prop for distinct loading/no-data/no-results empty states.
// v1183: Community — deepLinkRef guard on ?event_id= deep-link, Esc cascade adds e.stopPropagation() per branch (deleteTarget→form), N shortcut focuses nameInputRef, 3-state empty messages per tab (loading/no-data/no-results), emptyDescription added per tab.
// v1184: Court Records — e.stopPropagation() per Esc cascade branch (outcomeConfirm→outcomeModal→createModal→expandedRow→error→filters), canManage (admin|manager) gates New Event button, N shortcut, Record Outcome button + context-menu item.
// v1178: Billing — canManage (admin|manager) role gates on New Invoice / Edit / Delete (button + context menu + row-click + N shortcut), Esc cascade adds e.stopPropagation() per branch (deleteConfirm→formModal→filterClear) + switched to document.addEventListener, role-aware empty-state hint.
// v1174: Warrants — ConfirmDialog for single archive, Esc cascade adds e.stopPropagation() per branch + archiveConfirmOpen, role gates: canManageWarrants (admin|manager|supervisor|dispatcher) on Serve/Edit/Recall, isAdminOrManager on Archive/Delete/Unarchive.
// v1173: Tasks — Esc cascade e.stopPropagation() per branch, brand-gold CSS var replaces inline hex fallback.
// v1168: FlexCam Footage — ConfirmDialog for evidence lock, N shortcut focuses play button, Esc stopPropagation per cascade branch (lockConfirm→shortcuts→fullscreen→playbackErr→pause), canManage (admin/manager) role gates on Lock/CourtPkg/Repair, parseTimestamp replaces new Date(string) in court-pkg message, brand-400 token replaces inline #d4a017 on evidence badge.
// v1172: MDT — ConfirmDialog for off-duty + clear-call, N shortcut opens Quick FI, Esc cascade, canManage role gates, brand token cleanup.
// v1174: Warrants — ConfirmDialog for single archive, Esc cascade adds e.stopPropagation() per branch + archiveConfirmOpen, role gates: canManageWarrants (admin|manager|supervisor|dispatcher) on Serve/Edit/Recall, isAdminOrManager on Archive/Delete/Unarchive.
// v1171: Jail Records — ConfirmDialog for roster ingest, ?booking_id= deep-link, N gated to canIngest, Esc cascade (ingestConfirm→bookingSearch), id attrs on booking rows for scroll-target, sourceDeepLinkRef extracted to prevent double-consume.
// v1169: Help — N/slash focuses search, ?article=/?section= deep-link aliases (strip after mount), ConfirmDialog replaces alert() on PDF errors, Print/PDF gated to admin (canPrint), Esc cascade adds stopPropagation per branch, healthLoading state distinct empty, #d4a017/#888888/#ffffff/#aaaaaa → brand-400/rmpg-* CSS var tokens.
// v1168: FlexCam Footage — ConfirmDialog for evidence lock, N shortcut focuses play button, Esc stopPropagation per cascade branch (lockConfirm→shortcuts→fullscreen→playbackErr→pause), canManage (admin/manager) role gates on Lock/CourtPkg/Repair, parseTimestamp replaces new Date(string) in court-pkg message, brand-400 token replaces inline #d4a017 on evidence badge.
// v1167: FlexCam — ConfirmDialog for repair+court-pkg, canLock role gate (admin/manager), N shortcut triggers refresh, Esc cascade adds stopPropagation, ?trip_id= deep-link, loading skeleton, brand token migration (#d4a017→brand-400), <a>→<Link> for PLAY, parseTimestamp replaces new Date() in custody timestamps.
// v1166: Email — useSearchParams replaces window.history.replaceState for ?enrolled=/?folder=/?thread_id=/?message_id=/?compose= deep-links, canManage (admin/manager) role gates on bulk-delete/empty-folder/block-sender/sweep-sender/auto-categorize/delete-folder.
// v1170: Invoices — divide-border-subtle token replaces inline CSS var, PAYMENT_METHODS map/find shadow-m renamed to pm, CreatePanel RichTextArea ids + labels deduped from line-item form ids.
// v1164: Incidents — manager/supervisor role gates for delete/approve/return/archive, isGodMode → canSupervise (admin|manager|supervisor), #ec4899 hex → CSS var token.
// v1163: Field Interviews — ?interview_id= deep-link (alias for ?fi_id=, strip after mount), Esc stopPropagation per cascade branch, canManage (admin/manager/supervisor) role gates on Edit/Archive/New FI, dead StatusBadge import removed, localToday() replaces new Date() in EMPTY_FORM, rgba hex → toolbar-btn token on submit button.
// v1160: Criminal History — N shortcut focuses search, ConfirmDialog before PDF export, Print gated admin/manager/supervisor, Esc cascade extended (printConfirm → person deselect).
// v1162: Evidence & Property — ConfirmDialog for dispose/forfeit + approve/deny release, canDispose role gate (admin/manager) on destroy+forfeit, useSearchParams hoisted before useState initialisers, Esc cascade adds e.stopPropagation() per branch, unused StatusBadge import removed, evidence-barcode-stripe CSS var replaces inline rgba hex.
// v1161: Daily Activity Reports — role gates broadened (canApprove: admin/manager/supervisor for approve/return, canManage: admin unrestricted), deep-link ?dar_id=/?date=/?officer_id= already present, N shortcut, Esc cascade, ConfirmDialog for return-for-revision, 3-state empty (loading/no-data/no-results), isAdmin/isGodMode renamed to canApprove/canManage for clarity.
// v1160: Criminal History — N shortcut focuses search, ConfirmDialog before PDF export, Print gated admin/manager/supervisor, Esc cascade extended (printConfirm → person deselect).
// v1159: Crime Analysis — N shortcut focuses date-range filter, Esc cascade blurs active control, ?date_range=/?district= deep-link strip, Export gated to admin/manager (canExport), brand token migration (#888888→rmpg-400, #1e1e1e→border-subtle, chart hex→CSS vars), filterActive TS2367 fix.
// v1158: Communications — useSearchParams replaces window.history.replaceState for deep-link strip (?tab=, ?thread_id=, ?message_id=, ?bolo_id=, ?newBolo=), N shortcut (compose message/bolos tab), Esc cascade (emergencyBroadcast→deleteMsg→cancelBOLO→compose→newBOLO→thread→search), role gates (canCreateBolo: admin/manager/supervisor/dispatcher), ConfirmDialog for delete-message + cancel-BOLO, 3-state empty states (loading/no-data/no-search-results), brand token migration (#9ca4ad→rmpg-300-rgb, #fff→text-primary CSS var).
// v1157: Citations — role gates (canManage: admin/manager/supervisor) on New/Edit/Void/context-menu/mobile-FAB, N shortcut gated on canManage, Esc cascade adds e.stopPropagation() per branch, ?citation_id= deep-link already present.
// v1156: Arrest Records — role gates expanded to admin/manager/supervisor (MANAGE_ROLES), N shortcut + New Booking button + delete gated to canManage, Esc cascade adds e.stopPropagation() per branch, empty-state text/action conditional on canManage.
// v1163: Field Interviews — ?interview_id= deep-link (alias for ?fi_id=, strip after mount), Esc stopPropagation per cascade branch, canManage (admin/manager/supervisor) role gates on Edit/Archive/New FI, dead StatusBadge import removed, localToday() replaces new Date() in EMPTY_FORM, rgba hex → toolbar-btn token on submit button.
// v1155: Affairs — role gates (admin/manager/supervisor) on create/edit/delete; N shortcut gated by canManage; ComplaintDetail Edit+Delete hidden for non-managers.
// v1154: Person Dossier — ?person_id= deep-link (strip after mount), Esc stopPropagation in photoOpen branch, N shortcut (canManage→open record), role-gate watchlist toggle (admin/manager/supervisor), text-rmpg-400/text-brand-400 token migration.
// v1153: Module Directory — ?module= deep-link (strip after mount), N shortcut focuses search, Esc cascade (clear search→blur), 3-state empty (loading badges/no-results/empty-favorites), brand token migration (hex→CSS var), dead PanelTitleBar clone removed (import shared component), apiFetch types tightened (any→typed), useSearchParams replaces manual URL param read.
// v1152: Recon Connect — ConfirmDialog for stop session (admin/manager gate), ?category= deep-link (strip after mount), N shortcut focuses catalog search, Esc cascade (stop-confirm→launchMsg), idle terminal empty state, role-gated Stop button (admin/manager), brand token migration (#d4a017→brand-400, #888→rmpg-400), apiFetch cases shape fix (.data unwrap), GlobalCatalogSearch searchRef prop.
// v1151: Intel Search — ?subject_id= deep-link (strip after mount, hydrates person:<id> query), N shortcut focuses search input, Esc cascade adds e.stopPropagation() per branch + ConfirmDialog handled first, ConfirmDialog for saved-search delete (admin/manager), brand token migration (#d4a017→brand-400/brand-500, #888→rmpg-400/rmpg-500, #ff6b5e→red-400, #3a0d0a→bg-red-950, type-tag hex→Tailwind semantic tokens, relevance bar bg-[#d4a017]→bg-brand-500), SearchBar accepts inputRef + onRemoveSaved props (Trash2 icon on saved rows for canManage).
// v1150: Geography — role gates (admin/manager/supervisor) for create/edit/delete, N shortcut gated, + button hidden for read-only roles.
// v1149: GeoData Viewer — ?layer= deep-link (strip after mount), N shortcut focuses feature search, Esc cascade (detail panel→column filter→search clear), 3-state empty states (loading/no-features/no-search-results with clear-search action), brand tokens (#34d399→var(--green-400), #f87171→var(--red-400), #a78bfa→var(--purple-400), #fb923c→var(--orange-400), #888→var(--rmpg-400), #666→var(--rmpg-600), #080808/#0a0a0a→CSS surface vars).
// v1148: NCIC Terminal — deep-link strip, N shortcut, Esc nav, Export/Clear session (admin/manager), timezone-aware timestamps
// v1147: Command Center — ?panel= deep-link (strip after mount), N shortcut triggers refresh, Esc cascade stops propagation, Loader2 loading state + Retry no-data state + no-unit/no-chart empty states, canManage role gate on fullscreen button (admin/manager/supervisor), field alias fix (call_type/address fallbacks for incident_type/location_address+unit_number/call_sign), brand token migration (UNIT_STATUS_TOK CSS vars replace hardcoded hex, chart Cell fills, risk-score inline styles, priority border colors).
// v1149: Alerts — role gates (admin/manager/supervisor) for create/edit/delete, created_at relative time formatting.
// v1146: Analytics — ?report=+?date_range= deep-link (strip after mount), N shortcut focuses plate search input, Esc cascade (confirmExport→showRaw), ConfirmDialog for Export action (admin/manager), role gate canExport (admin/manager) on Export button, 3-state empty states (loading/no-data/no-search-results) across all tabs, parseTimestamp replaces new Date() in fmtTs.
// v1145: Alerts — role gates (admin/manager/supervisor) for create/edit/delete, N shortcut skips non-managers, created_at relative time formatting.
// v1144: Notifications — N shortcut marks all read, role gates (admin/manager/supervisor) for bulk Clear Read and Cleanup 30d+.
// v1143: Screening — ?screen_id=+?person_id= deep-link (strip after mount), N shortcut focuses surname input on search tab, Esc cascade closes confirm dialog, ConfirmDialog for hit confirm/dismiss + forced re-scrape, role gates canManage (admin/manager/supervisor) on SOR import/scrape/interval-edit, 3-state empty states (search: idle/loading/no-results; review: loading/empty; sources: loading/no-sources), inline interval editor replaces window.prompt+window.alert, brand token migration (#d4a017→brand-400/brand-500, #888→rmpg-400/rmpg-500, bg-black→bg-surface-sunken, #e87558→red-400, warning banners use brand-300/brand-600).
// v1142: Security Dashboard — ConfirmDialog for unblock-IP, ?tab= deep-link (strip after mount), N shortcut triggers refresh, Esc cascade closes confirm dialog, distinct empty states (loading/no-data), role-gated unblock action (admin/manager/supervisor), brand-gold-500/text-rmpg-400 tokens replace hardcoded hex.
// v1141: Serve Scheduler — ?schedule_id= deep-link (strip after mount, highlight+scroll slot), N shortcut opens Rebalance (canManage), Esc cascade (rebalance→blur), ConfirmDialog for rebalance apply (warning variant), canManage role gate on Rebalance button+drag ops, 3-state empty (loading/empty-window/error), OfficerLaneTimeline highlightSlotId prop.
// v1136: Skip Tracer — Esc cascade adds e.stopPropagation() per branch, remove dead expandedPerson state (no callsites).
// v1139: Serve — role gates (canManage: admin/manager/supervisor) on Add Job button, N shortcut, Edit job menu item; Esc cascade adds e.stopPropagation(); dead code removed (affidavitData, handleGenerateAffidavit, handleNotifyCompletion); brand tokens (#d4a017→text-brand-gold-500, #888888→rmpg-500, #141414→CSS vars); map popup CSS vars; duplicate id fixed on Apt/Unit input.
// v1138: Training Management — ?course_id= deep-link (strip after mount), search/filter in toolbar, distinct no-data vs no-results empty states, Esc stopPropagation, ConfirmDialog + role gates + N shortcut already present.
// v1137: Statute Analytics — ?statute=+?date_range= deep-link (strip after mount), N shortcut focuses statute search, Esc cascade (clearConfirm→search→penaltyResult→topCharged), ConfirmDialog for clear-cache (admin/manager), role gate clear button, 3-state empty (loading/no-data/no-search-results), LEVEL_COLORS hex → CSS var tokens (rgb(var(--*-rgb))), ?? nullish-coalescing replaces ||, dead inline-style replaced with Tailwind tokens.
// v1135: Settings — ConfirmDialog for reset-tones/reset-map, useSearchParams replaces window.history.replaceState for ?section= deep-link strip, N shortcut (admin/manager publishes org defaults), Esc cascade (confirmResetTones→confirmResetMap→capturingKey).
// v1133: Connections Analyst — ?connection_id=+?type= deep-link (strip after mount), N shortcut saves investigation (canManage), Esc cascade (annotation→save modal→load dropdown→path mode), ConfirmDialog for delete-investigation, role gate save/delete (admin/manager/supervisor), no-seed + no-results empty states, brand token migration (var(--brand-gold)/var(--surface-sunken)/brand-400 Tailwind tokens).
// v1132: Admin — brand token pass: replace hardcoded #1a1a1a/#888888/rgba(136,136,136,…) in header gradient, mobile tab strip, and desktop sidebar with CSS variable tokens (var(--surface-base), rgb(var(--rmpg-500-rgb)), var(--text-primary), var(--text-muted)); hover class migrated to hover:bg-rmpg-500/[0.08].
// v1131: Audit Log — N shortcut focuses search-details input, in-page role gate (admin/manager) with restricted empty state, hex tokens replaced with CSS vars (--green-500/--amber-500), Esc cascade refactored to stable refs, dead comment cleanup.
// v1130: Training Docs (/training-docs) — fixed creator name display (API returns created_by_name, not creator_name); all 10 audit items already present (ConfirmDialog, deep-link ?doc_id=, N shortcut, Esc cascade, 3-state empty, role gates, API shape, no dead code, brand tokens).
// v1129: Text Editor — ConfirmDialog replaces window.confirm for revert, ?doc_id= deep-link alias (strip after mount), N shortcut (navigate to Documents when no file loaded), Esc cascade closes revert dialog, empty state for no-file, role gates (supervisor+ can edit/save; others view-only), #d4a017 → text-brand-gold-500 token.
// v1128: Shift Plans — useSearchParams replaces window.history.replaceState for deep-link strip (?plan_id=/?date=), canManage role gate (admin/manager/supervisor) on create/edit/delete/archive/clear-all/N-shortcut, N shortcut gated, context menu mutate items gated.
// v1127: Use of Force — audit pass: e.stopPropagation() added to Esc cascade branches (form/reviewDialog/error/selection/filters), header comment updated to v1127; all prior features (ConfirmDialog, ?uof_id= deep-link, N shortcut, role-gated review, 3-state empty, brand tokens) verified clean.
// v1126: Plate Log — role gates (canManage: admin/manager/supervisor) on Confirm/Reject/Bulk actions, ConfirmDialog for bulk ops, 3-state empty (loading/no-data/no-results-for-filter), brand-gold-500 tokens replace all hardcoded #d4a017, text-rmpg-400 replaces #888888.
// v1125: NSOPW Offender Registry — deep-link setSearchParams strip, N shortcut, Esc cascade, parseTimestamp for last-run display.
// v1124: Court Tracker — role gates (canManage: admin/manager), ?case_id= deep-link, API shape fixes (upcoming/single-event/conflicts/stats/calendar wrapped in {data}), byType event_type key fix, case_id filter on GET /events.
// v1123: Code Enforcement — role gates (canEnforce: admin/manager/supervisor) gate
//        New button, N shortcut, void/refer violation, cancel tow; ConfirmDialog for
//        void + cancel (warning variant); ?case_id= deep-link alias for ?violation_id=;
//        Esc cascade now closes ConfirmDialog first; all existing features preserved.
// v1122: Trespass Orders — role gates (canManage: admin/manager/supervisor) for create/edit/serve/lift/violate/renew; officers/dispatchers get read-only. Context menu, toolbar, detail panel, and empty-state action all gated. N shortcut suppressed for read-only roles.
// v1121: Law Book — ?section= deep-link alias, / shortcut to focus search, Esc stopPropagation, canManage role gate, sev-* token migration.
// v1120: National Warrants — ?search= / ?warrant_id= deep-link, N shortcut, Esc cascade (highlight→state→results), 3-state empty (idle/searching/no-results), row highlight + scroll-into-view for warrant_id deep-link.
// v1119: DL Search — ?dl_number= / ?person_id= deep-link, N shortcut focuses search, Esc cascade (modal→panel→results), 3-state empty (not-searched/loading/no-results), ConfirmDialog for SOR import, dead Camera import removed.
// v1118: Recruitment — ConfirmDialog replaces inline delete div, ?applicant_id= / ?recruit_id=
//        deep-link, N shortcut, Esc cascade (delete → form), 3-state empty (loading/error/no-data/
//        no-results), role gates (canManage: admin/manager/human_resources), search filter,
//        safeDateStr for applied_date display, localToday() replaces new Date() in EMPTY_FORM,
//        dead-code cleanup (deleteId → deleteTarget, loading → loadState, any → typed formData).
// v1117: Accreditation — role gates (canManage: admin/manager), ?standard_id= / ?accred_id= deep-link, N shortcut, Esc cascade, 3-state empty (loading/error/no-data/no-results), ConfirmDialog replaces inline delete modal, search filter, typed formData, dead-code cleanup.
// v1116: Narcotics — role gates (canManage: admin/manager/supervisor), ?narcotics_id= / ?case_id= deep-link, N shortcut, Esc cascade, 3-state empty (loading/error/no-data/no-results), ConfirmDialog replaces DeleteRecordModal, search filter, dead-code cleanup.
// v1115: Alarm Management — role gates (canWrite/canDelete: admin/manager/supervisor), ?alarm_id= deep-link, N shortcut, Esc cascade, 3-state empty states, ConfirmDialog replaces inline delete modal, search filter, dead-code cleanup.
// v1134: Forensic Lab — role gates (canManage: admin/manager/supervisor) for create/edit/QC/custody actions and New Case tab/shortcut.
// v1114: Victim Services — role gates (canManage: admin/manager/supervisor), ?victim_id= / ?case_id= deep-link, N shortcut, Esc cascade, 3-state empty (loading/error/no-data/no-results), ConfirmDialog replaces DeleteRecordModal, search filter, dead-code cleanup.
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
const CACHE_NAME = 'rmpg-flex-v689';
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
