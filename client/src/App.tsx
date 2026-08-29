import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { UserPreferencesProvider } from './context/UserPreferencesContext';
import { NavTripProvider } from './context/NavTripContext';
import { ToastProvider } from './components/ToastProvider';
import MDTBridge from './components/MDTBridge';
import { ContextMenuProvider } from './context/ContextMenuContext';
import { FeatureFlagsProvider } from './context/FeatureFlagsContext';
import { GlobalSearch } from './components/GlobalSearch';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { resolveDispatchAccess } from './pages/dispatch/dispatchAccess';
import { isCompanyBrowserBlockedRole } from './utils/companyBrowserAccess';
import { lazyRetry } from './utils/importWithRetry';
import WebUpdateBanner from './components/WebUpdateBanner';
import ButtonHealthOverlay from './components/ButtonHealthOverlay';
const GlobalPdfViewer = lazy(() => import('./components/GlobalPdfViewer'));
import AndroidUpdateChecker from './components/AndroidUpdateChecker';
import { prefetchRoute, ROLE_PREFETCH_ROUTES } from './hooks/useRoutePrefetch';
import { useOfflineQueue } from './hooks/useOfflineQueue';
import { importDashboard } from './routes/routeModules';
import LoginPage from './pages/LoginPage';
import SsoCallbackPage from './pages/SsoCallbackPage';
// Dispatch + Map are the two heaviest field screens (~6k lines each plus deep
// import trees). They're lazy-split to keep them OUT of the login/critical
// bundle — but because they're the most-navigated-to pages, they're also
// idle-prefetched right after auth (see AppRoutes below) so the first
// navigation stays instant: the chunk is already warm in the module cache.
const importDispatch = () => import('./pages/dispatch');
const importMap = () => import('./pages/map');
const DispatchPage = lazyRetry(importDispatch);
const MapPage = lazyRetry(importMap);
// Dashboard is the post-login landing view. It used to be a STATIC import to
// keep that first navigation instant — but that put 167.9 KB (plus
// NewCallModal, IncidentFormModal and DashboardMiniMap, which it statically
// imports) into the entry chunk, so every LOGIN paid for it too. It's lazy
// now, and warmed the instant auth succeeds (see AppRoutes below), which
// keeps the landing instant without taxing the login path.
//
// The factory itself lives in routes/routeModules.ts (imported above), not
// here — routeModules.ts is also imported (transitively, via useRoutePrefetch)
// by THIS file, so defining it here would make it a circular import that
// reads an uninitialized `const` at module-eval time (TDZ ReferenceError,
// breaks `npm run dev`; production's Rollup bundling hides the same cycle by
// flattening scopes). There must be exactly ONE factory for DashboardPage in
// the app — do not add a second inline `() => import('./pages/DashboardPage')`
// here, or the prefetch and the router would warm two different chunks.
const DashboardPage = lazyRetry(importDashboard);
// Public downloads/marketing route — 25.3 KB plus KioskOsInstallGuide's
// 15.5 KB. It was static, so every LOGIN downloaded and parsed it.
const DownloadsPage = lazyRetry(() => import('./pages/DownloadsPage'));
// Dev-only PDF audit harness (/__pdf-gallery). `import.meta.env.DEV` is
// statically replaced with `false` in a production build, so this ternary's
// dead branch — including the dynamic import() itself — is eliminated by
// Vite/Rollup and no chunk is emitted at all. Gating only the <Route> below
// (and not this import) still lets Vite discover and bundle the chunk
// unconditionally, which is what shipped fixture data to Cloudflare Pages the
// first time. Deliberately plain `lazy`, not `lazyRetry`: the retry wrapper
// exists for chunk-load failures on deployed builds, and this chunk never
// reaches a deployed build.
const PdfGalleryPage = import.meta.env.DEV
  ? lazy(() => import('./devtools/pdfGallery/PdfGalleryPage'))
  : null;
// lazyRetry is imported from utils/importWithRetry — shared with Layout,
// MobileHomePage, map/index, and any other component-level lazy split.

// Lazy-loaded pages (less frequently accessed)
const IncidentsPage = lazyRetry(() => import('./pages/IncidentsPage'));
const RecordsPage = lazyRetry(() => import('./pages/RecordsPage'));
const PersonnelPage = lazyRetry(() => import('./pages/personnel'));
const CommunicationsPage = lazyRetry(() => import('./pages/CommunicationsPage'));
const DialerConnectPage = lazyRetry(() => import('./pages/DialerConnectPage'));
const ReportsPage = lazyRetry(() => import('./pages/ReportsPage'));
const AdminPage = lazyRetry(() => import('./pages/AdminPage'));
const MyIdPage = lazyRetry(() => import('./pages/wallet/MyIdPage'));
const VerifyIdPage = lazyRetry(() => import('./pages/wallet/VerifyIdPage'));
const AuditLogPage = lazyRetry(() => import('./pages/AuditLogPage'));
const CalculatorPage = lazyRetry(() => import('./pages/CalculatorPage'));
const UnitConverterPage = lazyRetry(() => import('./pages/UnitConverterPage'));
const ClipboardManagerPage = lazyRetry(() => import('./pages/ClipboardManagerPage'));
const FocusTimerPage = lazyRetry(() => import('./pages/FocusTimerPage'));
const DeviceHealthPage = lazyRetry(() => import('./pages/DeviceHealthPage'));
const PrintQueuePage = lazyRetry(() => import('./pages/PrintQueuePage'));
const ScheduledUpdatesPage = lazyRetry(() => import('./pages/ScheduledUpdatesPage'));
const RemoteLockPage = lazyRetry(() => import('./pages/RemoteLockPage'));
const TesseractTrainingPage = lazyRetry(() => import('./pages/TesseractTrainingPage'));
const PatrolPage = lazyRetry(() => import('./pages/PatrolPage'));
const FleetPage = lazyRetry(() => import('./pages/fleet'));
const FleetDashboardPage = lazyRetry(() => import('./pages/fleet/FleetDashboardPage'));
const FleetReportsPage = lazyRetry(() => import('./pages/fleet/FleetReportsPage'));
const WarrantsPage = lazyRetry(() => import('./pages/WarrantsPage'));
const CitationsPage = lazyRetry(() => import('./pages/CitationsPage'));
const LawBookPage = lazyRetry(() => import('./pages/LawBookPage'));
const KnowledgeBasePage = lazyRetry(() => import('./pages/KnowledgeBasePage'));
const FieldInterviewsPage = lazyRetry(() => import('./pages/FieldInterviewsPage'));
const TrespassOrdersPage = lazyRetry(() => import('./pages/TrespassOrdersPage'));
const MdtPage = lazyRetry(() => import('./pages/MdtPage'));
const MobileHomePage = lazyRetry(() => import('./pages/mobile/MobileHomePage'));
const FieldCameraPage = lazyRetry(() => import('./pages/mobile/FieldCameraPage'));
const MobilePsoCfsPage = lazyRetry(() => import('./pages/mobile/MobilePsoCfsPage'));
const ServeReceiptPage = lazyRetry(() => import('./pages/mobile/ServeReceiptPage'));
const VerifyNoticePage = lazyRetry(() => import('./pages/VerifyNoticePage'));
const NavigationPage = lazyRetry(() => import('./pages/NavigationPage'));
const DesktopPage = lazyRetry(() => import('./pages/DesktopPage'));
const WebCompanyBrowserPage = lazyRetry(() => import('./pages/WebCompanyBrowserPage'));
const ShiftPlansPage = lazyRetry(() => import('./pages/ShiftPlansPage'));
const StatuteAnalyticsPage = lazyRetry(() => import('./pages/StatuteAnalyticsPage'));
const CustomReportBuilder = lazyRetry(() => import('./pages/CustomReportBuilder'));
const CriminalHistoryPage = lazyRetry(() => import('./pages/CriminalHistoryPage'));
const EvidencePropertyPage = lazyRetry(() => import('./pages/EvidencePropertyPage'));
const CaseManagementPage = lazyRetry(() => import('./pages/CaseManagementPage'));
const CrimeAnalysisPage = lazyRetry(() => import('./pages/CrimeAnalysisPage'));
const CodeEnforcementPage = lazyRetry(() => import('./pages/CodeEnforcementPage'));
const CourtTrackerPage = lazyRetry(() => import('./pages/CourtTrackerPage'));
const DailyActivityReportsPage = lazyRetry(() => import('./pages/DailyActivityReportsPage'));
// OffenderRegistryPage + SexOffenderRegistryPage were consolidated into the
// NSOPW federated cross-reference (PR series #1588 → #1590 → #1594 → photos
// PR). The two old tabs (Utah-only iCrimeWatch SOR + RMPG-internal offender
// compliance) are now redirected to /nsopw — historical bookmarks survive,
// the canonical SOR surface is one tab now.
const NsopwLookupPage = lazyRetry(() => import('./pages/NsopwLookupPage'));
const NcicPage = lazyRetry(() => import('./pages/NcicPage'));
const DlSearchPage = lazyRetry(() => import('./pages/DlSearchPage'));
const BodyCamerasPage = lazyRetry(() => import('./pages/BodyCamerasPage'));
const DashCamerasPage = lazyRetry(() => import('./pages/DashCamerasPage'));
const TrainingDocsPage = lazyRetry(() => import('./pages/TrainingDocsPage'));
const TrainingPage = lazyRetry(() => import('./pages/TrainingPage'));
const ForensicLabPage = lazyRetry(() => import('./pages/ForensicLabPage'));
const DataCapturePage = lazyRetry(() => import('./pages/dispatch/DataCapturePage'));
const SkipTracerPage = lazyRetry(() => import('./pages/SkipTracerPage'));
const SkipTracerV2Page = lazyRetry(() => import('./pages/skiptracer/SkipTracerV2Page'));
const ArrestRecordsPage = lazyRetry(() => import('./pages/ArrestRecordsPage'));
const EmailPage = lazyRetry(() => import('./pages/EmailPage'));
const CrmPage = lazyRetry(() => import('./pages/CrmPage'));
const ServePage = lazyRetry(() => import('./pages/ServePage'));
const ServeIntakePage = lazyRetry(() => import('./pages/ServeIntakePage'));
const ServeSchedulerPage = lazyRetry(() => import('./pages/ServeSchedulerPage'));
const SchedulerPage = lazyRetry(() => import('./pages/SchedulerPage'));
const ShiftBriefingsPage = lazyRetry(() => import('./pages/ShiftBriefingsPage'));
const WebResearchPage = lazyRetry(() => import('./pages/WebResearchPage'));
const HRPage = lazyRetry(() => import('./pages/hr/HrPage'));
const GeographyPage = lazyRetry(() => import('./pages/GeographyPage'));
const DialerConnectPage = lazyRetry(() => import('./pages/DialerConnectPage'));
const RouteBuilderPage = lazyRetry(() => import('./pages/RouteBuilderPage'));
const ConnectionsPage = lazyRetry(() => import('./pages/ConnectionsPage'));
const IntelReportsPage = lazyRetry(() => import('./pages/intel/IntelReportsPage'));
const IntelReportDetailPage = lazyRetry(() => import('./pages/intel/IntelReportDetailPage'));
const NewIntelReportPage = lazyRetry(() => import('./pages/intel/NewIntelReportPage'));
const IntelSourcesPage = lazyRetry(() => import('./pages/intel/IntelSourcesPage'));
const PersonDossierPage = lazyRetry(() => import('./pages/PersonDossierPage'));
const IntelPortalLayout = lazyRetry(() => import('./pages/intel/IntelPortalLayout'));
const IntelDashboard = lazyRetry(() => import('./pages/intel/IntelDashboard'));
const WatchlistSection = lazyRetry(() => import('./pages/intel/WatchlistSection'));
const AlertsSection = lazyRetry(() => import('./pages/intel/AlertsSection'));
const ReviewQueues = lazyRetry(() => import('./pages/intel/ReviewQueues'));
const IntelMapPage = lazyRetry(() => import('./pages/intel/IntelMapPage'));
const IntelAiAnalyst = lazyRetry(() => import('./pages/intel/IntelAiAnalyst'));
const BoloBoard = lazyRetry(() => import('./pages/intel/BoloBoard'));
const IntelSearch = lazyRetry(() => import('./pages/intel/IntelSearch'));
const PlateLogPage = lazyRetry(() => import('./pages/PlateLogPage'));
const AlprHistoryPage = lazyRetry(() => import('./pages/AlprHistoryPage'));
const AnalyticsPage = lazyRetry(() => import('./pages/AnalyticsPage'));
const QuickCapturePage = lazyRetry(() => import('./pages/QuickCapturePage'));
const JailRecordsPage = lazyRetry(() => import('./pages/JailRecordsPage'));
const InteractionRecorderPage = lazyRetry(() => import('./pages/InteractionRecorderPage'));
const UseOfForcePage = lazyRetry(() => import('./pages/UseOfForcePage'));
const SecurityDashboardPage = lazyRetry(() => import('./pages/SecurityDashboardPage'));
const HelpPage = lazyRetry(() => import('./pages/HelpPage'));
const NotificationsPage = lazyRetry(() => import('./pages/NotificationsPage'));
const ColoradoDocPage = lazyRetry(() => import('./pages/ColoradoDocPage'));
const CommandCenterPage = lazyRetry(() => import('./pages/CommandCenterPage'));
const GeoDataViewerPage = lazyRetry(() => import('./pages/GeoDataViewerPage'));
const InvoicesPage = lazyRetry(() => import('./pages/InvoicesPage'));
const IpedPage = lazyRetry(() => import('./pages/IpedPage'));
const NationalWarrantSearchPage = lazyRetry(() => import('./pages/NationalWarrantSearchPage'));
const SettingsPage = lazyRetry(() => import('./pages/SettingsPage'));
const DashcamPage = lazyRetry(() => import('./pages/DashcamPage'));
const RadioPage = lazyRetry(() => import('./pages/radio'));
const JailPage = lazyRetry(() => import('./pages/JailPage'));
const AffairsPage = lazyRetry(() => import('./pages/AffairsPage'));
const AssetsPage = lazyRetry(() => import('./pages/AssetsPage'));
const CommunityPage = lazyRetry(() => import('./pages/CommunityPage'));
const TasksPage = lazyRetry(() => import('./pages/TasksPage'));
const AlertsPage = lazyRetry(() => import('./pages/AlertsPage'));
const TrainingManagementPage = lazyRetry(() => import('./pages/TrainingManagementPage'));
const QAPage = lazyRetry(() => import('./pages/QAPage'));
const BillingPage = lazyRetry(() => import('./pages/BillingPage'));
const RiskPage = lazyRetry(() => import('./pages/RiskPage'));
const InteragencyPage = lazyRetry(() => import('./pages/InteragencyPage'));
const GangIntelPage = lazyRetry(() => import('./pages/GangIntelPage'));
const PersonIntelPage = lazyRetry(() => import('./pages/PersonIntelPage'));
const PersonIntelDossierPage = lazyRetry(() => import('./pages/PersonIntelDossierPage'));
const SpecialOpsPage = lazyRetry(() => import('./pages/SpecialOpsPage'));
const CrisisResponsePage = lazyRetry(() => import('./pages/CrisisResponsePage'));
const VictimServicesPage = lazyRetry(() => import('./pages/VictimServicesPage'));
const AlarmManagementPage = lazyRetry(() => import('./pages/AlarmManagementPage'));
const NarcoticsPage = lazyRetry(() => import('./pages/NarcoticsPage'));
const NavPage = lazyRetry(() => import('./pages/NavPage'));
const AccreditationPage = lazyRetry(() => import('./pages/AccreditationPage'));
const RecruitmentPage = lazyRetry(() => import('./pages/RecruitmentPage'));
const IncidentDetailWindow = lazyRetry(() => import('./pages/detached/IncidentDetailWindow'));
const RecordDetailWindow = lazyRetry(() => import('./pages/detached/RecordDetailWindow'));
const CompanyBrowserPage = lazyRetry(() => import('./pages/CompanyBrowserPage'));
const CourtRecordsPage = lazyRetry(() => import('./pages/CourtRecordsPage'));
const DashCamDetailPage = lazyRetry(() => import('./pages/DashCamDetailPage'));
const FlexCamPage = lazyRetry(() => import('./pages/FlexCamPage'));
const FlexCamFootagePage = lazyRetry(() => import('./pages/FlexCamFootagePage'));
const TripPlaybackPage = lazyRetry(() => import('./pages/flexcam/TripPlaybackPage'));
const DashcamAiPage = lazyRetry(() => import('./pages/DashcamAiPage'));
const DocumentIntakePage = lazyRetry(() => import('./pages/DocumentIntakePage'));
const DocumentsPage = lazyRetry(() => import('./pages/DocumentsPage'));
const PdfEditorPage = lazyRetry(() => import('./pages/pdf-editor'));
const DocumentWriterPage = lazyRetry(() => import('./pages/document-writer'));
const TextEditorPage = lazyRetry(() => import('./pages/TextEditorPage'));
const DocsLibraryPage = lazyRetry(() => import('./pages/docs/DocsLibraryPage'));
// ForgotPasswordPage was a legacy standalone email-based reset surface. The
// route now redirects to /login?forgot=1 (the working username + security-
// question flow lives inline on LoginPage), so the page no longer ships.
const ReconConnectPage = lazyRetry(() => import('./pages/ReconConnectPage'));
const DeviceScannerPage = lazyRetry(() => import('./pages/DeviceScannerPage'));
const ResetPasswordPage = lazyRetry(() => import('./pages/ResetPasswordPage'));
const OidcCallbackPage = lazyRetry(() => import('./pages/OidcCallbackPage'));
const MobileShiftPage = lazyRetry(() => import('./pages/MobileShiftPage'));
// CrashReportsPage existed on disk but had no route in App.tsx — sidebar link
// hit the 404 catch-all. No backend route exists yet either; the page is a
// self-contained wizard that fetches from (non-existent) /api/crash-reports.
// Adding the route so the sidebar link renders the page stub instead of 404.
const CrashReportsPage = lazyRetry(() => import('./pages/CrashReportsPage'));
// ImpoundPage existed on disk but had no route — sidebar /impound link 404'd.
const ImpoundPage = lazyRetry(() => import('./pages/ImpoundPage'));
const ShiftNotesPage = lazyRetry(() => import('./pages/ShiftNotesPage'));
const QuickPlateCheckPage = lazyRetry(() => import('./pages/QuickPlateCheckPage'));
const UnitStatusBoardPage = lazyRetry(() => import('./pages/UnitStatusBoardPage'));
const OfflineQueuePage = lazyRetry(() => import('./pages/OfflineQueuePage'));
const BroadcastMessagePage = lazyRetry(() => import('./pages/BroadcastMessagePage'));
const ScreenCapturePage = lazyRetry(() => import('./pages/ScreenCapturePage'));
const SystemLogsPage = lazyRetry(() => import('./pages/SystemLogsPage'));
const LiveCallMapPage = lazyRetry(() => import('./pages/LiveCallMapPage'));
const DigitalEvidencePage = lazyRetry(() => import('./pages/DigitalEvidencePage'));


/** Branded loading splash — matches login page design language */
function LoadingSplash({ message = 'Initializing' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center bg-surface-base" style={{ height: '100dvh' }}>
      <div className="flex flex-col items-center">
        {/* Neutralized splash glow to match the darker desktop chrome */}
        <img
          src="/rmpg flex.png"
          alt="RMPG Flex"
          className="drop-shadow-[0_0_18px_rgba(167,177,188,0.22)]"
          style={{ height: 88, width: 88, objectFit: 'contain' }}
          draggable={false}
        />

        {/* Animated scanning line beneath logo */}
        <div
          className="mt-4 mb-3 overflow-hidden"
          style={{ width: 140, height: 2, background:"var(--surface-sunken)", borderRadius: 1 }}
        >
          <div
            className="h-full"
            style={{
              width: 48,
              background: 'linear-gradient(90deg, transparent, var(--accent-silver-400), transparent)',
              animation: 'scanLine 1.6s ease-in-out infinite',
            }}
          />
        </div>

        {/* Status text */}
        <p
          className="text-[9px] uppercase tracking-[0.2em] font-bold"
          style={{ color: 'rgba(198, 203, 210, 0.7)' }}
        >
          {message}
        </p>

        {/* Subtle system label */}
        <div className="flex items-center gap-2 mt-3">
          <div className="h-px w-10" style={{ background: 'linear-gradient(90deg, transparent, var(--border-default))' }} />
          <span
            className="text-[7px] tracking-[0.15em] uppercase font-bold"
            style={{ color: 'rgba(167, 177, 188, 0.42)' }}
          >
            CAD / RMS
          </span>
          <div className="h-px w-10" style={{ background: 'linear-gradient(90deg, var(--border-default), transparent)' }} />
        </div>
      </div>

      {/* CSS animation for the scanning line */}
      <style>{`
        @keyframes scanLine {
          0%   { transform: translateX(-48px); }
          100% { transform: translateX(140px); }
        }
      `}</style>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingSplash message="Loading RMPG Flex" />;
  }

  if (!isAuthenticated) {
    // Preserve the originally-requested URL so LoginPage can route the
    // operator back after auth. Excludes /login itself to avoid loops.
    const returnTo = location.pathname + location.search;
    const params = returnTo && returnTo !== '/login'
      ? `?return=${encodeURIComponent(returnTo)}`
      : '';
    return <Navigate to={`/login${params}`} replace />;
  }

  return <>{children}</>;
}

/** Role-based guard — restricts to admin + manager roles */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSplash message="Loading RMPG Flex" />;
  }

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center" role="alert">
        <div className="w-12 h-12 flex items-center justify-center mb-3"
          style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)' }}>
          <span style={{ color: 'var(--sev-critical)', fontSize: 20, fontWeight: 800 }}>!</span>
        </div>
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--sev-critical-soft)] mb-1.5">Access Denied</h3>
        <p className="text-[10px] text-fg-muted max-w-xs mb-4">You do not have permission to view this page.</p>
        <a href="/" className="btn-gold">Return to Dashboard</a>
      </div>
    );
  }

  return <>{children}</>;
}

/** Role-based guard for /dispatch — officer redirects to the terminal built
 *  for them (/mdt), contract_manager/client_viewer/human_resources redirect
 *  to the dashboard (no operational need for a live CAD board). Every other
 *  role reaches the full board unchanged. See
 *  docs/superpowers/specs/2026-07-02-dispatch-role-routing-p1-design.md */
function DispatchRoleGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSplash message="Loading RMPG Flex" />;
  }

  const access = resolveDispatchAccess(user?.role);
  if (access.mode === 'redirect') {
    return <Navigate to={access.to} replace />;
  }

  return <>{children}</>;
}

/** Role-based guard for /desktop-company-browser — client_viewer/contract_manager
 *  redirect to the dashboard. Closes the direct-URL/bookmark gap the nav-catalog
 *  exclusion (CLIENT_VIEWER_BLOCKED/CONTRACT_MANAGER_BLOCKED in navCatalog.ts)
 *  doesn't cover on its own — that only hides the launcher icon. See
 *  docs/superpowers/specs/2026-07-20-company-browser-hardening-design.md. */
function CompanyBrowserRoleGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSplash message="Loading RMPG Flex" />;
  }

  if (isCompanyBrowserBlockedRole(user?.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

/** 404 Not Found page */
function NotFoundPage() {
  return (
    <div className="flex items-center justify-center h-full p-8" style={{ background:"var(--surface-sunken)" }}>
      <div className="text-center max-w-md">
        {/* Logo with fallback */}
        <img
          src="/rmpg flex.png"
          alt="RMPG Flex"
          className="mx-auto mb-6 opacity-20"
          style={{ height: 80, width: 80, objectFit: 'contain' }}
          draggable={false}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />

        {/* Error code */}
        <div className="mb-4">
          <span
            className="text-6xl font-black tracking-tight"
            style={{ color: 'var(--surface-raised)', textShadow: '0 0 40px rgba(212,160,23,0.15)' }}
          >
            404
          </span>
        </div>

        {/* Status bar — mimics CAD console */}
        <div
          className="inline-flex items-center gap-2 px-4 py-2 mb-6 border"
          style={{
            background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)',
            borderColor: 'var(--border-subtle)',
            borderRadius: 2,
          }}
        >
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: 'var(--sev-critical)', boxShadow: '0 0 6px color-mix(in srgb, var(--sev-critical) 60%, transparent)' }}
          />
          <span className="text-[10px] uppercase tracking-[0.15em] font-bold text-fg-muted">
            Route Not Found
          </span>
        </div>

        {/* Message */}
        <p className="text-sm text-fg-muted mb-2 leading-relaxed">
          The requested page does not exist or has been moved.
        </p>
        <p className="text-[11px] text-rmpg-500 mb-6">
          If you believe this is an error, contact your system administrator.
        </p>

        {/* Action */}
        <a
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors"
          style={{
            background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)',
            border: '1px solid var(--accent-gold-300)',
            color: 'var(--accent-gold-300)',
            borderRadius: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)';
            e.currentTarget.style.borderColor = 'var(--accent-gold-300)';
            e.currentTarget.style.opacity = '0.85';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)';
            e.currentTarget.style.borderColor = 'var(--accent-gold-300)';
            e.currentTarget.style.opacity = '1';
          }}
        >
          Return to Dashboard
        </a>
      </div>
    </div>
  );
}

/** Per-route error boundary wrapper for lazy-loaded routes */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

// <Navigate to="/foo" replace /> drops the URL search + hash. This wrapper
// preserves both so legacy paths can act as transparent redirects (used by
// /offender-registry → /nsopw so saved bookmarks with ?offender_id=… keep
// working).
function RedirectKeepQuery({ to }: { to: string }) {
  const loc = useLocation();
  return <Navigate to={`${to}${loc.search}${loc.hash}`} replace />;
}

function AppRoutes() {
  const { isAuthenticated, isLoading, user } = useAuth();

  // Warm the Dashboard chunk the moment auth flips to true. This is what makes
  // DashboardPage's lazy() free: the landing navigation resolves from the
  // module cache instead of showing "Loading module". NOT idle-deferred and
  // NOT role-gated — every authenticated role lands here, and by the time this
  // fires the login-critical work is already done.
  React.useEffect(() => {
    if (!isAuthenticated) return;
    importDashboard().catch(() => {});
  }, [isAuthenticated]);

  // Idle-prefetch the current role's most-navigated routes so the first
  // navigation is instant rather than showing the module splash over cellular.
  // Scheduled during idle so it never competes with first paint or the landing
  // Dashboard's fetches. Was a hardcoded Dispatch+Map set; it's a role table
  // now (ROLE_PREFETCH_ROUTES) so roles that never open those two stop paying
  // for the ~2.3 MB mapbox/deck.gl download. prefetchRoute owns the saveData /
  // slow-connection guard and swallows failures.
  React.useEffect(() => {
    if (!isAuthenticated || !user) return;
    const routes = ROLE_PREFETCH_ROUTES[user.role] ?? [];
    if (routes.length === 0) return;
    const w = window as any;
    const schedule: (cb: () => void) => number =
      w.requestIdleCallback || ((cb: () => void) => w.setTimeout(cb, 1500));
    const id = schedule(() => routes.forEach(prefetchRoute));
    return () => {
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else w.clearTimeout(id);
    };
  }, [isAuthenticated, user]);

  if (isLoading) {
    return <LoadingSplash message="Initializing" />;
  }

  return (
    <>
      {isAuthenticated && <GlobalSearch />}
      {isAuthenticated && <KeyboardShortcuts />}
      <Suspense fallback={<LoadingSplash message="Loading module" />}>
        <Routes>
          {/* Public routes */}
          <Route path="/downloads" element={<DownloadsPage />} />
          {/* Dev-only PDF audit harness. Gated on import.meta.env.DEV so Vite
              tree-shakes it out of the production bundle entirely — it must never
              reach Cloudflare Pages. See docs/superpowers/specs/
              2026-07-31-pdf-forms-audit-and-repair-design.md */}
          {import.meta.env.DEV && PdfGalleryPage && (
            <Route path="/__pdf-gallery" element={<PdfGalleryPage />} />
          )}
          <Route
            path="/login"
            element={isAuthenticated ? <Navigate to={window.location.hostname === 'crm.rmpgutah.us' ? '/crm' : '/'} replace /> : <LoginPage />}
          />
          {/* /forgot-password was a standalone email-based reset page, but the
              live API (/api/auth/forgot-password) expects {username} + 3
              security-question answers — the in-page panel on LoginPage is
              the working flow. Redirect so the "Request New Link" affordance
              on ResetPasswordPage doesn't dead-end on a mismatched contract. */}
          <Route path="/forgot-password" element={<Navigate to="/login?forgot=1" replace />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Landing page for src/routes/oidc.ts's dialer SSO callback */}
          <Route path="/oidc-callback" element={<OidcCallbackPage />} />
          {/* Dial Connect SSO redirect landing page — see src/routes/ssoAuth.ts */}
          <Route path="/sso-callback" element={<SsoCallbackPage />} />
          {/* QR-token-authed mobile vehicle inspection. Opened by scanning the
              per-shift QR on the ShiftCard; the :token IS the credential. */}
          <Route path="/m/shift/:token" element={<MobileShiftPage />} />
          {/* QR-token-authed mobile PSO call dispatch surface. Opened by the
              guard scanning the per-call QR; the ?token IS the credential and
              the guard picks their identity via OfficerPicker before the auth
              round-trip. Lives outside the auth gate because the QR token is
              the auth — the guard is not yet logged in. */}
          <Route path="/m/cfs/:id" element={<MobilePsoCfsPage />} />
          {/* Recipient-signed Receipt of Service + Court Document Release.
              Opened by the person being served, scanning the QR printed on
              the Call for Service report before shift initiation. The :token
              IS the credential and is burned on signature — the signer is a
              member of the public and will never have a session. */}
          <Route path="/m/serve-receipt/:token" element={<ServeReceiptPage />} />
          <Route path="/verify" element={<VerifyNoticePage />} />

          {/* Detached windows — no Layout wrapper */}
          <Route path="/detached/incident/:id" element={<ProtectedRoute><RouteErrorBoundary><IncidentDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />
          <Route path="/detached/record/:type/:id" element={<ProtectedRoute><RouteErrorBoundary><RecordDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />
          <Route path="/desktop-company-browser" element={<ProtectedRoute><CompanyBrowserRoleGuard><RouteErrorBoundary><CompanyBrowserPage /></RouteErrorBoundary></CompanyBrowserRoleGuard></ProtectedRoute>} />
          <Route path="/web-desktop-company-browser" element={<ProtectedRoute><CompanyBrowserRoleGuard><RouteErrorBoundary><WebCompanyBrowserPage /></RouteErrorBoundary></CompanyBrowserRoleGuard></ProtectedRoute>} />

          {/* Authenticated app shell. The pathless parent route hosts ONE
              app-wide NavTripProvider so vehicle trip detection + live movement
              recording runs no matter which page is open — including the
              full-screen Drive Mode HUD (/navigation), which renders OUTSIDE
              <Layout>. ProtectedRoute sits at the parent so the provider's GPS
              tracker only mounts for authenticated officers. */}
          <Route
            element={
              <ProtectedRoute>
                <NavTripProvider>
                  <Outlet />
                </NavTripProvider>
              </ProtectedRoute>
            }
          >
            {/* Full-screen in-vehicle drive HUD — intentionally OUTSIDE <Layout> so it
                renders edge-to-edge with no top toolbar/chrome (kiosk-style). The
                page's own header has a Close button back to /map. */}
            <Route path="/navigation" element={<RouteErrorBoundary><NavigationPage /></RouteErrorBoundary>} />
            <Route path="/desktop" element={<RouteErrorBoundary><DesktopPage /></RouteErrorBoundary>} />

            {/* Protected routes with Layout */}
            <Route element={<Layout />}>
            <Route path="/" element={window.location.hostname === 'crm.rmpgutah.us' ? <Navigate to="/crm" replace /> : <DashboardPage />} />
            <Route path="/dispatch" element={<RouteErrorBoundary><DispatchRoleGuard><DispatchPage /></DispatchRoleGuard></RouteErrorBoundary>} />
            <Route path="/map" element={<RouteErrorBoundary><MapPage /></RouteErrorBoundary>} />
            <Route path="/route-builder" element={<RouteErrorBoundary><RouteBuilderPage /></RouteErrorBoundary>} />
            <Route path="/geography" element={<RouteErrorBoundary><GeographyPage /></RouteErrorBoundary>} />
            <Route path="/dialer-connect" element={<RouteErrorBoundary><DialerConnectPage /></RouteErrorBoundary>} />
            <Route path="/incidents" element={<RouteErrorBoundary><IncidentsPage /></RouteErrorBoundary>} />
            <Route path="/records" element={<RouteErrorBoundary><RecordsPage /></RouteErrorBoundary>} />
            <Route path="/personnel" element={<RouteErrorBoundary><PersonnelPage /></RouteErrorBoundary>} />
            <Route path="/my-id" element={<RouteErrorBoundary><MyIdPage /></RouteErrorBoundary>} />
            <Route path="/verify-id" element={<RouteErrorBoundary><VerifyIdPage /></RouteErrorBoundary>} />
            <Route path="/communications" element={<RouteErrorBoundary><CommunicationsPage /></RouteErrorBoundary>} />
            <Route path="/radio" element={<RouteErrorBoundary><RadioPage /></RouteErrorBoundary>} />
            <Route path="/reports" element={<RouteErrorBoundary><ReportsPage /></RouteErrorBoundary>} />
            <Route path="/analytics" element={<RouteErrorBoundary><AnalyticsPage /></RouteErrorBoundary>} />
            <Route path="/patrol" element={<RouteErrorBoundary><PatrolPage /></RouteErrorBoundary>} />
            {/* /fleet serves the v1 tab-based UI permanently — the v2
                Fleet.io-style shell was retired 2026-07-17 (see
                docs/superpowers/specs/2026-07-17-fleet-v1-restoration-foundation-design.md). */}
            <Route path="/fleet/dashboard" element={<RouteErrorBoundary><FleetDashboardPage /></RouteErrorBoundary>} />
            <Route path="/fleet/reports" element={<RouteErrorBoundary><FleetReportsPage /></RouteErrorBoundary>} />
            <Route path="/fleet/*" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />
            <Route path="/body-cameras" element={<RouteErrorBoundary><BodyCamerasPage /></RouteErrorBoundary>} />
            <Route path="/dash-cameras" element={<RouteErrorBoundary><DashCamerasPage /></RouteErrorBoundary>} />
            <Route path="/flexcam" element={<RouteErrorBoundary><FlexCamPage /></RouteErrorBoundary>} />
            <Route path="/flexcam/:id" element={<RouteErrorBoundary><FlexCamFootagePage /></RouteErrorBoundary>} />
            <Route path="/flexcam/trip/:tripId" element={<RouteErrorBoundary><TripPlaybackPage /></RouteErrorBoundary>} />
            <Route path="/warrants" element={<RouteErrorBoundary><WarrantsPage /></RouteErrorBoundary>} />
            <Route path="/national-warrants" element={<RouteErrorBoundary><NationalWarrantSearchPage /></RouteErrorBoundary>} />
            <Route path="/screening" element={<Navigate to="/warrants" replace />} />
            <Route path="/citations" element={<RouteErrorBoundary><CitationsPage /></RouteErrorBoundary>} />
            <Route path="/law-book" element={<RouteErrorBoundary><LawBookPage /></RouteErrorBoundary>} />
            <Route path="/knowledge-base" element={<RouteErrorBoundary><KnowledgeBasePage /></RouteErrorBoundary>} />
            <Route path="/field-interviews" element={<RouteErrorBoundary><FieldInterviewsPage /></RouteErrorBoundary>} />
            <Route path="/trespass-orders" element={<RouteErrorBoundary><TrespassOrdersPage /></RouteErrorBoundary>} />
            <Route path="/mdt" element={<RouteErrorBoundary><MdtPage /></RouteErrorBoundary>} />
            <Route path="/mobile" element={<RouteErrorBoundary><MobileHomePage /></RouteErrorBoundary>} />
            <Route path="/field-camera" element={<RouteErrorBoundary><FieldCameraPage /></RouteErrorBoundary>} />
            <Route path="/shift-plans" element={<RouteErrorBoundary><ShiftPlansPage /></RouteErrorBoundary>} />
            <Route path="/statute-analytics" element={<RouteErrorBoundary><StatuteAnalyticsPage /></RouteErrorBoundary>} />
            <Route path="/reports/custom" element={<RouteErrorBoundary><CustomReportBuilder /></RouteErrorBoundary>} />
            <Route path="/criminal-history" element={<RouteErrorBoundary><CriminalHistoryPage /></RouteErrorBoundary>} />
            <Route path="/evidence" element={<RouteErrorBoundary><EvidencePropertyPage /></RouteErrorBoundary>} />
            <Route path="/cases" element={<RouteErrorBoundary><CaseManagementPage /></RouteErrorBoundary>} />
            <Route path="/crime-analysis" element={<RouteErrorBoundary><CrimeAnalysisPage /></RouteErrorBoundary>} />
            <Route path="/connections" element={<RouteErrorBoundary><ConnectionsPage /></RouteErrorBoundary>} />
            <Route path="/intel" element={<RouteErrorBoundary><IntelPortalLayout /></RouteErrorBoundary>}>
              {/* Each child is individually error-bounded so a single bad surface
                  fails in the center pane only — the rail + context panel survive. */}
              <Route index element={<RouteErrorBoundary><IntelDashboard /></RouteErrorBoundary>} />
              <Route path="search" element={<RouteErrorBoundary><IntelSearch /></RouteErrorBoundary>} />
              <Route path="connections" element={<RouteErrorBoundary><ConnectionsPage /></RouteErrorBoundary>} />
              <Route path="watchlist" element={<RouteErrorBoundary><WatchlistSection /></RouteErrorBoundary>} />
              <Route path="bolos" element={<RouteErrorBoundary><BoloBoard /></RouteErrorBoundary>} />
              <Route path="alerts" element={<RouteErrorBoundary><AlertsSection /></RouteErrorBoundary>} />
              <Route path="jail" element={<RouteErrorBoundary><JailRecordsPage /></RouteErrorBoundary>} />
              <Route path="plate-log" element={<RouteErrorBoundary><PlateLogPage /></RouteErrorBoundary>} />
              <Route path="alpr-history" element={<RouteErrorBoundary><AlprHistoryPage /></RouteErrorBoundary>} />
              <Route path="queues" element={<RouteErrorBoundary><ReviewQueues /></RouteErrorBoundary>} />
              <Route path="map" element={<RouteErrorBoundary><IntelMapPage /></RouteErrorBoundary>} />
              <Route path="ai" element={<RouteErrorBoundary><IntelAiAnalyst /></RouteErrorBoundary>} />
              <Route path="reports" element={<RouteErrorBoundary><IntelReportsPage /></RouteErrorBoundary>} />
              <Route path="reports/new" element={<RouteErrorBoundary><NewIntelReportPage /></RouteErrorBoundary>} />
              <Route path="reports/:id" element={<RouteErrorBoundary><IntelReportDetailPage /></RouteErrorBoundary>} />
              <Route path="sources" element={<RouteErrorBoundary><IntelSourcesPage /></RouteErrorBoundary>} />
              <Route path="quick-capture" element={<RouteErrorBoundary><QuickCapturePage /></RouteErrorBoundary>} />
              <Route path="record" element={<RouteErrorBoundary><InteractionRecorderPage /></RouteErrorBoundary>} />
              <Route path="person/:id" element={<RouteErrorBoundary><PersonDossierPage /></RouteErrorBoundary>} />
              <Route path="workbench" element={<RouteErrorBoundary><ConnectionsPage /></RouteErrorBoundary>} />
            </Route>
            <Route path="/code-enforcement" element={<RouteErrorBoundary><CodeEnforcementPage /></RouteErrorBoundary>} />
            <Route path="/court" element={<RouteErrorBoundary><CourtTrackerPage /></RouteErrorBoundary>} />
            <Route path="/dar" element={<RouteErrorBoundary><DailyActivityReportsPage /></RouteErrorBoundary>} />
            {/* Legacy offender-registry surfaces — redirect to the canonical
                /nsopw page but PRESERVE the query string so deep-links like
                /offender-registry?offender_id=42 (saved bookmarks, dossier
                cross-refs, court-package links) survive the move. Plain
                <Navigate to="/nsopw" /> drops the search part. */}
            <Route path="/offender-registry" element={<RedirectKeepQuery to="/nsopw" />} />
            <Route path="/sex-offender-registry" element={<RedirectKeepQuery to="/nsopw" />} />
            <Route path="/nsopw" element={<RouteErrorBoundary><NsopwLookupPage /></RouteErrorBoundary>} />
            <Route path="/ncic" element={<RouteErrorBoundary><NcicPage /></RouteErrorBoundary>} />
            <Route path="/dl-search" element={<RouteErrorBoundary><DlSearchPage /></RouteErrorBoundary>} />
            <Route path="/audit" element={<AdminRoute><RouteErrorBoundary><AuditLogPage /></RouteErrorBoundary></AdminRoute>} />
            <Route path="/calculator" element={<ProtectedRoute><RouteErrorBoundary><CalculatorPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/unit-converter" element={<ProtectedRoute><RouteErrorBoundary><UnitConverterPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/clipboard-manager" element={<ProtectedRoute><RouteErrorBoundary><ClipboardManagerPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/focus-timer" element={<ProtectedRoute><RouteErrorBoundary><FocusTimerPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/device-health" element={<ProtectedRoute><RouteErrorBoundary><DeviceHealthPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/print-queue" element={<ProtectedRoute><RouteErrorBoundary><PrintQueuePage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/scheduled-updates" element={<ProtectedRoute><RouteErrorBoundary><ScheduledUpdatesPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/remote-lock" element={<ProtectedRoute><RouteErrorBoundary><RemoteLockPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/tesseract-training" element={<AdminRoute><RouteErrorBoundary><TesseractTrainingPage /></RouteErrorBoundary></AdminRoute>} />
            <Route path="/training" element={<RouteErrorBoundary><TrainingPage /></RouteErrorBoundary>} />
            <Route path="/training-docs" element={<RouteErrorBoundary><TrainingDocsPage /></RouteErrorBoundary>} />
            <Route path="/forensics" element={<Navigate to="/connections" replace />} />
            <Route path="/forensic-lab" element={<RouteErrorBoundary><ForensicLabPage /></RouteErrorBoundary>} />
            <Route path="/dispatch/capture" element={<RouteErrorBoundary><DataCapturePage /></RouteErrorBoundary>} />
            <Route path="/skip-tracer" element={<RouteErrorBoundary><SkipTracerPage /></RouteErrorBoundary>} />
            <Route path="/microbilt" element={<RouteErrorBoundary><SkipTracerV2Page /></RouteErrorBoundary>} />
            <Route path="/arrest-records" element={<RouteErrorBoundary><ArrestRecordsPage /></RouteErrorBoundary>} />
            <Route path="/email" element={<RouteErrorBoundary><EmailPage /></RouteErrorBoundary>} />
            <Route path="/crm" element={<RouteErrorBoundary><CrmPage /></RouteErrorBoundary>} />
            <Route path="/serve" element={<RouteErrorBoundary><ServePage /></RouteErrorBoundary>} />
            <Route path="/serve-intake/scheduler" element={<RouteErrorBoundary><ServeSchedulerPage /></RouteErrorBoundary>} />
            <Route path="/scheduler" element={<RouteErrorBoundary><SchedulerPage /></RouteErrorBoundary>} />
            <Route path="/shift-briefings" element={<RouteErrorBoundary><ShiftBriefingsPage /></RouteErrorBoundary>} />
            <Route path="/serve-intake" element={<RouteErrorBoundary><ServeIntakePage /></RouteErrorBoundary>} />
            <Route path="/web-research" element={<RouteErrorBoundary><WebResearchPage /></RouteErrorBoundary>} />
            <Route path="/hr" element={<RouteErrorBoundary><HRPage /></RouteErrorBoundary>} />
            <Route path="/admin" element={<AdminRoute><RouteErrorBoundary><AdminPage /></RouteErrorBoundary></AdminRoute>} />
            <Route path="/dashcams" element={<RouteErrorBoundary><DashcamPage /></RouteErrorBoundary>} />
            <Route path="/use-of-force" element={<RouteErrorBoundary><UseOfForcePage /></RouteErrorBoundary>} />
            <Route path="/security-dashboard" element={<RouteErrorBoundary><SecurityDashboardPage /></RouteErrorBoundary>} />
            <Route path="/help" element={<RouteErrorBoundary><HelpPage /></RouteErrorBoundary>} />
            <Route path="/notifications" element={<RouteErrorBoundary><NotificationsPage /></RouteErrorBoundary>} />
            <Route path="/colorado-doc" element={<RouteErrorBoundary><ColoradoDocPage /></RouteErrorBoundary>} />
            <Route path="/command-center" element={<RouteErrorBoundary><CommandCenterPage /></RouteErrorBoundary>} />
            <Route path="/geo-data-viewer" element={<RouteErrorBoundary><GeoDataViewerPage /></RouteErrorBoundary>} />
            <Route path="/invoices" element={<RouteErrorBoundary><InvoicesPage /></RouteErrorBoundary>} />
            <Route path="/iped" element={<RouteErrorBoundary><IpedPage /></RouteErrorBoundary>} />
            <Route path="/national-warrant-search" element={<RouteErrorBoundary><NationalWarrantSearchPage /></RouteErrorBoundary>} />
            <Route path="/settings" element={<RouteErrorBoundary><SettingsPage /></RouteErrorBoundary>} />
            <Route path="/court-records" element={<RouteErrorBoundary><CourtRecordsPage /></RouteErrorBoundary>} />
            <Route path="/crash-reports" element={<RouteErrorBoundary><CrashReportsPage /></RouteErrorBoundary>} />
            <Route path="/impound" element={<RouteErrorBoundary><ImpoundPage /></RouteErrorBoundary>} />
            <Route path="/dash-cameras/:id" element={<RouteErrorBoundary><DashCamDetailPage /></RouteErrorBoundary>} />
            <Route path="/dashcam-ai" element={<RouteErrorBoundary><DashcamAiPage /></RouteErrorBoundary>} />
            <Route path="/document-intake" element={<RouteErrorBoundary><DocumentIntakePage /></RouteErrorBoundary>} />
            <Route path="/documents" element={<RouteErrorBoundary><DocumentsPage /></RouteErrorBoundary>} />
            <Route path="/pdf-editor" element={<RouteErrorBoundary><PdfEditorPage /></RouteErrorBoundary>} />
            <Route path="/document-writer" element={<RouteErrorBoundary><DocumentWriterPage /></RouteErrorBoundary>} />
            <Route path="/text-editor" element={<RouteErrorBoundary><TextEditorPage /></RouteErrorBoundary>} />
            <Route path="/docs" element={<RouteErrorBoundary><DocsLibraryPage /></RouteErrorBoundary>} />
            <Route path="/recon-connect" element={<RouteErrorBoundary><ReconConnectPage /></RouteErrorBoundary>} />
            <Route path="/device-scanner" element={<ProtectedRoute><RouteErrorBoundary><DeviceScannerPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/jail" element={<RouteErrorBoundary><JailPage /></RouteErrorBoundary>} />
            <Route path="/affairs" element={<RouteErrorBoundary><AffairsPage /></RouteErrorBoundary>} />
            <Route path="/assets" element={<RouteErrorBoundary><AssetsPage /></RouteErrorBoundary>} />
            <Route path="/community" element={<RouteErrorBoundary><CommunityPage /></RouteErrorBoundary>} />
            <Route path="/tasks" element={<RouteErrorBoundary><TasksPage /></RouteErrorBoundary>} />
            <Route path="/alerts" element={<RouteErrorBoundary><AlertsPage /></RouteErrorBoundary>} />
            <Route path="/training-mgmt" element={<RouteErrorBoundary><TrainingManagementPage /></RouteErrorBoundary>} />
            <Route path="/qa" element={<RouteErrorBoundary><QAPage /></RouteErrorBoundary>} />
            <Route path="/billing" element={<RouteErrorBoundary><BillingPage /></RouteErrorBoundary>} />
            <Route path="/risk" element={<RouteErrorBoundary><RiskPage /></RouteErrorBoundary>} />
            <Route path="/interagency" element={<RouteErrorBoundary><InteragencyPage /></RouteErrorBoundary>} />
            <Route path="/gang-intel" element={<RouteErrorBoundary><GangIntelPage /></RouteErrorBoundary>} />
            <Route path="/person-intel" element={<RouteErrorBoundary><PersonIntelPage /></RouteErrorBoundary>} />
            <Route path="/person-intel/:id" element={<RouteErrorBoundary><PersonIntelDossierPage /></RouteErrorBoundary>} />
            <Route path="/special-ops" element={<RouteErrorBoundary><SpecialOpsPage /></RouteErrorBoundary>} />
            <Route path="/crisis-response" element={<RouteErrorBoundary><CrisisResponsePage /></RouteErrorBoundary>} />
            <Route path="/victim-services" element={<RouteErrorBoundary><VictimServicesPage /></RouteErrorBoundary>} />
            <Route path="/alarms" element={<RouteErrorBoundary><AlarmManagementPage /></RouteErrorBoundary>} />
            <Route path="/narcotics" element={<RouteErrorBoundary><NarcoticsPage /></RouteErrorBoundary>} />
            <Route path="/nav" element={<RouteErrorBoundary><NavPage /></RouteErrorBoundary>} />
            <Route path="/accreditation" element={<RouteErrorBoundary><AccreditationPage /></RouteErrorBoundary>} />
            <Route path="/recruitment" element={<RouteErrorBoundary><RecruitmentPage /></RouteErrorBoundary>} />
            <Route path="/shift-notes" element={<RouteErrorBoundary><ShiftNotesPage /></RouteErrorBoundary>} />
            <Route path="/quick-plate" element={<RouteErrorBoundary><QuickPlateCheckPage /></RouteErrorBoundary>} />
            <Route path="/unit-status-board" element={<RouteErrorBoundary><UnitStatusBoardPage /></RouteErrorBoundary>} />
            <Route path="/offline-queue" element={<RouteErrorBoundary><OfflineQueuePage /></RouteErrorBoundary>} />
            <Route path="/broadcast" element={<RouteErrorBoundary><BroadcastMessagePage /></RouteErrorBoundary>} />
            <Route path="/screen-capture" element={<RouteErrorBoundary><ScreenCapturePage /></RouteErrorBoundary>} />
            <Route path="/system-logs" element={<AdminRoute><RouteErrorBoundary><SystemLogsPage /></RouteErrorBoundary></AdminRoute>} />
            <Route path="/live-call-map" element={<RouteErrorBoundary><LiveCallMapPage /></RouteErrorBoundary>} />
            <Route path="/digital-evidence" element={<RouteErrorBoundary><DigitalEvidencePage /></RouteErrorBoundary>} />
            {/* /navigation rendered OUTSIDE Layout above — full-screen vehicle HUD */}
            {/* 404 within layout */}
            <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>

          {/* Catch-all outside layout */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default function App() {
  // Mount the offline queue drain loop for the app lifetime.
  // Runs drainQueue on 30s interval + focus + online events.
  useOfflineQueue();

  // TWO nested boundaries by design (defense in depth):
  //  • OUTER — sits above every context provider. A render/effect throw inside
  //    AuthProvider, WebSocketProvider, UserPreferencesProvider, ToastProvider,
  //    or ContextMenuProvider propagates ABOVE the inner boundary (a boundary
  //    can only catch its descendants), so without this the whole tree unmounts
  //    to a blank white page. A long-shift WebSocket reconnect that throws was
  //    white-screening the app and forcing a reload; this converts that into the
  //    recovery card (which also auto-reports to /api/admin/health/client-error).
  //    ErrorBoundary reads the auth token straight from localStorage, so it is
  //    safe to mount above AuthProvider.
  //  • INNER — catches page/route crashes WITHOUT tearing down the providers,
  //    so the WebSocket + auth session survive a single page blowing up.
  return (
    <ErrorBoundary>
      <FeatureFlagsProvider>
        <AuthProvider>
          <WebSocketProvider>
            <UserPreferencesProvider>
              <ToastProvider>
                <ContextMenuProvider>
                  <ErrorBoundary>
                    <WebUpdateBanner />
                    <MDTBridge />
                    <AndroidUpdateChecker />
                    <ButtonHealthOverlay />
                    <Suspense fallback={null}><GlobalPdfViewer /></Suspense>
                    <AppRoutes />
                  </ErrorBoundary>
                </ContextMenuProvider>
              </ToastProvider>
            </UserPreferencesProvider>
          </WebSocketProvider>
        </AuthProvider>
      </FeatureFlagsProvider>
    </ErrorBoundary>
  );
}
