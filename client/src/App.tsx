import React from 'react';
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
import DashboardPage from './pages/DashboardPage';
import DispatchPage from './pages/dispatch';
import MapPage from './pages/map';
import IncidentsPage from './pages/IncidentsPage';
import RecordsPage from './pages/RecordsPage';
import PersonnelPage from './pages/personnel';
import CommunicationsPage from './pages/CommunicationsPage';
import ReportsPage from './pages/ReportsPage';
import AdminPage from './pages/AdminPage';
import AuditLogPage from './pages/AuditLogPage';
import PatrolPage from './pages/PatrolPage';
import FleetPage from './pages/fleet';
import WarrantsPage from './pages/WarrantsPage';
import CitationsPage from './pages/CitationsPage';
import FieldInterviewsPage from './pages/FieldInterviewsPage';
import TrespassOrdersPage from './pages/TrespassOrdersPage';
import RadioPage from './pages/RadioPage';
import MdtPage from './pages/MdtPage';
import ShiftPlansPage from './pages/ShiftPlansPage';
import StatuteAnalyticsPage from './pages/StatuteAnalyticsPage';
import CustomReportBuilder from './pages/CustomReportBuilder';
import CriminalHistoryPage from './pages/CriminalHistoryPage';
import EvidencePropertyPage from './pages/EvidencePropertyPage';
import CaseManagementPage from './pages/CaseManagementPage';
import CrimeAnalysisPage from './pages/CrimeAnalysisPage';
import CodeEnforcementPage from './pages/CodeEnforcementPage';
import CourtTrackerPage from './pages/CourtTrackerPage';
import DailyActivityReportsPage from './pages/DailyActivityReportsPage';
import OffenderRegistryPage from './pages/OffenderRegistryPage';
import SexOffenderRegistryPage from './pages/SexOffenderRegistryPage';
import NcicPage from './pages/NcicPage';
import DlSearchPage from './pages/DlSearchPage';
import BodyCamerasPage from './pages/BodyCamerasPage';
import DashCamerasPage from './pages/DashCamerasPage';
import TrainingDocsPage from './pages/TrainingDocsPage';
import TrainingPage from './pages/TrainingPage';
import ForensicsPage from './pages/ForensicsPage';
import SkipTracerPage from './pages/SkipTracerPage';
import ArrestRecordsPage from './pages/ArrestRecordsPage';
import EmailPage from './pages/EmailPage';
import CrmPage from './pages/CrmPage';
import ServePage from './pages/ServePage';
import IncidentDetailWindow from './pages/detached/IncidentDetailWindow';
import RecordDetailWindow from './pages/detached/RecordDetailWindow';


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

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSplash message="Initializing" />;
  }

  return (
    <>
      {isAuthenticated && <GlobalSearch />}
      {isAuthenticated && <KeyboardShortcuts />}
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to={window.location.hostname === 'crm.rmpgutah.us' ? '/crm' : '/'} replace /> : <LoginPage />}
        />

        {/* Detached windows — no Layout wrapper */}
        <Route path="/detached/incident/:id" element={<ProtectedRoute><IncidentDetailWindow /></ProtectedRoute>} />
        <Route path="/detached/record/:type/:id" element={<ProtectedRoute><RecordDetailWindow /></ProtectedRoute>} />

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
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/personnel" element={<PersonnelPage />} />
          <Route path="/communications" element={<CommunicationsPage />} />
          <Route path="/radio" element={<RadioPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/patrol" element={<PatrolPage />} />
          <Route path="/fleet" element={<FleetPage />} />
          <Route path="/body-cameras" element={<BodyCamerasPage />} />
          <Route path="/dash-cameras" element={<DashCamerasPage />} />
          <Route path="/warrants" element={<WarrantsPage />} />
          <Route path="/citations" element={<CitationsPage />} />
          <Route path="/field-interviews" element={<FieldInterviewsPage />} />
          <Route path="/trespass-orders" element={<TrespassOrdersPage />} />
          <Route path="/mdt" element={<MdtPage />} />
          <Route path="/shift-plans" element={<ShiftPlansPage />} />
          <Route path="/statute-analytics" element={<StatuteAnalyticsPage />} />
          <Route path="/reports/custom" element={<CustomReportBuilder />} />
          <Route path="/criminal-history" element={<CriminalHistoryPage />} />
          <Route path="/evidence" element={<EvidencePropertyPage />} />
          <Route path="/cases" element={<CaseManagementPage />} />
          <Route path="/crime-analysis" element={<CrimeAnalysisPage />} />
          <Route path="/code-enforcement" element={<CodeEnforcementPage />} />
          <Route path="/court" element={<CourtTrackerPage />} />
          <Route path="/dar" element={<DailyActivityReportsPage />} />
          <Route path="/offender-registry" element={<OffenderRegistryPage />} />
          <Route path="/sex-offender-registry" element={<SexOffenderRegistryPage />} />
          <Route path="/ncic" element={<NcicPage />} />
          <Route path="/dl-search" element={<DlSearchPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/training-docs" element={<TrainingDocsPage />} />
          <Route path="/dl-search" element={<DlSearchPage />} />
          <Route path="/forensics" element={<ForensicsPage />} />
          <Route path="/skip-tracer" element={<SkipTracerPage />} />
          <Route path="/arrest-records" element={<ArrestRecordsPage />} />
          <Route path="/email" element={<EmailPage />} />
          <Route path="/crm" element={<CrmPage />} />
          <Route path="/serve" element={<ServePage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
