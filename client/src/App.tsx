import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { UserPreferencesProvider } from './context/UserPreferencesContext';
import { ToastProvider } from './components/ToastProvider';
import { GlobalSearch } from './components/GlobalSearch';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import { InstallCoachingModal } from './components/InstallCoachingModal';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import WebUpdateBanner from './components/WebUpdateBanner';
import AndroidUpdateChecker from './components/AndroidUpdateChecker';
import LoginPage from './pages/LoginPage';
import { useStandalone } from './hooks/useStandalone';
// Core pages loaded eagerly (most used)
import DashboardPage from './pages/DashboardPage';
import DispatchPage from './pages/dispatch';
const MapPage = lazyRetry(() => import('./pages/map'));
// Lazy import with auto-retry on chunk load failure (stale cache after deploys)
function lazyRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() => factory().catch(() => {
    // Force reload from server on chunk failure (once per session per module)
    return new Promise<{ default: T }>((resolve, reject) => {
      const reloaded = sessionStorage.getItem('rmpg_chunk_reload');
      if (!reloaded || Date.now() - parseInt(reloaded) > 30000) {
        sessionStorage.setItem('rmpg_chunk_reload', String(Date.now()));
        window.location.reload();
      }
      reject(new Error('Chunk load failed — page will reload'));
    });
  }));
}

// Lazy-loaded pages (less frequently accessed)
const IncidentsPage = lazyRetry(() => import('./pages/IncidentsPage'));
const RecordsPage = lazyRetry(() => import('./pages/RecordsPage'));
const PersonnelPage = lazyRetry(() => import('./pages/personnel'));
const CommunicationsPage = lazyRetry(() => import('./pages/CommunicationsPage'));
const ReportsPage = lazyRetry(() => import('./pages/ReportsPage'));
const PdfEditorPage = lazyRetry(() => import('./pages/pdf-editor'));
const HistoricalTracksPage = lazyRetry(() => import('./pages/HistoricalTracksPage'));
const AdminPage = lazyRetry(() => import('./pages/AdminPage'));
const AuditLogPage = lazyRetry(() => import('./pages/AuditLogPage'));
const PatrolPage = lazyRetry(() => import('./pages/PatrolPage'));
const FleetPage = lazyRetry(() => import('./pages/fleet'));
const WarrantsPage = lazyRetry(() => import('./pages/WarrantsPage'));
const CitationsPage = lazyRetry(() => import('./pages/CitationsPage'));
const FieldInterviewsPage = lazyRetry(() => import('./pages/FieldInterviewsPage'));
const DocumentIntakePage = lazyRetry(() => import('./pages/DocumentIntakePage'));
const TrespassOrdersPage = lazyRetry(() => import('./pages/TrespassOrdersPage'));
const RadioPage = lazyRetry(() => import('./pages/RadioPage'));
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
const DashcamAiPage = lazyRetry(() => import('./pages/DashcamAiPage'));
const AarReplayPage = lazyRetry(() => import('./pages/AarReplayPage'));
const TrainingDocsPage = lazyRetry(() => import('./pages/TrainingDocsPage'));
const TrainingPage = lazyRetry(() => import('./pages/TrainingPage'));
const ForensicsPage = lazyRetry(() => import('./pages/ForensicsPage'));
const ForensicLabPage = lazyRetry(() => import('./pages/ForensicLabPage'));
const SkipTracerPage = lazyRetry(() => import('./pages/SkipTracerPage'));
const SkipTracerV2Page = lazyRetry(() => import('./pages/skiptracer/SkipTracerV2Page'));
const ReconConnectPage = lazyRetry(() => import('./pages/ReconConnectPage'));
const WirelessAttacksPage = lazyRetry(() => import('./pages/recon-connect/WirelessAttacksPage'));
const ExploitsPage = lazyRetry(() => import('./pages/recon-connect/ExploitsPage'));
const CategoryRoute = lazyRetry(() => import('./pages/recon-connect/CategoryRoute'));
const ArrestRecordsPage = lazyRetry(() => import('./pages/ArrestRecordsPage'));
const EmailPage = lazyRetry(() => import('./pages/EmailPage'));
const CrmPage = lazyRetry(() => import('./pages/CrmPage'));
const ServePage = lazyRetry(() => import('./pages/ServePage'));
const ServeIntakePage = lazyRetry(() => import('./pages/ServeIntakePage'));
const DocumentsPage = lazyRetry(() => import('./pages/DocumentsPage'));
const WebResearchPage = lazyRetry(() => import('./pages/WebResearchPage'));
const HRPage = lazyRetry(() => import('./pages/hr/HrPage'));
const GeographyPage = lazyRetry(() => import('./pages/GeographyPage'));
const ConnectionsPage = lazyRetry(() => import('./pages/ConnectionsPage'));
const IntelBulletinsPage = lazyRetry(() => import('./pages/IntelBulletinsPage'));
const ShiftBriefingsPage = lazyRetry(() => import('./pages/ShiftBriefingsPage'));
// Spillman-inspired new modules (2026-05-10)
const PawnTrackingPage = lazyRetry(() => import('./pages/PawnTrackingPage'));
const ImpoundPage = lazyRetry(() => import('./pages/ImpoundPage'));
const AlarmTrackingPage = lazyRetry(() => import('./pages/AlarmTrackingPage'));
const AnimalControlPage = lazyRetry(() => import('./pages/AnimalControlPage'));
const ALPRPage = lazyRetry(() => import('./pages/ALPRPage'));
const JailManagementPage = lazyRetry(() => import('./pages/JailManagementPage'));
const FireRMSPage = lazyRetry(() => import('./pages/FireRMSPage'));
const CrashReportsPage = lazyRetry(() => import('./pages/CrashReportsPage'));
const TipsPage = lazyRetry(() => import('./pages/TipsPage'));
const CommunityPortalPage = lazyRetry(() => import('./pages/CommunityPortalPage'));
const AccreditationsPage = lazyRetry(() => import('./pages/AccreditationsPage'));
const UseOfForcePage = lazyRetry(() => import('./pages/UseOfForcePage'));
const SecurityDashboardPage = lazyRetry(() => import('./pages/SecurityDashboardPage'));
const HelpPage = lazyRetry(() => import('./pages/HelpPage'));
const RouteBuilderPage = lazyRetry(() => import('./pages/RouteBuilderPage'));
const IncidentDetailWindow = lazyRetry(() => import('./pages/detached/IncidentDetailWindow'));
const RecordDetailWindow = lazyRetry(() => import('./pages/detached/RecordDetailWindow'));
const MobileHomePage = lazyRetry(() => import('./pages/mobile'));
const MobilePsoCfsPage = lazyRetry(() => import('./pages/mobile/MobilePsoCfsPage'));


/**
 * Branded loading splash — matches login page design language.
 *
 * If the splash is still up after `slowThresholdMs` (default 20s), an
 * inline "Taking longer than expected" retry surface appears. This is
 * the recovery path when the initial /auth/me check or a chunk load
 * hangs without throwing — without it, the user is stuck staring at
 * the scan-line forever and has to discover Cmd+R on their own.
 */
function LoadingSplash({
  message = 'Initializing',
  // Reduced from 20s. With AUTH_FETCH_TIMEOUT_MS at 6s, the worst-case
  // splash stuck on a healthy-but-slow network is ~12s (auth + refresh).
  // Surfacing the RELOAD button at 8s gives users a recovery option as
  // soon as we're past the normal happy-path window.
  slowThresholdMs = 8_000,
}: {
  message?: string;
  slowThresholdMs?: number;
}) {
  const [showSlowRetry, setShowSlowRetry] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setShowSlowRetry(true), slowThresholdMs);
    return () => clearTimeout(timer);
  }, [slowThresholdMs]);

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

        {/* Slow-load recovery surface */}
        {showSlowRetry && (
          <div className="mt-6 flex flex-col items-center gap-2" role="status" aria-live="polite">
            <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'rgba(212, 160, 23, 0.85)' }}>
              Taking longer than expected
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-[10px] uppercase tracking-[0.18em] font-bold px-4 py-1.5 transition-colors"
              style={{
                background: '#d4a017',
                color: '#000',
                border: 0,
                borderRadius: 2,
                cursor: 'pointer',
              }}
              aria-label="Retry loading"
            >
              Retry
            </button>
          </div>
        )}
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

/** 404 Not Found page */
function NotFoundPage() {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-rmpg-300 mb-2">404</h1>
        <p className="text-sm text-rmpg-400 mb-4">Page not found</p>
        <a href="/" className="btn-primary">Return to Dashboard</a>
      </div>
    </div>
  );
}

/** Redirects installed-PWA phone users landing on `/` to `/mobile`. */
function HomeRedirect({ children }: { children: React.ReactNode }) {
  const { isStandalone, isMobileViewport } = useStandalone();
  if (isStandalone && isMobileViewport) return <Navigate to="/mobile" replace />;
  return <>{children}</>;
}

/** Per-route error boundary wrapper for lazy-loaded routes */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSplash message="Initializing" />;
  }

  return (
    <>
      {isAuthenticated && <GlobalSearch />}
      {isAuthenticated && <KeyboardShortcuts />}
      {isAuthenticated && <InstallCoachingModal />}
      <Suspense fallback={<LoadingSplash message="Loading module" />}>
        <Routes>
          {/* Public */}
          <Route
            path="/login"
            element={isAuthenticated ? <Navigate to={window.location.hostname === 'crm.rmpgutah.us' ? '/crm' : '/'} replace /> : <LoginPage />}
          />

          {/* Detached windows — no Layout wrapper */}
          <Route path="/detached/incident/:id" element={<ProtectedRoute><RouteErrorBoundary><IncidentDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />
          <Route path="/detached/record/:type/:id" element={<ProtectedRoute><RouteErrorBoundary><RecordDetailWindow /></RouteErrorBoundary></ProtectedRoute>} />
          <Route path="/mobile" element={<ProtectedRoute><RouteErrorBoundary><MobileHomePage /></RouteErrorBoundary></ProtectedRoute>} />
          {/* QR-scoped PSO mobile page — own auth flow, no ProtectedRoute wrapper */}
          <Route path="/m/cfs/:id" element={<RouteErrorBoundary><MobilePsoCfsPage /></RouteErrorBoundary>} />

          {/* Protected routes with Layout */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<HomeRedirect>{window.location.hostname === 'crm.rmpgutah.us' ? <Navigate to="/crm" replace /> : <DashboardPage />}</HomeRedirect>} />
            <Route path="/dispatch" element={<DispatchPage />} />
            <Route path="/map" element={<RouteErrorBoundary><MapPage /></RouteErrorBoundary>} />
            <Route path="/route-builder" element={<RouteErrorBoundary><RouteBuilderPage /></RouteErrorBoundary>} />
            <Route path="/geography" element={<RouteErrorBoundary><GeographyPage /></RouteErrorBoundary>} />
            <Route path="/incidents" element={<RouteErrorBoundary><IncidentsPage /></RouteErrorBoundary>} />
            <Route path="/records" element={<RouteErrorBoundary><RecordsPage /></RouteErrorBoundary>} />
            <Route path="/personnel" element={<RouteErrorBoundary><PersonnelPage /></RouteErrorBoundary>} />
            <Route path="/communications" element={<RouteErrorBoundary><CommunicationsPage /></RouteErrorBoundary>} />
            <Route path="/radio" element={<RouteErrorBoundary><RadioPage /></RouteErrorBoundary>} />
            <Route path="/reports" element={<RouteErrorBoundary><ReportsPage /></RouteErrorBoundary>} />
            <Route path="/pdf-editor" element={<RouteErrorBoundary><PdfEditorPage /></RouteErrorBoundary>} />
            <Route path="/historical-tracks" element={<RouteErrorBoundary><HistoricalTracksPage /></RouteErrorBoundary>} />
            <Route path="/patrol" element={<RouteErrorBoundary><PatrolPage /></RouteErrorBoundary>} />
            <Route path="/fleet" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />
            <Route path="/body-cameras" element={<RouteErrorBoundary><BodyCamerasPage /></RouteErrorBoundary>} />
            <Route path="/dash-cameras" element={<RouteErrorBoundary><DashCamerasPage /></RouteErrorBoundary>} />
            <Route path="/dashcam-ai" element={<RouteErrorBoundary><DashcamAiPage /></RouteErrorBoundary>} />
            <Route path="/dashcam-ai/:id" element={<RouteErrorBoundary><AarReplayPage /></RouteErrorBoundary>} />
            <Route path="/warrants" element={<RouteErrorBoundary><WarrantsPage /></RouteErrorBoundary>} />
            <Route path="/citations" element={<RouteErrorBoundary><CitationsPage /></RouteErrorBoundary>} />
            <Route path="/field-interviews" element={<RouteErrorBoundary><FieldInterviewsPage /></RouteErrorBoundary>} />
            <Route path="/document-intake" element={<RouteErrorBoundary><DocumentIntakePage /></RouteErrorBoundary>} />
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
            <Route path="/intel-bulletins" element={<RouteErrorBoundary><IntelBulletinsPage /></RouteErrorBoundary>} />
            <Route path="/shift-briefings" element={<RouteErrorBoundary><ShiftBriefingsPage /></RouteErrorBoundary>} />
            <Route path="/code-enforcement" element={<RouteErrorBoundary><CodeEnforcementPage /></RouteErrorBoundary>} />
            <Route path="/court" element={<RouteErrorBoundary><CourtTrackerPage /></RouteErrorBoundary>} />
            <Route path="/dar" element={<RouteErrorBoundary><DailyActivityReportsPage /></RouteErrorBoundary>} />
            <Route path="/offender-registry" element={<RouteErrorBoundary><OffenderRegistryPage /></RouteErrorBoundary>} />
            <Route path="/sex-offender-registry" element={<RouteErrorBoundary><SexOffenderRegistryPage /></RouteErrorBoundary>} />
            <Route path="/ncic" element={<RouteErrorBoundary><NcicPage /></RouteErrorBoundary>} />
            <Route path="/dl-search" element={<RouteErrorBoundary><DlSearchPage /></RouteErrorBoundary>} />
            <Route path="/audit" element={<RouteErrorBoundary><AuditLogPage /></RouteErrorBoundary>} />
            <Route path="/training" element={<RouteErrorBoundary><TrainingPage /></RouteErrorBoundary>} />
            <Route path="/training-docs" element={<RouteErrorBoundary><TrainingDocsPage /></RouteErrorBoundary>} />
            <Route path="/forensics" element={<RouteErrorBoundary><ForensicsPage /></RouteErrorBoundary>} />
            <Route path="/forensic-lab" element={<RouteErrorBoundary><ForensicLabPage /></RouteErrorBoundary>} />
            <Route path="/skip-tracer" element={<RouteErrorBoundary><SkipTracerPage /></RouteErrorBoundary>} />
            <Route path="/microbilt" element={<RouteErrorBoundary><SkipTracerV2Page /></RouteErrorBoundary>} />
            <Route path="/recon-connect" element={<RouteErrorBoundary><ReconConnectPage /></RouteErrorBoundary>} />
            <Route path="/recon-connect/wireless" element={<RouteErrorBoundary><WirelessAttacksPage /></RouteErrorBoundary>} />
            <Route path="/recon-connect/exploits" element={<RouteErrorBoundary><ExploitsPage /></RouteErrorBoundary>} />
            <Route path="/recon-connect/c/:slug" element={<RouteErrorBoundary><CategoryRoute /></RouteErrorBoundary>} />
            <Route path="/arrest-records" element={<RouteErrorBoundary><ArrestRecordsPage /></RouteErrorBoundary>} />
            <Route path="/email" element={<RouteErrorBoundary><EmailPage /></RouteErrorBoundary>} />
            <Route path="/crm" element={<RouteErrorBoundary><CrmPage /></RouteErrorBoundary>} />
            <Route path="/serve" element={<RouteErrorBoundary><ServePage /></RouteErrorBoundary>} />
            <Route path="/serve-intake" element={<RouteErrorBoundary><ServeIntakePage /></RouteErrorBoundary>} />
            <Route path="/documents" element={<RouteErrorBoundary><DocumentsPage /></RouteErrorBoundary>} />
            <Route path="/web-research" element={<RouteErrorBoundary><WebResearchPage /></RouteErrorBoundary>} />
            <Route path="/hr" element={<RouteErrorBoundary><HRPage /></RouteErrorBoundary>} />
            {/* Spillman-inspired new modules */}
            <Route path="/pawn-tracking" element={<RouteErrorBoundary><PawnTrackingPage /></RouteErrorBoundary>} />
            <Route path="/impound" element={<RouteErrorBoundary><ImpoundPage /></RouteErrorBoundary>} />
            <Route path="/alarm-tracking" element={<RouteErrorBoundary><AlarmTrackingPage /></RouteErrorBoundary>} />
            <Route path="/animal-control" element={<RouteErrorBoundary><AnimalControlPage /></RouteErrorBoundary>} />
            <Route path="/alpr" element={<RouteErrorBoundary><ALPRPage /></RouteErrorBoundary>} />
            <Route path="/jail" element={<RouteErrorBoundary><JailManagementPage /></RouteErrorBoundary>} />
            <Route path="/fire-rms" element={<RouteErrorBoundary><FireRMSPage /></RouteErrorBoundary>} />
            <Route path="/crash-reports" element={<RouteErrorBoundary><CrashReportsPage /></RouteErrorBoundary>} />
            <Route path="/tips" element={<RouteErrorBoundary><TipsPage /></RouteErrorBoundary>} />
            <Route path="/community-reports" element={<RouteErrorBoundary><CommunityPortalPage /></RouteErrorBoundary>} />
            <Route path="/accreditations" element={<RouteErrorBoundary><AccreditationsPage /></RouteErrorBoundary>} />
            <Route path="/use-of-force" element={<RouteErrorBoundary><UseOfForcePage /></RouteErrorBoundary>} />
            <Route path="/security-dashboard" element={<RouteErrorBoundary><SecurityDashboardPage /></RouteErrorBoundary>} />
            <Route path="/help" element={<RouteErrorBoundary><HelpPage /></RouteErrorBoundary>} />
            <Route path="/admin" element={<RouteErrorBoundary><AdminPage /></RouteErrorBoundary>} />
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
            <ErrorBoundary>
              <WebUpdateBanner />
              <AndroidUpdateChecker />
              <AppRoutes />
            </ErrorBoundary>
          </ToastProvider>
        </UserPreferencesProvider>
      </WebSocketProvider>
    </AuthProvider>
  );
}
