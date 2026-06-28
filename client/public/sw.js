// ============================================================
// RMPG Flex — Service Worker
// Provides offline caching for static assets while always
// fetching API data fresh from the network.
// Supports automatic updates with client notification.
// v1214: Patrol — ?checkpoint_id= deep-link (rowRefs scroll+flash-highlight+strip+useRef guard); N+canCreate role gate (admin|manager|supervisor|officer); Esc cascade stopPropagation per branch (deleteConfirmId→QR modal→checkpoint modal); canDelete (admin|manager) gates Delete button+context-menu; text-[var(--brand-gold)] → text-brand-gold-500 (4 sites); dead patrolTabs+TabBar+Wrench/DollarSign/FileText/ClipboardCheck removed; useMemo role gates.
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
// v1133: Connections Analyst — ?connection_id=+?type= deep-link (strip after mount), N shortcut saves investigation (canManage), Esc cascade (annotation→save modal→load dropdown→path mode), ConfirmDialog for delete-investigation, role gate save/delete (admin/manager/supervisor), no-seed + no-results empty states, brand token migration (var(--brand-gold)/var(--surface-sunken)/brand-400 Tailwind tokens).
// v1132: Admin — brand token pass: replace hardcoded #1a1a1a/#888888/rgba(136,136,136,…) in header gradient, mobile tab strip, and desktop sidebar with CSS variable tokens (var(--surface-base), rgb(var(--rmpg-500-rgb)), var(--text-primary), var(--text-muted)); hover class migrated to hover:bg-rmpg-500/[0.08].
// v1131: Audit Log — N shortcut focuses search-details input, in-page role gate (admin/manager) with restricted empty state, hex tokens replaced with CSS vars (--green-500/--amber-500), Esc cascade refactored to stable refs, dead comment cleanup.
// v1130: Training Docs (/training-docs) — fixed creator name display (API returns created_by_name, not creator_name); all 10 audit items already present (ConfirmDialog, deep-link ?doc_id=, N shortcut, Esc cascade, 3-state empty, role gates, API shape, no dead code, brand tokens).
// v1129: Text Editor — ConfirmDialog replaces window.confirm for revert, ?doc_id= deep-link alias (strip after mount), N shortcut (navigate to Documents when no file loaded), Esc cascade closes revert dialog, empty state for no-file, role gates (supervisor+ can edit/save; others view-only), #d4a017 → text-brand-gold-500 token.
// v1128: Shift Plans — useSearchParams replaces window.history.replaceState for deep-link strip (?plan_id=/?date=), canManage role gate (admin/manager/supervisor) on create/edit/delete/archive/clear-all/N-shortcut, N shortcut gated, context menu mutate items gated.
// v1127: Use of Force — audit pass: e.stopPropagation() added to Esc cascade branches (form/reviewDialog/error/selection/filters), header comment updated to v1127; all prior features (ConfirmDialog, ?uof_id= deep-link, N shortcut, role-gated review, 3-state empty, brand tokens) verified clean.
// v1124: Court Tracker — role gates (canManage: admin/manager), ?case_id= deep-link, API shape fixes (upcoming/single-event/conflicts/stats/calendar wrapped in {data}), byType event_type key fix, case_id filter on GET /events.
// v1123: Code Enforcement — role gates (canEnforce: admin/manager/supervisor) gate
//        New button, N shortcut, void/refer violation, cancel tow; ConfirmDialog for
//        void + cancel (warning variant); ?case_id= deep-link alias for ?violation_id=;
//        Esc cascade now closes ConfirmDialog first; all existing features preserved.
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

const CACHE_NAME = 'rmpg-flex-v563';
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
