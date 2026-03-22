import { LayoutDashboard, CalendarDays, Shield, Star, DollarSign, FileText, AlertOctagon, ClipboardCheck, Heart, TrendingUp } from 'lucide-react';

export const HR_TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'leave', label: 'Leave / PTO', icon: CalendarDays },
  { key: 'disciplinary', label: 'Disciplinary', icon: Shield },
  { key: 'reviews', label: 'Reviews', icon: Star },
  { key: 'payroll', label: 'Payroll', icon: DollarSign },
  { key: 'grievances', label: 'Grievances', icon: AlertOctagon },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { key: 'benefits', label: 'Benefits', icon: Heart },
  { key: 'pips', label: 'PIPs', icon: TrendingUp },
] as const;

export type HRTab = typeof HR_TABS[number]['key'];

export const LEAVE_TYPE_COLORS: Record<string, string> = {
  vacation: '#3b82f6',   // blue
  sick: '#ef4444',       // red
  personal: '#8b5cf6',   // purple
  bereavement: '#6b7280', // gray
  training: '#06b6d4',   // cyan
  unpaid: '#f59e0b',     // amber
};

export const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#22c55e',
  denied: '#ef4444',
  cancelled: '#6b7280',
};

export const SEVERITY_COLORS: Record<string, string> = {
  minor: '#3b82f6',
  moderate: '#f59e0b',
  major: '#f97316',
  critical: '#ef4444',
};

export const DISCIPLINARY_TYPE_LABELS: Record<string, string> = {
  verbal_warning: 'Verbal Warning',
  written_warning: 'Written Warning',
  suspension: 'Suspension',
  termination: 'Termination',
  commendation: 'Commendation',
  counseling: 'Counseling',
};

export const REVIEW_CATEGORIES = [
  'Professionalism',
  'Communication',
  'Tactical Skills',
  'Leadership',
  'Attendance / Punctuality',
  'Report Writing',
  'Community Relations',
  'Policy Compliance',
];

export const RATING_LABELS = ['', 'Unsatisfactory', 'Needs Improvement', 'Meets Expectations', 'Exceeds Expectations', 'Outstanding'];
