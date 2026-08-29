// Route path -> dynamic import factory.
//
// This is the seam that lets anything outside App.tsx warm a route chunk.
// Before it existed, prefetch was hardcoded to Dispatch and Map, because those
// were the only two routes with named import factories; the other 130+ lazy()
// calls were anonymous inline consts.
//
// Scope: the nav-catalog entries only. Detached windows, QR-token public routes
// (/m/*) and redirects are never nav-prefetched, so they are deliberately absent.
//
// INVARIANT: each specifier must match App.tsx's import for the same route
// EXACTLY. Two different specifiers for one module means two chunks, and the
// prefetch warms the one the router doesn't use. routeModules.test.ts pins
// coverage against navCatalog, but it cannot catch a specifier that points at
// the wrong-but-real module — copy, don't retype.
//
// importDashboard is defined HERE, not in App.tsx, and imported BY App.tsx.
// App.tsx also imports this module transitively (via useRoutePrefetch), so if
// the factory lived
// in App.tsx as `export const importDashboard = ...` this file would import
// App.tsx back, and App.tsx's own import of it would read the binding while
// still in its temporal dead zone -> ReferenceError at module-eval time,
// breaking `npm run dev` (production's Rollup bundling papers over the same
// cycle by flattening scopes, so only dev surfaces it). Keeping the one true
// DashboardPage factory in this leaf module (which imports nothing from
// App.tsx) breaks the cycle instead of hiding it.
export type RouteImporter = () => Promise<unknown>;

export const importDashboard = () => import('../pages/DashboardPage');

export const ROUTE_MODULES: Readonly<Record<string, RouteImporter>> = {
  '/': importDashboard,
  '/downloads': () => import('../pages/DownloadsPage'),
  '/dispatch': () => import('../pages/dispatch'),
  '/map': () => import('../pages/map'),
  '/mdt': () => import('../pages/MdtPage'),
  '/ncic': () => import('../pages/NcicPage'),
  '/geography': () => import('../pages/GeographyPage'),
  '/incidents': () => import('../pages/IncidentsPage'),
  '/records': () => import('../pages/RecordsPage'),
  '/field-interviews': () => import('../pages/FieldInterviewsPage'),
  '/criminal-history': () => import('../pages/CriminalHistoryPage'),
  '/dl-search': () => import('../pages/DlSearchPage'),
  // '/microbilt' resolves to SkipTracerV2Page per App.tsx's <Route path="/microbilt">.
  '/microbilt': () => import('../pages/skiptracer/SkipTracerV2Page'),
  '/evidence': () => import('../pages/EvidencePropertyPage'),
  '/forensic-lab': () => import('../pages/ForensicLabPage'),
  '/connections': () => import('../pages/ConnectionsPage'),
  '/cases': () => import('../pages/CaseManagementPage'),
  '/arrest-records': () => import('../pages/ArrestRecordsPage'),
  '/court-records': () => import('../pages/CourtRecordsPage'),
  '/documents': () => import('../pages/DocumentsPage'),
  '/document-intake': () => import('../pages/DocumentIntakePage'),
  '/warrants': () => import('../pages/WarrantsPage'),
  '/national-warrant-search': () => import('../pages/NationalWarrantSearchPage'),
  '/citations': () => import('../pages/CitationsPage'),
  '/law-book': () => import('../pages/LawBookPage'),
  '/knowledge-base': () => import('../pages/KnowledgeBasePage'),
  '/trespass-orders': () => import('../pages/TrespassOrdersPage'),
  '/code-enforcement': () => import('../pages/CodeEnforcementPage'),
  '/court': () => import('../pages/CourtTrackerPage'),
  // Canonical route. Both registry redirect targets below warm the same page
  // they land on (App.tsx: <Route path="/offender-registry"|"/sex-offender-registry"
  // element={<RedirectKeepQuery to="/nsopw" />} />).
  '/nsopw': () => import('../pages/NsopwLookupPage'),
  '/offender-registry': () => import('../pages/NsopwLookupPage'),
  '/sex-offender-registry': () => import('../pages/NsopwLookupPage'),
  '/serve': () => import('../pages/ServePage'),
  '/serve-intake': () => import('../pages/ServeIntakePage'),
  '/my-id': () => import('../pages/wallet/MyIdPage'),
  '/verify-id': () => import('../pages/wallet/VerifyIdPage'),
  '/personnel': () => import('../pages/personnel'),
  '/hr': () => import('../pages/hr/HrPage'),
  '/fleet': () => import('../pages/fleet'),
  '/body-cameras': () => import('../pages/BodyCamerasPage'),
  '/dash-cameras': () => import('../pages/DashCamerasPage'),
  '/dashcams': () => import('../pages/DashcamPage'),
  '/dashcam-ai': () => import('../pages/DashcamAiPage'),
  '/flexcam': () => import('../pages/FlexCamPage'),
  '/training': () => import('../pages/TrainingPage'),
  '/training-docs': () => import('../pages/TrainingDocsPage'),
  '/training-mgmt': () => import('../pages/TrainingManagementPage'),
  '/communications': () => import('../pages/CommunicationsPage'),
  '/dialer-connect': () => import('../pages/DialerConnectPage'),
  '/radio': () => import('../pages/radio'),
  '/email': () => import('../pages/EmailPage'),
  '/patrol': () => import('../pages/PatrolPage'),
  '/reports': () => import('../pages/ReportsPage'),
  '/shift-plans': () => import('../pages/ShiftPlansPage'),
  '/scheduler': () => import('../pages/SchedulerPage'),
  '/statute-analytics': () => import('../pages/StatuteAnalyticsPage'),
  '/reports/custom': () => import('../pages/CustomReportBuilder'),
  '/crime-analysis': () => import('../pages/CrimeAnalysisPage'),
  '/dar': () => import('../pages/DailyActivityReportsPage'),
  '/skip-tracer': () => import('../pages/SkipTracerPage'),
  '/web-research': () => import('../pages/WebResearchPage'),
  '/colorado-doc': () => import('../pages/ColoradoDocPage'),
  '/iped': () => import('../pages/IpedPage'),
  '/recon-connect': () => import('../pages/ReconConnectPage'),
  '/jail': () => import('../pages/JailPage'),
  '/affairs': () => import('../pages/AffairsPage'),
  '/assets': () => import('../pages/AssetsPage'),
  '/billing': () => import('../pages/BillingPage'),
  '/community': () => import('../pages/CommunityPage'),
  '/tasks': () => import('../pages/TasksPage'),
  '/alerts': () => import('../pages/AlertsPage'),
  '/qa': () => import('../pages/QAPage'),
  '/risk': () => import('../pages/RiskPage'),
  '/interagency': () => import('../pages/InteragencyPage'),
  '/gang-intel': () => import('../pages/GangIntelPage'),
  '/narcotics': () => import('../pages/NarcoticsPage'),
  '/special-ops': () => import('../pages/SpecialOpsPage'),
  '/crisis-response': () => import('../pages/CrisisResponsePage'),
  '/victim-services': () => import('../pages/VictimServicesPage'),
  '/alarms': () => import('../pages/AlarmManagementPage'),
  '/accreditation': () => import('../pages/AccreditationPage'),
  '/recruitment': () => import('../pages/RecruitmentPage'),
  '/crm': () => import('../pages/CrmPage'),
  '/invoices': () => import('../pages/InvoicesPage'),
  '/command-center': () => import('../pages/CommandCenterPage'),
  '/security-dashboard': () => import('../pages/SecurityDashboardPage'),
  '/use-of-force': () => import('../pages/UseOfForcePage'),
  '/desktop-company-browser': () => import('../pages/CompanyBrowserPage'),
  '/settings': () => import('../pages/SettingsPage'),
  '/notifications': () => import('../pages/NotificationsPage'),
  '/help': () => import('../pages/HelpPage'),
  '/navigation': () => import('../pages/NavigationPage'),
  '/geo-data-viewer': () => import('../pages/GeoDataViewerPage'),
  '/audit': () => import('../pages/AuditLogPage'),
  '/admin': () => import('../pages/AdminPage'),
  '/calculator': () => import('../pages/CalculatorPage'),
  '/unit-converter': () => import('../pages/UnitConverterPage'),
  '/clipboard-manager': () => import('../pages/ClipboardManagerPage'),
  '/focus-timer': () => import('../pages/FocusTimerPage'),
  '/device-health': () => import('../pages/DeviceHealthPage'),
  '/print-queue': () => import('../pages/PrintQueuePage'),
  '/scheduled-updates': () => import('../pages/ScheduledUpdatesPage'),
  '/remote-lock': () => import('../pages/RemoteLockPage'),
  '/shift-notes': () => import('../pages/ShiftNotesPage'),
  '/quick-plate': () => import('../pages/QuickPlateCheckPage'),
  '/unit-status-board': () => import('../pages/UnitStatusBoardPage'),
  '/offline-queue': () => import('../pages/OfflineQueuePage'),
  '/broadcast': () => import('../pages/BroadcastMessagePage'),
  '/screen-capture': () => import('../pages/ScreenCapturePage'),
  '/system-logs': () => import('../pages/SystemLogsPage'),
  '/live-call-map': () => import('../pages/LiveCallMapPage'),
  '/digital-evidence': () => import('../pages/DigitalEvidencePage'),
};

/**
 * Resolve a location pathname to its route importer.
 *
 * Exact match wins. Otherwise the LONGEST registered prefix wins, so
 * '/fleet/dashboard' resolves through '/fleet' and '/records/123' through
 * '/records'. Root is excluded from prefix matching — it prefixes every path,
 * so including it would make this function never return null.
 */
export function getRouteImporter(path: string): RouteImporter | null {
  const exact = ROUTE_MODULES[path];
  if (exact) return exact;

  let best: string | null = null;
  for (const key of Object.keys(ROUTE_MODULES)) {
    if (key === '/') continue;
    if (path === key || path.startsWith(`${key}/`)) {
      if (best === null || key.length > best.length) best = key;
    }
  }
  return best === null ? null : ROUTE_MODULES[best];
}
