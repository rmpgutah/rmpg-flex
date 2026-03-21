// ============================================================
// RMPG Flex — HR Page (Main Container)
// Officers/dispatchers see EmployeeSelfService;
// HR/admin/managers see full module interface with sidebar.
// ============================================================

import React, { useState, useEffect } from 'react';
import { Briefcase } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import PanelTitleBar from '../../components/PanelTitleBar';
import HrSidebar from './components/HrSidebar';
import LeaveManagement from './modules/LeaveManagement';
import PerformanceReviews from './modules/PerformanceReviews';
import Disciplinary from './modules/Disciplinary';
import Onboarding from './modules/Onboarding';
import PayrollAccounting from './modules/PayrollAccounting';
import EmployeeSelfService from './modules/EmployeeSelfService';

// Roles that see the full HR management interface
const HR_ROLES = ['admin', 'manager', 'supervisor', 'human_resources'];

const STORAGE_KEY = 'rmpg_hr_module';

function HrDashboard() {
  return (
    <div className="flex flex-col h-full">
      <PanelTitleBar title="HR Dashboard" icon={Briefcase} />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-3">
          <DashCard title="Pending Leave Requests" endpoint="/hr/stats/pending-leave" color="yellow" />
          <DashCard title="Active Employees" endpoint="/hr/stats/active-employees" color="green" />
          <DashCard title="Open Grievances" endpoint="/hr/stats/open-grievances" color="red" />
          <DashCard title="Reviews Due" endpoint="/hr/stats/reviews-due" color="blue" />
          <DashCard title="Onboarding In Progress" endpoint="/hr/stats/onboarding-active" color="purple" />
          <DashCard title="Pending Payroll" endpoint="/hr/stats/pending-payroll" color="orange" />
        </div>
      </div>
    </div>
  );
}

function DashCard({ title, endpoint, color }: { title: string; endpoint: string; color: string }) {
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    import('../../hooks/useApi').then(({ apiFetch }) => {
      apiFetch<{ count: number }>(endpoint)
        .then(d => setValue(d.count))
        .catch(() => setValue(0));
    });
  }, [endpoint]);

  const colorMap: Record<string, string> = {
    yellow: 'border-yellow-500/40 text-yellow-300',
    green: 'border-green-500/40 text-green-300',
    red: 'border-red-500/40 text-red-300',
    blue: 'border-blue-500/40 text-blue-300',
    purple: 'border-purple-500/40 text-purple-300',
    orange: 'border-orange-500/40 text-orange-300',
  };

  return (
    <div className={`bg-[#0d1520] border rounded-sm p-4 ${colorMap[color] || 'border-[#1e3048]'}`}>
      <p className="text-[10px] text-rmpg-500 uppercase tracking-wider">{title}</p>
      <p className={`text-2xl font-mono font-bold mt-1 ${colorMap[color]?.split(' ')[1] || 'text-white'}`}>
        {value === null ? '...' : value}
      </p>
    </div>
  );
}

export default function HrPage() {
  const { user } = useAuth();

  // Officers and dispatchers see self-service only
  const isHrUser = user && HR_ROLES.includes(user.role);

  const [activeModule, setActiveModule] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'leave';
    } catch {
      return 'leave';
    }
  });

  const handleModuleChange = (id: string) => {
    setActiveModule(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch { /* ignore */ }
  };

  // Non-HR users see employee self-service
  if (!isHrUser) {
    return <EmployeeSelfService />;
  }

  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard':
        return <HrDashboard />;
      case 'leave':
        return <LeaveManagement />;
      case 'performance':
        return <PerformanceReviews />;
      case 'disciplinary':
        return <Disciplinary />;
      case 'onboarding':
        return <Onboarding />;
      case 'payroll':
        return <PayrollAccounting />;
      default:
        return <LeaveManagement />;
    }
  };

  return (
    <div className="flex h-full bg-[#141e2b]">
      <HrSidebar activeModule={activeModule} onModuleChange={handleModuleChange} />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {renderModule()}
      </div>
    </div>
  );
}
