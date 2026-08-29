// ============================================================
// RMPG Flex — HR Console Page
// Tab-based HR management: dashboard, leave/PTO, disciplinary, reviews
// ============================================================

import { useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { UserCog } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useAuth } from '../../context/AuthContext';
import { HR_TABS, type HRTab } from './utils/hrConstants';
import HRDashboardTab from './tabs/HRDashboardTab';
import LeaveTab from './tabs/LeaveTab';
import DisciplinaryTab from './tabs/DisciplinaryTab';
import ReviewsTab from './tabs/ReviewsTab';
import PayrollTab from './tabs/PayrollTab';
import GrievancesTab from './tabs/GrievancesTab';
import DocumentsTab from './tabs/DocumentsTab';
import AttendanceTab from './tabs/AttendanceTab';
import BenefitsTab from './tabs/BenefitsTab';
import PIPsTab from './tabs/PIPsTab';
import CorporateOpsTab from './tabs/CorporateOpsTab';

const VALID_TABS: readonly HRTab[] = ['dashboard', 'leave', 'disciplinary', 'reviews', 'payroll', 'ops', 'grievances', 'documents', 'attendance', 'benefits', 'pips'] as const;

// Manager-tier roles that can access sensitive HR data.
// Mirrors server-side MANAGER_ROLES in hr.ts.
const HR_MANAGER_ROLES = ['admin', 'manager', 'supervisor', 'human_resources'];

// Tabs that are restricted to manager/HR roles — officers must not see other
// employees' payroll or benefits data.
const MANAGER_ONLY_TABS: readonly HRTab[] = ['payroll', 'benefits', 'ops'] as const;

export default function HRPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTabPersisted] = usePersistedTab<HRTab>(
    'rmpg_hr_tab',
    'dashboard',
    VALID_TABS,
  );

  const userRole = user?.role ?? 'officer';
  const userId = user?.id ?? '';
  const isManager = HR_MANAGER_ROLES.includes(userRole);

  // Honour ?tab= deep-link on first render; strip it from the URL afterwards
  // so the browser back button works as expected.
  useEffect(() => {
    const tabParam = searchParams.get('tab') as HRTab | null;
    if (tabParam && VALID_TABS.includes(tabParam)) {
      // Block officers from deep-linking into manager-only tabs.
      if (!isManager && MANAGER_ONLY_TABS.includes(tabParam as typeof MANAGER_ONLY_TABS[number])) return;
      setActiveTabPersisted(tabParam);
      setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('tab'); return next; }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setActiveTab = useCallback((tab: HRTab) => {
    // Prevent officers from switching into manager-only tabs.
    if (!isManager && MANAGER_ONLY_TABS.includes(tab as typeof MANAGER_ONLY_TABS[number])) return;
    setActiveTabPersisted(tab);
  }, [isManager, setActiveTabPersisted]);

  // Set document title based on active tab
  useEffect(() => {
    const tabLabel = HR_TABS.find(t => t.key === activeTab)?.label || 'HR Console';
    document.title = `${tabLabel} — HR Console — RMPG Flex`;
  }, [activeTab]);

  // Keyboard shortcut: N = click the active tab's "New" button.
  // Each tab marks its primary create button with data-hr-new-btn so the
  // top-level handler stays decoupled from per-tab state.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      const target = e.target as HTMLElement;
      // Ignore when focus is inside a text field / editable area.
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const newBtn = document.querySelector<HTMLElement>('[data-hr-new-btn]');
      if (newBtn) { e.preventDefault(); newBtn.click(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab]);

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <HRDashboardTab
            userRole={userRole}
            userId={userId}
            onNavigateToLeave={() => setActiveTab('leave')}
          />
        );
      case 'leave':
        return <LeaveTab />;
      case 'disciplinary':
        return <DisciplinaryTab userRole={userRole} userId={Number(userId)} />;
      case 'reviews':
        return <ReviewsTab userRole={userRole} userId={userId} />;
      case 'payroll':
        // Extra guard — if an officer somehow lands here, show nothing sensitive.
        return isManager
          ? <PayrollTab userRole={userRole} />
          : <div className="p-6 text-sm text-rmpg-500 text-center">Not authorized.</div>;
      case 'ops':
        return isManager
          ? <CorporateOpsTab />
          : <div className="p-6 text-sm text-rmpg-500 text-center">Not authorized.</div>;
      case 'grievances':
        return <GrievancesTab />;
      case 'documents':
        return <DocumentsTab userRole={userRole} />;
      case 'attendance':
        return <AttendanceTab userRole={userRole} />;
      case 'benefits':
        // Extra guard — benefits costs are PII visible only to managers.
        return isManager
          ? <BenefitsTab userRole={userRole} />
          : <div className="p-6 text-sm text-rmpg-500 text-center">Not authorized.</div>;
      case 'pips':
        return <PIPsTab userRole={userRole} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Title bar */}
      <PanelTitleBar icon={UserCog} title="HR Console" />

      {/* Tab bar */}
      <div className="flex items-center border-b border-rmpg-700 bg-surface-sunken px-2 overflow-x-auto scrollbar-dark print:hidden" role="tablist" aria-label="HR Console tabs" style={{ scrollbarWidth: 'none' }}>
        {HR_TABS
          // Hide manager-only tabs from officer-tier users.
          .filter(tab => isManager || !MANAGER_ONLY_TABS.includes(tab.key as typeof MANAGER_ONLY_TABS[number]))
          .map(tab => {
            const Icon = tab.icon;
            return (
              <button type="button"
                key={tab.key}
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-controls={`hr-tabpanel-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-200 border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50 ${
                  activeTab === tab.key
                    ? 'text-rmpg-100 border-brand-500'
                    : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:border-rmpg-500/50'
                }`}
              >
                <Icon size={14} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto scrollbar-dark" role="tabpanel" id={`hr-tabpanel-${activeTab}`} aria-label={`${activeTab} tab content`}>
        {renderTab()}
      </div>
    </div>
  );
}
