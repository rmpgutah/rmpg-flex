import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { useDispatchVoice } from './hooks/useDispatchVoice';
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
import { tryReloadForChunkFailure, normalizeChunkError } from './utils/chunkRetry';
import WebUpdateBanner from './components/WebUpdateBanner';
import ButtonHealthOverlay from './components/ButtonHealthOverlay';
import AndroidUpdateChecker from './components/AndroidUpdateChecker';
import LoginPage from './pages/LoginPage';
import DownloadsPage from './pages/DownloadsPage';
// Dashboard is the immediate post-login landing view, so it stays eager.
import DashboardPage from './pages/DashboardPage';
// Dispatch + Map are the two heaviest field screens (~6k lines each plus deep
// import trees). They're lazy-split to keep them OUT of the login/critical
// bundle — but because they're the most-navigated-to pages, they're also
// idle-prefetched right after auth (see AppRoutes below) so the first
// navigation stays instant: the chunk is already warm in the module cache.
const importDispatch = () => import('./pages/dispatch');
const importMap = () => import('./pages/map');
const DispatchPage = lazyRetry(importDispatch);
const MapPage = lazyRetry(importMap);
// Lazy import with auto-retry on chunk load failure (stale cache after deploys)
function lazyRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  // Retry the import in place before escalating to a reload. A reload only
  // helps when OUR index.html is stale; during a Pages deploy-propagation
  // window the fresh index references a chunk the CDN is still replicating
  // (server 500s) — there a reload re-fails instantly, the second failure
  // lands inside the 30s guard, and the ErrorBoundary card strands the user
  // (seen live 2026-06-10, fleet chunk 500 for ~15 min after 4 back-to-back
  // deploys). Two delayed re-imports (1.5s, 4s) ride out that window.
  const withRetry = () => factory()
    .catch(() => sleep(1500).then(factory))
    .catch(() => sleep(4000).then(factory));
  return lazy(() => withRetry().catch((err) => {
    // A lazy chunk failed to load — almost always a stale bundle after a
    // deploy: this long-lived tab requests an old hash the server no longer
    // serves. Reload ONCE per 30s to pick up the fresh index, holding the
    // Suspense fallback (spinner) while the reload navigates away — rejecting
    // immediately would flash the ErrorBoundary's red card for a frame. The
    // hold is BOUNDED (tryReloadForChunkFailure): if the reload never tears
    // this page down (offline / stale SW shell / captive portal / webview that
    // ignores reload()), it rejects after ~10s so the RouteErrorBoundary shows
    // its recovery card — never a permanent button-less splash. A second
    // failure inside the 30s window means the reload didn't help → reload
    // returns null here and we rethrow for the ErrorBoundary instead of looping.
    const held = tryReloadForChunkFailure<{ default: T }>(err);
    if (held) return held;
    throw normalizeChunkError(err);
  }));
}

// Lazy-loaded pages (less frequently accessed)
const IncidentsPage = lazyRetry(() => import('./pages/IncidentsPage'));
const RecordsPage = lazyRetry(() => import('./pages/RecordsPage'));
const PersonnelPage = lazyRetry(() => import('./pages/personnel'));
const CommunicationsPage = lazyRetry(() => import('./pages/CommunicationsPage'));
const ReportsPage = lazyRetry(() => import('./pages/ReportsPage'));
const AdminPage = lazyRetry(() => import('./pages/AdminPage'));
const MyIdPage = lazyRetry(() => import('./pages/wallet/MyIdPage'));
const VerifyIdPage = lazyRetry(() => import('./pages/wallet/VerifyIdPage'));
const AuditLogPage = lazyRetry(() => import('./pages/AuditLogPage'));
const PatrolPage = lazyRetry(() => import('./pages/PatrolPage'));
const FleetPage = lazyRetry(() => import('./pages/fleet'));
const FleetShell = lazyRetry(() => import('./pages/fleet/v2/FleetShell'));
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
const NavigationPage = lazyRetry(() => import('./pages/NavigationPage'));
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
const SkipTracerPage = lazyRetry(() => import('./pages/SkipTracerPage'));
const SkipTracerV2Page = lazyRetry(() => import('./pages/skiptracer/SkipTracerV2Page'));
const ArrestRecordsPage = lazyRetry(() => import('./pages/ArrestRecordsPage'));
const EmailPage = lazyRetry(() => import('./pages/EmailPage'));
const CrmPage = lazyRetry(() => import('./pages/CrmPage'));
const ServePage = lazyRetry(() => import('./pages/ServePage'));
const ServeIntakePage = lazyRetry(() => import('./pages/ServeIntakePage'));
const ServeSchedulerPage = lazyRetry(() => import('./pages/ServeSchedulerPage'));
const WebResearchPage = lazyRetry(() => import('./pages/WebResearchPage'));
const HRPage = lazyRetry(() => import('./pages/hr/HrPage'));
const GeographyPage = lazyRetry(() => import('./pages/GeographyPage'));
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
const ResetPasswordPage = lazyRetry(() => import('./pages/ResetPasswordPage'));
const MobileShiftPage = lazyRetry(() => import('./pages/MobileShiftPage'));


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
              background: 'linear-gradient(90deg, transparent, #a7b1bc, transparent)',
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
          <span style={{ color: '#ef4444', fontSize: 20, fontWeight: 800 }}>!</span>
        </div>
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#fca5a5] mb-1.5">Access Denied</h3>
        <p className="text-[10px] text-[#888] max-w-xs mb-4">You do not have permission to view this page.</p>
        <a href="/" className="btn-gold">Return to Dashboard</a>
      </div>
    );
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
            style={{ background: '#dc2626', boxShadow: '0 0 6px rgba(220,38,38,0.6)' }}
          />
          <span className="text-[10px] uppercase tracking-[0.15em] font-bold text-[#888888]">
            Route Not Found
          </span>
        </div>

        {/* Message */}
        <p className="text-sm text-[#888888] mb-2 leading-relaxed">
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
            border: '1px solid #d4a017',
            color: '#d4a017',
            borderRadius: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, #242424 0%, #1a1a1a 100%)';
            e.currentTarget.style.borderColor = '#e8b52a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)';
            e.currentTarget.style.borderColor = '#d4a017';
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
  const { isAuthenticated, isLoading } = useAuth();

  // Idle-prefetch the heaviest field routes once authenticated, so the first
  // navigation to Dispatch/Map is instant rather than showing the loading
  // splash while the chunk downloads over cellular. Scheduled during idle time
  // (requestIdleCallback) so it never competes with the initial paint or the
  // landing Dashboard's data fetches. import() is deduped, so this just warms
  // the module cache — React.lazy then resolves synchronously on navigation.
  React.useEffect(() => {
    if (!isAuthenticated) return;
    const w = window as any;
    const schedule: (cb: () => void) => number =
      w.requestIdleCallback || ((cb: () => void) => w.setTimeout(cb, 1500));
    // Swallow prefetch failures — a transient cellular blip here is harmless;
    // the real navigation still goes through lazyRetry (which reloads on a
    // genuine chunk-load failure). We just don't want an unhandled rejection.
    const id = schedule(() => {
      importDispatch().catch(() => {});
      importMap().catch(() => {});
    });
    return () => {
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else w.clearTimeout(id);
    };
  }, [isAuthenticated]);

  if (isLoading) {
    return <LoadingSplash message="Initializing" />;
  }

  return (
    <>
      {isAuthenticated && <DispatchVoiceMount />}
      {isAuthenticated && <GlobalSearch />}
      {isAuthenticated && <KeyboardShortcuts />}
      <Suspense fallback={<LoadingSplash message="Loading module" />}>
        <Routes>
          {/* Public routes */}
          <Route path="/downloads" element={<DownloadsPage />} />
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
          {/* QR-token-authed mobile vehicle inspection. Opened by scanning the
              per-shift QR on the ShiftCard; the :token IS the credential. */}
          <Route path="/m/shift/:token" element={<MobileShiftPage />} />
          {/* QR-token-authed mobile PSO call dispatch surface. Opened by the
              guard scanning the per-call QR; the ?token IS the credential and
              the guard picks their identity via OfficerPicker before the auth
              round-trip. Lives outside the auth gate because the QR token is
              the auth — the guard is not yet logged in. */}
          <Route path="/m/cfs/:id" element={<MobilePsoCfsPage />} />

          {/* Detached windows — no Layout wrapper */}
          <Route path="/detached/incident/:id" element={<ProtectedRoute><RouteErrorBoundary><IncidentDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />
          <Route path="/detached/record/:type/:id" element={<ProtectedRoute><RouteErrorBoundary><RecordDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />

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

            {/* Protected routes with Layout */}
            <Route element={<Layout />}>
            <Route path="/" element={window.location.hostname === 'crm.rmpgutah.us' ? <Navigate to="/crm" replace /> : <DashboardPage />} />
            <Route path="/dispatch" element={<RouteErrorBoundary><DispatchPage /></RouteErrorBoundary>} />
            <Route path="/map" element={<RouteErrorBoundary><MapPage /></RouteErrorBoundary>} />
            <Route path="/route-builder" element={<RouteErrorBoundary><RouteBuilderPage /></RouteErrorBoundary>} />
            <Route path="/geography" element={<RouteErrorBoundary><GeographyPage /></RouteErrorBoundary>} />
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
            {/* === Fleet UI cutover (PR 7'c) ===
                 /fleet now serves the v2 Fleet.io-style shell.
                 /fleet-legacy keeps the old UI mounted for ≥7 days as the
                 escape hatch — operators hit it when they need a feature
                 the new shell doesn't have yet. The legacy mount + old
                 FleetPage code are removed in PR 7'd after the second
                 7-day soak. The /fleet/v2/* parallel mount is kept for
                 one cycle as a redirect target (anyone with a bookmark
                 hitting /fleet/v2 still lands on the new UI). */}
            <Route path="/fleet/v2/*" element={<RouteErrorBoundary><FleetShell /></RouteErrorBoundary>} />
            <Route path="/fleet/*" element={<RouteErrorBoundary><FleetShell /></RouteErrorBoundary>} />
            <Route path="/fleet-legacy" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />
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
            <Route path="/training" element={<RouteErrorBoundary><TrainingPage /></RouteErrorBoundary>} />
            <Route path="/training-docs" element={<RouteErrorBoundary><TrainingDocsPage /></RouteErrorBoundary>} />
            <Route path="/forensics" element={<Navigate to="/connections" replace />} />
            <Route path="/forensic-lab" element={<RouteErrorBoundary><ForensicLabPage /></RouteErrorBoundary>} />
            <Route path="/skip-tracer" element={<RouteErrorBoundary><SkipTracerPage /></RouteErrorBoundary>} />
            <Route path="/microbilt" element={<RouteErrorBoundary><SkipTracerV2Page /></RouteErrorBoundary>} />
            <Route path="/arrest-records" element={<RouteErrorBoundary><ArrestRecordsPage /></RouteErrorBoundary>} />
            <Route path="/email" element={<RouteErrorBoundary><EmailPage /></RouteErrorBoundary>} />
            <Route path="/crm" element={<RouteErrorBoundary><CrmPage /></RouteErrorBoundary>} />
            <Route path="/serve" element={<RouteErrorBoundary><ServePage /></RouteErrorBoundary>} />
            <Route path="/serve-intake/scheduler" element={<RouteErrorBoundary><ServeSchedulerPage /></RouteErrorBoundary>} />
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
            <Route path="/dash-cameras/:id" element={<RouteErrorBoundary><DashCamDetailPage /></RouteErrorBoundary>} />
            <Route path="/dashcam-ai" element={<RouteErrorBoundary><DashcamAiPage /></RouteErrorBoundary>} />
            <Route path="/document-intake" element={<RouteErrorBoundary><DocumentIntakePage /></RouteErrorBoundary>} />
            <Route path="/documents" element={<RouteErrorBoundary><DocumentsPage /></RouteErrorBoundary>} />
            <Route path="/pdf-editor" element={<RouteErrorBoundary><PdfEditorPage /></RouteErrorBoundary>} />
            <Route path="/document-writer" element={<RouteErrorBoundary><DocumentWriterPage /></RouteErrorBoundary>} />
            <Route path="/text-editor" element={<RouteErrorBoundary><TextEditorPage /></RouteErrorBoundary>} />
            <Route path="/docs" element={<RouteErrorBoundary><DocsLibraryPage /></RouteErrorBoundary>} />
            <Route path="/recon-connect" element={<RouteErrorBoundary><ReconConnectPage /></RouteErrorBoundary>} />
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
