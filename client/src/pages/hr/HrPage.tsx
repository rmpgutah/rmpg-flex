// ============================================================
// RMPG Flex — HR Console Page
// Tab-based HR management: dashboard, leave/PTO, disciplinary, reviews
// ============================================================

import { useEffect } from 'react';
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

const VALID_TABS: readonly HRTab[] = ['dashboard', 'leave', 'disciplinary', 'reviews', 'payroll', 'grievances', 'documents', 'attendance', 'benefits', 'pips'] as const;

export default function HRPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = usePersistedTab<HRTab>(
    'rmpg_hr_tab',
    'dashboard',
    VALID_TABS,
  );

  // Set document title based on active tab
  useEffect(() => {
    const tabLabel = HR_TABS.find(t => t.key === activeTab)?.label || 'HR Console';
    document.title = `${tabLabel} \u2014 HR Console \u2014 RMPG Flex`;
  }, [activeTab]);

  const userRole = user?.role ?? 'officer';
  const userId = user?.id ?? '';

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
        return <PayrollTab userRole={userRole} />;
      case 'grievances':
        return <GrievancesTab />;
      case 'documents':
        return <DocumentsTab userRole={userRole} />;
      case 'attendance':
        return <AttendanceTab userRole={userRole} />;
      case 'benefits':
        return <BenefitsTab userRole={userRole} />;
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
      <div className="flex items-center border-b border-[#2b2b2b] bg-[#0c0c0c] px-2 overflow-x-auto scrollbar-dark print:hidden" role="tablist" aria-label="HR Console tabs" style={{ scrollbarWidth: 'none' }}>
        {HR_TABS.map(tab => {
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
                  ? 'text-white border-brand-500'
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
