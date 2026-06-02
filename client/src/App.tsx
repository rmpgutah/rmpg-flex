import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { UserPreferencesProvider } from './context/UserPreferencesContext';
import { ToastProvider } from './components/ToastProvider';
import { ContextMenuProvider } from './context/ContextMenuContext';
import { GlobalSearch } from './components/GlobalSearch';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import WebUpdateBanner from './components/WebUpdateBanner';
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
  return lazy(() => factory().catch((err) => {
    // A lazy chunk failed to load — almost always a stale bundle after a
    // deploy: this long-lived tab requests an old hash the server no longer
    // serves. Reload ONCE per 30s to pick up the fresh index. On that first
    // failure return a promise that NEVER settles, so React keeps rendering
    // the Suspense fallback (spinner) while the reload navigates away —
    // rejecting here instead would flash the ErrorBoundary's red error card
    // for a frame (the exact "[ErrorBoundary] Chunk load failed — page will
    // reload" noise seen in prod). If a second failure lands inside the 30s
    // window the reload didn't help, so rethrow and let the ErrorBoundary show
    // its recovery UI rather than reload-loop forever.
    const KEY = 'rmpg_chunk_reload';
    const last = sessionStorage.getItem(KEY);
    const now = Date.now();
    if (!last || now - parseInt(last) > 30000) {
      sessionStorage.setItem(KEY, String(now));
      window.location.reload();
      return new Promise<{ default: T }>(() => { /* stay pending; reload in flight */ });
    }
    throw err instanceof Error ? err : new Error('Chunk load failed');
  }));
}

// Lazy-loaded pages (less frequently accessed)
const IncidentsPage = lazyRetry(() => import('./pages/IncidentsPage'));
const RecordsPage = lazyRetry(() => import('./pages/RecordsPage'));
const PersonnelPage = lazyRetry(() => import('./pages/personnel'));
const CommunicationsPage = lazyRetry(() => import('./pages/CommunicationsPage'));
const ReportsPage = lazyRetry(() => import('./pages/ReportsPage'));
const AdminPage = lazyRetry(() => import('./pages/AdminPage'));
const AuditLogPage = lazyRetry(() => import('./pages/AuditLogPage'));
const PatrolPage = lazyRetry(() => import('./pages/PatrolPage'));
const FleetPage = lazyRetry(() => import('./pages/fleet'));
const WarrantsPage = lazyRetry(() => import('./pages/WarrantsPage'));
const CitationsPage = lazyRetry(() => import('./pages/CitationsPage'));
const FieldInterviewsPage = lazyRetry(() => import('./pages/FieldInterviewsPage'));
const TrespassOrdersPage = lazyRetry(() => import('./pages/TrespassOrdersPage'));
const MdtPage = lazyRetry(() => import('./pages/MdtPage'));
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
const OffenderRegistryPage = lazyRetry(() => import('./pages/OffenderRegistryPage'));
const SexOffenderRegistryPage = lazyRetry(() => import('./pages/SexOffenderRegistryPage'));
const NcicPage = lazyRetry(() => import('./pages/NcicPage'));
const DlSearchPage = lazyRetry(() => import('./pages/DlSearchPage'));
const BodyCamerasPage = lazyRetry(() => import('./pages/BodyCamerasPage'));
const DashCamerasPage = lazyRetry(() => import('./pages/DashCamerasPage'));
const TrainingDocsPage = lazyRetry(() => import('./pages/TrainingDocsPage'));
const TrainingPage = lazyRetry(() => import('./pages/TrainingPage'));
const ForensicsPage = lazyRetry(() => import('./pages/ForensicsPage'));
const ForensicLabPage = lazyRetry(() => import('./pages/ForensicLabPage'));
const SkipTracerPage = lazyRetry(() => import('./pages/SkipTracerPage'));
const SkipTracerV2Page = lazyRetry(() => import('./pages/skiptracer/SkipTracerV2Page'));
const ArrestRecordsPage = lazyRetry(() => import('./pages/ArrestRecordsPage'));
const EmailPage = lazyRetry(() => import('./pages/EmailPage'));
const CrmPage = lazyRetry(() => import('./pages/CrmPage'));
const ServePage = lazyRetry(() => import('./pages/ServePage'));
const ServeIntakePage = lazyRetry(() => import('./pages/ServeIntakePage'));
const WebResearchPage = lazyRetry(() => import('./pages/WebResearchPage'));
const HRPage = lazyRetry(() => import('./pages/hr/HrPage'));
const GeographyPage = lazyRetry(() => import('./pages/GeographyPage'));
const ConnectionsPage = lazyRetry(() => import('./pages/ConnectionsPage'));
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
const SpecialOpsPage = lazyRetry(() => import('./pages/SpecialOpsPage'));
const CrisisResponsePage = lazyRetry(() => import('./pages/CrisisResponsePage'));
const VictimServicesPage = lazyRetry(() => import('./pages/VictimServicesPage'));
const AlarmManagementPage = lazyRetry(() => import('./pages/AlarmManagementPage'));
const NarcoticsPage = lazyRetry(() => import('./pages/NarcoticsPage'));
const AccreditationPage = lazyRetry(() => import('./pages/AccreditationPage'));
const RecruitmentPage = lazyRetry(() => import('./pages/RecruitmentPage'));
const IncidentDetailWindow = lazyRetry(() => import('./pages/detached/IncidentDetailWindow'));
const RecordDetailWindow = lazyRetry(() => import('./pages/detached/RecordDetailWindow'));
const CourtRecordsPage = lazyRetry(() => import('./pages/CourtRecordsPage'));
const DashCamDetailPage = lazyRetry(() => import('./pages/DashCamDetailPage'));
const DashcamAiPage = lazyRetry(() => import('./pages/DashcamAiPage'));
const DocumentIntakePage = lazyRetry(() => import('./pages/DocumentIntakePage'));
const DocumentsPage = lazyRetry(() => import('./pages/DocumentsPage'));
const ForgotPasswordPage = lazyRetry(() => import('./pages/ForgotPasswordPage'));
const ReconConnectPage = lazyRetry(() => import('./pages/ReconConnectPage'));
const ResetPasswordPage = lazyRetry(() => import('./pages/ResetPasswordPage'));


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
          style={{ width: 140, height: 2, background: '#0a0a0a', borderRadius: 1 }}
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
          <div className="h-px w-10" style={{ background: 'linear-gradient(90deg, transparent, #2b2b2b)' }} />
          <span
            className="text-[7px] tracking-[0.15em] uppercase font-bold"
            style={{ color: 'rgba(167, 177, 188, 0.42)' }}
          >
            CAD / RMS
          </span>
          <div className="h-px w-10" style={{ background: 'linear-gradient(90deg, #2b2b2b, transparent)' }} />
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

  if (isLoading) {
    return <LoadingSplash message="Loading RMPG Flex" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
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
    <div className="flex items-center justify-center h-full p-8" style={{ background: '#0a0a0a' }}>
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
            style={{ color: '#1a1a1a', textShadow: '0 0 40px rgba(212,160,23,0.15)' }}
          >
            404
          </span>
        </div>

        {/* Status bar — mimics CAD console */}
        <div
          className="inline-flex items-center gap-2 px-4 py-2 mb-6 border"
          style={{
            background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
            borderColor: '#222222',
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
        <p className="text-[11px] text-[#555555] mb-6">
          If you believe this is an error, contact your system administrator.
        </p>

        {/* Action */}
        <a
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors"
          style={{
            background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
            border: '1px solid #d4a017',
            color: '#d4a017',
            borderRadius: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, #242424 0%, #1a1a1a 100%)';
            e.currentTarget.style.borderColor = '#e8b52a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)';
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
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Detached windows — no Layout wrapper */}
          <Route path="/detached/incident/:id" element={<ProtectedRoute><RouteErrorBoundary><IncidentDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />
          <Route path="/detached/record/:type/:id" element={<ProtectedRoute><RouteErrorBoundary><RecordDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />

          {/* Protected routes with Layout */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={window.location.hostname === 'crm.rmpgutah.us' ? <Navigate to="/crm" replace /> : <DashboardPage />} />
            <Route path="/dispatch" element={<RouteErrorBoundary><DispatchPage /></RouteErrorBoundary>} />
            <Route path="/map" element={<RouteErrorBoundary><MapPage /></RouteErrorBoundary>} />
            <Route path="/geography" element={<RouteErrorBoundary><GeographyPage /></RouteErrorBoundary>} />
            <Route path="/incidents" element={<RouteErrorBoundary><IncidentsPage /></RouteErrorBoundary>} />
            <Route path="/records" element={<RouteErrorBoundary><RecordsPage /></RouteErrorBoundary>} />
            <Route path="/personnel" element={<RouteErrorBoundary><PersonnelPage /></RouteErrorBoundary>} />
            <Route path="/communications" element={<RouteErrorBoundary><CommunicationsPage /></RouteErrorBoundary>} />
            <Route path="/radio" element={<RouteErrorBoundary><RadioPage /></RouteErrorBoundary>} />
            <Route path="/reports" element={<RouteErrorBoundary><ReportsPage /></RouteErrorBoundary>} />
            <Route path="/patrol" element={<RouteErrorBoundary><PatrolPage /></RouteErrorBoundary>} />
            <Route path="/fleet" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />
            <Route path="/body-cameras" element={<RouteErrorBoundary><BodyCamerasPage /></RouteErrorBoundary>} />
            <Route path="/dash-cameras" element={<RouteErrorBoundary><DashCamerasPage /></RouteErrorBoundary>} />
            <Route path="/warrants" element={<RouteErrorBoundary><WarrantsPage /></RouteErrorBoundary>} />
            <Route path="/citations" element={<RouteErrorBoundary><CitationsPage /></RouteErrorBoundary>} />
            <Route path="/field-interviews" element={<RouteErrorBoundary><FieldInterviewsPage /></RouteErrorBoundary>} />
            <Route path="/trespass-orders" element={<RouteErrorBoundary><TrespassOrdersPage /></RouteErrorBoundary>} />
            <Route path="/mdt" element={<RouteErrorBoundary><MdtPage /></RouteErrorBoundary>} />
            <Route path="/shift-plans" element={<RouteErrorBoundary><ShiftPlansPage /></RouteErrorBoundary>} />
            <Route path="/statute-analytics" element={<RouteErrorBoundary><StatuteAnalyticsPage /></RouteErrorBoundary>} />
            <Route path="/reports/custom" element={<RouteErrorBoundary><CustomReportBuilder /></RouteErrorBoundary>} />
            <Route path="/criminal-history" element={<RouteErrorBoundary><CriminalHistoryPage /></RouteErrorBoundary>} />
            <Route path="/evidence" element={<RouteErrorBoundary><EvidencePropertyPage /></RouteErrorBoundary>} />
            <Route path="/cases" element={<RouteErrorBoundary><CaseManagementPage /></RouteErrorBoundary>} />
            <Route path="/crime-analysis" element={<RouteErrorBoundary><CrimeAnalysisPage /></RouteErrorBoundary>} />
            <Route path="/connections" element={<RouteErrorBoundary><ConnectionsPage /></RouteErrorBoundary>} />
            <Route path="/code-enforcement" element={<RouteErrorBoundary><CodeEnforcementPage /></RouteErrorBoundary>} />
            <Route path="/court" element={<RouteErrorBoundary><CourtTrackerPage /></RouteErrorBoundary>} />
            <Route path="/dar" element={<RouteErrorBoundary><DailyActivityReportsPage /></RouteErrorBoundary>} />
            <Route path="/offender-registry" element={<RouteErrorBoundary><OffenderRegistryPage /></RouteErrorBoundary>} />
            <Route path="/sex-offender-registry" element={<RouteErrorBoundary><SexOffenderRegistryPage /></RouteErrorBoundary>} />
            <Route path="/ncic" element={<RouteErrorBoundary><NcicPage /></RouteErrorBoundary>} />
            <Route path="/dl-search" element={<RouteErrorBoundary><DlSearchPage /></RouteErrorBoundary>} />
            <Route path="/audit" element={<AdminRoute><RouteErrorBoundary><AuditLogPage /></RouteErrorBoundary></AdminRoute>} />
            <Route path="/training" element={<RouteErrorBoundary><TrainingPage /></RouteErrorBoundary>} />
            <Route path="/training-docs" element={<RouteErrorBoundary><TrainingDocsPage /></RouteErrorBoundary>} />
            <Route path="/forensics" element={<RouteErrorBoundary><ForensicsPage /></RouteErrorBoundary>} />
            <Route path="/forensic-lab" element={<RouteErrorBoundary><ForensicLabPage /></RouteErrorBoundary>} />
            <Route path="/skip-tracer" element={<RouteErrorBoundary><SkipTracerPage /></RouteErrorBoundary>} />
            <Route path="/microbilt" element={<RouteErrorBoundary><SkipTracerV2Page /></RouteErrorBoundary>} />
            <Route path="/arrest-records" element={<RouteErrorBoundary><ArrestRecordsPage /></RouteErrorBoundary>} />
            <Route path="/email" element={<RouteErrorBoundary><EmailPage /></RouteErrorBoundary>} />
            <Route path="/crm" element={<RouteErrorBoundary><CrmPage /></RouteErrorBoundary>} />
            <Route path="/serve" element={<RouteErrorBoundary><ServePage /></RouteErrorBoundary>} />
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
            <Route path="/special-ops" element={<RouteErrorBoundary><SpecialOpsPage /></RouteErrorBoundary>} />
            <Route path="/crisis-response" element={<RouteErrorBoundary><CrisisResponsePage /></RouteErrorBoundary>} />
            <Route path="/victim-services" element={<RouteErrorBoundary><VictimServicesPage /></RouteErrorBoundary>} />
            <Route path="/alarms" element={<RouteErrorBoundary><AlarmManagementPage /></RouteErrorBoundary>} />
            <Route path="/narcotics" element={<RouteErrorBoundary><NarcoticsPage /></RouteErrorBoundary>} />
            <Route path="/accreditation" element={<RouteErrorBoundary><AccreditationPage /></RouteErrorBoundary>} />
            <Route path="/recruitment" element={<RouteErrorBoundary><RecruitmentPage /></RouteErrorBoundary>} />
            {/* 404 within layout */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>

          {/* Catch-all outside layout */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WebSocketProvider>
        <UserPreferencesProvider>
          <ToastProvider>
            <ContextMenuProvider>
              <ErrorBoundary>
                <WebUpdateBanner />
                <AndroidUpdateChecker />
                <AppRoutes />
              </ErrorBoundary>
            </ContextMenuProvider>
          </ToastProvider>
        </UserPreferencesProvider>
      </WebSocketProvider>
    </AuthProvider>
  );
}
