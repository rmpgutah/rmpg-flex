// ============================================================
// RMPG Flex — Personnel Formatting Utilities
// ============================================================

import { parseTimestamp } from '../../../utils/dateUtils';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function getWeekMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatWeekLabel(monday: Date): string {
  return `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function dateToYMD(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function calcYearsOfService(hireDate?: string): string {
  if (!hireDate) return '-';
  const hire = parseTimestamp(hireDate);
  const now = new Date();
  const years = Math.floor((now.getTime() - hire.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return `${years} yr${years !== 1 ? 's' : ''}`;
}

export function calcDaysUntilExpiry(expiryDate: string): number {
  const exp = parseTimestamp(expiryDate);
  const now = new Date();
  return Math.ceil((exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export function formatMilitary(dateStr: string): string {
  if (!dateStr) return '-';
  return parseTimestamp(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
