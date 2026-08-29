import { LayoutDashboard, CalendarDays, Shield, Star, DollarSign, FileText, AlertOctagon, ClipboardCheck, Heart, TrendingUp, Link2 } from 'lucide-react';

export const HR_TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'leave', label: 'Leave / PTO', icon: CalendarDays },
  { key: 'disciplinary', label: 'Disciplinary', icon: Shield },
  { key: 'reviews', label: 'Reviews', icon: Star },
  { key: 'payroll', label: 'Payroll', icon: DollarSign },
  { key: 'ops', label: 'Corporate Ops', icon: Link2 },
  { key: 'grievances', label: 'Grievances', icon: AlertOctagon },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { key: 'benefits', label: 'Benefits', icon: Heart },
  { key: 'pips', label: 'PIPs', icon: TrendingUp },
] as const;

export type HRTab = typeof HR_TABS[number]['key'];

export const LEAVE_TYPE_COLORS: Record<string, string> = {
  vacation: '#888888',   // gray (neutral)
  sick: '#ef4444',       // red
  personal: '#8b5cf6',   // purple
  bereavement: 'var(--text-muted)', // gray
  training: '#22c55e',   // cyan
  unpaid: '#f59e0b',     // amber
};

export const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#22c55e',
  denied: '#ef4444',
  cancelled: 'var(--text-muted)',
};

export const SEVERITY_COLORS: Record<string, string> = {
  minor: '#888888',
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
