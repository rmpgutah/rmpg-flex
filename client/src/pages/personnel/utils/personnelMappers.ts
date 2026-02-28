// ============================================================
// RMPG Flex — Personnel Backend->Frontend Data Mappers
// ============================================================

import type { User as UserType, Schedule, TimeEntry, Credential, TrainingRecord, Deployment } from '../../../types';

export interface OfficerWithStatus extends UserType {
  status: string;
}

export function mapUser(row: any): OfficerWithStatus {
  let firstName = row.first_name || '';
  let lastName = row.last_name || '';
  if (!firstName && !lastName && row.full_name) {
    const parts = (row.full_name || '').trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }
  const isActive = row.status === 'active';

  return {
    id: String(row.id),
    username: row.username || '',
    email: row.email || '',
    first_name: firstName,
    last_name: lastName,
    middle_name: row.middle_name || undefined,
    role: row.role || 'officer',
    badge_number: row.badge_number || undefined,
    phone: row.phone || undefined,
    rank: row.rank || undefined,
    department: row.department || undefined,
    address: row.address || undefined,
    city: row.city || undefined,
    state: row.state || undefined,
    zip: row.zip || undefined,
    date_of_birth: row.date_of_birth || undefined,
    hire_date: row.hire_date || undefined,
    termination_date: row.termination_date || undefined,
    shift_preference: row.shift_preference || undefined,
    dl_number: row.dl_number || undefined,
    dl_state: row.dl_state || undefined,
    dl_expiry: row.dl_expiry || undefined,
    blood_type: row.blood_type || undefined,
    allergies: row.allergies || undefined,
    uniform_size: row.uniform_size || undefined,
    emergency_contact_name: row.emergency_contact_name || undefined,
    emergency_contact_phone: row.emergency_contact_phone || undefined,
    emergency_contact_relationship: row.emergency_contact_relationship || undefined,
    is_active: isActive,
    last_login: undefined,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    status: isActive ? 'on_duty' : 'off_duty',
  };
}

export function mapSchedule(row: any): Schedule {
  const shiftDate = row.shift_date || '';
  const startTime = row.start_time || '00:00:00';
  const endTime = row.end_time || '00:00:00';

  const shiftStart = shiftDate ? `${shiftDate}T${startTime}` : '';
  let shiftEnd = '';
  if (shiftDate) {
    if (endTime <= startTime) {
      const nextDay = new Date(shiftDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const pad = (n: number) => String(n).padStart(2, '0');
      const nextDateStr = `${nextDay.getFullYear()}-${pad(nextDay.getMonth() + 1)}-${pad(nextDay.getDate())}`;
      shiftEnd = `${nextDateStr}T${endTime}`;
    } else {
      shiftEnd = `${shiftDate}T${endTime}`;
    }
  }

  return {
    id: String(row.id),
    officer_id: String(row.officer_id),
    officer_name: row.officer_name || '',
    shift_start: shiftStart,
    shift_end: shiftEnd,
    property_id: row.property_id ? String(row.property_id) : undefined,
    property_name: row.property_name || undefined,
    position: 'Patrol',
    notes: row.notes || undefined,
    status: row.status || 'scheduled',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

export function mapTimeEntry(row: any): TimeEntry {
  let status: TimeEntry['status'] = 'clocked_in';
  if (row.status === 'completed') status = 'clocked_out';
  else if (row.status === 'on_break') status = 'on_break';
  else if (row.status === 'edited') status = 'edited';
  else if (row.status === 'active') status = 'clocked_in';

  return {
    id: String(row.id),
    officer_id: String(row.officer_id),
    officer_name: row.officer_name || '',
    clock_in: row.clock_in || '',
    clock_out: row.clock_out || undefined,
    scheduled_start: undefined,
    scheduled_end: undefined,
    break_start: row.break_start || undefined,
    break_minutes: Number(row.break_minutes) || 0,
    total_hours: row.total_hours != null ? Number(row.total_hours) : undefined,
    status,
    notes: undefined,
    created_at: row.created_at || '',
    updated_at: '',
  };
}

export function mapCredential(row: any): Credential {
  let status: Credential['status'] = 'valid';
  if (row.expiry_date) {
    const expiry = new Date(row.expiry_date);
    const now = new Date();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    if (expiry.getTime() < now.getTime()) {
      status = 'expired';
    } else if (expiry.getTime() - now.getTime() < ninetyDaysMs) {
      status = 'expiring_soon';
    }
  }

  return {
    id: String(row.id),
    officer_id: String(row.officer_id),
    officer_name: row.officer_name || '',
    type: row.credential_type || '',
    credential_number: row.credential_number || '',
    issuing_authority: row.issuing_authority || '',
    issued_date: row.issued_date || '',
    expiry_date: row.expiry_date || '',
    status,
    notes: row.notes || undefined,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

export function mapTraining(row: any): TrainingRecord {
  return {
    id: String(row.id),
    officer_id: String(row.officer_id),
    officer_name: row.officer_name || '',
    course_name: row.course_name || '',
    category: row.category || 'other',
    provider: row.provider || '',
    completed_date: row.completed_date || undefined,
    expiry_date: row.expiry_date || undefined,
    score: row.score != null ? Number(row.score) : undefined,
    hours: Number(row.hours) || 0,
    certificate_number: row.certificate_number || undefined,
    status: row.status || 'scheduled',
    notes: row.notes || undefined,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

export function mapDeployment(row: any): Deployment {
  return {
    id: String(row.id),
    officer_id: String(row.officer_id),
    officer_name: row.officer_name || '',
    property_id: String(row.property_id),
    property_name: row.property_name || '',
    client_name: row.client_name || undefined,
    position: row.position || 'Patrol',
    start_date: row.start_date || '',
    end_date: row.end_date || undefined,
    status: row.status || 'active',
    hours_per_week: row.hours_per_week != null ? Number(row.hours_per_week) : undefined,
    notes: row.notes || undefined,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}
