// ============================================================
// RMPG Flex — HR Console Page
// Tab-based HR management: dashboard, leave/PTO, disciplinary, reviews
// ============================================================

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

const VALID_TABS: readonly HRTab[] = ['dashboard', 'leave', 'disciplinary', 'reviews', 'payroll'] as const;

export default function HRPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = usePersistedTab<HRTab>(
    'rmpg_hr_tab',
    'dashboard',
    VALID_TABS,
  );

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
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Title bar */}
      <PanelTitleBar icon={UserCog} title="HR Console" />

      {/* Tab bar */}
      <div className="flex items-center border-b border-rmpg-700 bg-surface-sunken px-2">
        {HR_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'text-white border-brand-500'
                  : 'text-rmpg-400 border-transparent hover:text-rmpg-200'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {renderTab()}
      </div>
    </div>
  );
}
