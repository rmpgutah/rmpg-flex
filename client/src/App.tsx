import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { UserPreferencesProvider } from './context/UserPreferencesContext';
import { ToastProvider } from './components/ToastProvider';
import { GlobalSearch } from './components/GlobalSearch';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import WebUpdateBanner from './components/WebUpdateBanner';
import AndroidUpdateChecker from './components/AndroidUpdateChecker';
import LoginPage from './pages/LoginPage';
// Core pages loaded eagerly (most used)
import DashboardPage from './pages/DashboardPage';
import DispatchPage from './pages/dispatch';
import MapPage from './pages/map';
// Lazy-loaded pages (less frequently accessed)
const IncidentsPage = lazy(() => import('./pages/IncidentsPage'));
const RecordsPage = lazy(() => import('./pages/RecordsPage'));
const PersonnelPage = lazy(() => import('./pages/personnel'));
const CommunicationsPage = lazy(() => import('./pages/CommunicationsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const PatrolPage = lazy(() => import('./pages/PatrolPage'));
const FleetPage = lazy(() => import('./pages/fleet'));
const WarrantsPage = lazy(() => import('./pages/WarrantsPage'));
const CitationsPage = lazy(() => import('./pages/CitationsPage'));
const FieldInterviewsPage = lazy(() => import('./pages/FieldInterviewsPage'));
const TrespassOrdersPage = lazy(() => import('./pages/TrespassOrdersPage'));
const RadioPage = lazy(() => import('./pages/RadioPage'));
const MdtPage = lazy(() => import('./pages/MdtPage'));
const ShiftPlansPage = lazy(() => import('./pages/ShiftPlansPage'));
const StatuteAnalyticsPage = lazy(() => import('./pages/StatuteAnalyticsPage'));
const CustomReportBuilder = lazy(() => import('./pages/CustomReportBuilder'));
const CriminalHistoryPage = lazy(() => import('./pages/CriminalHistoryPage'));
const EvidencePropertyPage = lazy(() => import('./pages/EvidencePropertyPage'));
const CaseManagementPage = lazy(() => import('./pages/CaseManagementPage'));
const CrimeAnalysisPage = lazy(() => import('./pages/CrimeAnalysisPage'));
const CodeEnforcementPage = lazy(() => import('./pages/CodeEnforcementPage'));
const CourtTrackerPage = lazy(() => import('./pages/CourtTrackerPage'));
const DailyActivityReportsPage = lazy(() => import('./pages/DailyActivityReportsPage'));
const OffenderRegistryPage = lazy(() => import('./pages/OffenderRegistryPage'));
const SexOffenderRegistryPage = lazy(() => import('./pages/SexOffenderRegistryPage'));
const NcicPage = lazy(() => import('./pages/NcicPage'));
const DlSearchPage = lazy(() => import('./pages/DlSearchPage'));
const BodyCamerasPage = lazy(() => import('./pages/BodyCamerasPage'));
const DashCamerasPage = lazy(() => import('./pages/DashCamerasPage'));
const TrainingDocsPage = lazy(() => import('./pages/TrainingDocsPage'));
const TrainingPage = lazy(() => import('./pages/TrainingPage'));
const ForensicsPage = lazy(() => import('./pages/ForensicsPage'));
const ForensicLabPage = lazy(() => import('./pages/ForensicLabPage'));
const SkipTracerPage = lazy(() => import('./pages/SkipTracerPage'));
const ArrestRecordsPage = lazy(() => import('./pages/ArrestRecordsPage'));
const EmailPage = lazy(() => import('./pages/EmailPage'));
const CrmPage = lazy(() => import('./pages/CrmPage'));
const ServePage = lazy(() => import('./pages/ServePage'));
const WebResearchPage = lazy(() => import('./pages/WebResearchPage'));
const HRPage = lazy(() => import('./pages/hr/HrPage'));
const IncidentDetailWindow = lazy(() => import('./pages/detached/IncidentDetailWindow'));
const RecordDetailWindow = lazy(() => import('./pages/detached/RecordDetailWindow'));


/** Branded loading splash — matches login page design language */
function LoadingSplash({ message = 'Initializing' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-screen bg-surface-base">
      <div className="flex flex-col items-center">
        {/* Logo with blue glow — same treatment as login page */}
        <img
          src="/rmpg flex.png"
          alt="RMPG Flex"
          className="drop-shadow-[0_0_20px_rgba(26,90,158,0.3)]"
          style={{ height: 88, width: 88, objectFit: 'contain' }}
          draggable={false}
        />

        {/* Animated scanning line beneath logo */}
        <div
          className="mt-4 mb-3 overflow-hidden"
          style={{ width: 140, height: 2, background: '#141e2b', borderRadius: 1 }}
        >
          <div
            className="h-full"
            style={{
              width: 48,
              background: 'linear-gradient(90deg, transparent, #1a5a9e, transparent)',
              animation: 'scanLine 1.6s ease-in-out infinite',
            }}
          />
        </div>

        {/* Status text */}
        <p
          className="text-[9px] uppercase tracking-[0.2em] font-bold"
          style={{ color: 'rgba(138,154,170,0.7)' }}
        >
          {message}
        </p>

        {/* Subtle system label */}
        <div className="flex items-center gap-2 mt-3">
          <div className="h-px w-10" style={{ background: 'linear-gradient(90deg, transparent, #1e3048)' }} />
          <span
            className="text-[7px] tracking-[0.15em] uppercase font-bold"
            style={{ color: 'rgba(26,90,158,0.4)' }}
          >
            CAD / RMS
          </span>
          <div className="h-px w-10" style={{ background: 'linear-gradient(90deg, #1e3048, transparent)' }} />
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

          {/* Protected routes with Layout */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={window.location.hostname === 'crm.rmpgutah.us' ? <Navigate to="/crm" replace /> : <DashboardPage />} />
            <Route path="/dispatch" element={<DispatchPage />} />
            <Route path="/map" element={<MapPage />} />
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
            <Route path="/arrest-records" element={<RouteErrorBoundary><ArrestRecordsPage /></RouteErrorBoundary>} />
            <Route path="/email" element={<RouteErrorBoundary><EmailPage /></RouteErrorBoundary>} />
            <Route path="/crm" element={<RouteErrorBoundary><CrmPage /></RouteErrorBoundary>} />
            <Route path="/serve" element={<RouteErrorBoundary><ServePage /></RouteErrorBoundary>} />
            <Route path="/web-research" element={<RouteErrorBoundary><WebResearchPage /></RouteErrorBoundary>} />
            <Route path="/hr" element={<RouteErrorBoundary><HRPage /></RouteErrorBoundary>} />
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
