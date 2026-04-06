import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { ToastProvider } from './components/ToastProvider';
import { GlobalSearch } from './components/GlobalSearch';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import WebUpdateBanner from './components/WebUpdateBanner';
import AndroidUpdateChecker from './components/AndroidUpdateChecker';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import DispatchPage from './pages/DispatchPage';
import MapPage from './pages/MapPage';
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
import NcicPage from './pages/NcicPage';
import BodyCamerasPage from './pages/BodyCamerasPage';
import TrainingDocsPage from './pages/TrainingDocsPage';
import CommandCenterPage from './pages/CommandCenterPage';
import IncidentDetailWindow from './pages/detached/IncidentDetailWindow';
import RecordDetailWindow from './pages/detached/RecordDetailWindow';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-base">
        <div className="text-center border border-rmpg-600 bg-surface-base p-8">
          <div className="w-10 h-10 border-3 border-red-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-rmpg-400 text-xs uppercase tracking-wider font-bold">Loading RMPG Flex...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-base">
        <div className="text-center border border-rmpg-600 bg-surface-base p-8">
          <div className="w-10 h-10 border-3 border-red-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-rmpg-400 text-xs uppercase tracking-wider font-bold">Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isAuthenticated && <GlobalSearch />}
      {isAuthenticated && <KeyboardShortcuts />}
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
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
          <Route path="/" element={<DashboardPage />} />
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
          <Route path="/ncic" element={<NcicPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/training-docs" element={<TrainingDocsPage />} />
          <Route path="/command-center" element={<CommandCenterPage />} />
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
        <ToastProvider>
          <ErrorBoundary>
            <WebUpdateBanner />
            <AndroidUpdateChecker />
            <AppRoutes />
          </ErrorBoundary>
        </ToastProvider>
      </WebSocketProvider>
    </AuthProvider>
  );
}
