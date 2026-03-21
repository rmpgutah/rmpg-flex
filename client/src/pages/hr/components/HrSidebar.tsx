// ============================================================
// RMPG Flex — HR Sidebar Navigation
// Vertical sidebar with module icons (Spillman Flex dark console)
// ============================================================

import React from 'react';
import {
  BarChart3, CalendarOff, TrendingUp, AlertTriangle,
  UserPlus, DollarSign,
} from 'lucide-react';

const MODULES = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'leave', label: 'Leave Management', icon: CalendarOff },
  { id: 'performance', label: 'Performance', icon: TrendingUp },
  { id: 'disciplinary', label: 'Disciplinary', icon: AlertTriangle },
  { id: 'onboarding', label: 'Onboarding', icon: UserPlus },
  { id: 'payroll', label: 'Payroll', icon: DollarSign },
] as const;

export type HrModuleId = typeof MODULES[number]['id'];

interface HrSidebarProps {
  activeModule: string;
  onModuleChange: (id: string) => void;
}

export default function HrSidebar({ activeModule, onModuleChange }: HrSidebarProps) {
  return (
    <nav className="w-48 min-w-[192px] bg-[#0d1520] border-r border-[#1e3048] flex flex-col py-2 shrink-0">
      <div className="px-3 py-1.5 mb-1">
        <span className="text-[10px] font-semibold text-rmpg-500 uppercase tracking-wider">
          HR Modules
        </span>
      </div>
      {MODULES.map(mod => {
        const Icon = mod.icon;
        const isActive = activeModule === mod.id;
        return (
          <button
            key={mod.id}
            onClick={() => onModuleChange(mod.id)}
            className={`
              flex items-center gap-2.5 px-3 py-2 mx-1 text-xs text-left transition-colors rounded-sm
              ${isActive
                ? 'bg-brand-500/20 text-white border-l-2 border-brand-500 pl-[10px]'
                : 'text-rmpg-400 hover:bg-[#141e2b] hover:text-white border-l-2 border-transparent pl-[10px]'
              }
            `}
          >
            <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-brand-400' : ''}`} />
            <span className="truncate">{mod.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export { MODULES };
