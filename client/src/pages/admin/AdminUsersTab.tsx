import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  Settings,
  Ban,
  UserCheck,
  Shield,
  ShieldOff,
  KeyRound,
  AlertTriangle,
  RefreshCw,
  Monitor,
  LogOut,
  Globe,
  Clock,
  Users,
  Eye,
  HelpCircle,
  Download,
  Copy,
  ArrowUpDown,
  FilterX,
  Printer,
  MapPin,
  Wifi,
} from 'lucide-react';
import type { User, UserRole } from '../../types';
import { toDisplayLabel } from '../../utils/formatters';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import ConfirmDialog from '../../components/ConfirmDialog';
import { safeDateTimeStr, parseTimestamp } from '../../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';

// ============================================================
// Shared types
// ============================================================

export interface AuditEntry {
  id: string;
  user: string;
  action: string;
  details: string;
  timestamp: string;
}

// audit_log.details is free-form — most action writers already store a
// short human sentence, but a few (bulk imports, integration syncs) store
// raw JSON, which used to leak straight into the Activity Log as an
// unreadable blob. Render JSON as "key: value, key: value" instead.
function formatActivityDetails(details: string): string {
  if (!details) return '';
  const trimmed = details.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return details;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${toDisplayLabel(k)}: ${v}`)
        .join(', ') || details;
    }
    return details;
  } catch {
    return details;
  }
}

interface UserSession {
  id: number;
  user_id: number;
  session_id: string;
  ip_address: string;
  user_agent: string;
  device_name: string;
  location: string | null;
  isp: string | null;
  likely_vpn_or_hosting: number | null;
  device_latitude: string | null;
  device_longitude: string | null;
  device_geo_accuracy_m: string | null;
  is_active: number;
  created_at: string;
  last_used_at: string;
}

const ALL_ROLES: UserRole[] = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager', 'client_viewer', 'human_resources'];

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-red-900/50 text-red-400 border-red-700/50',
  manager: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  supervisor: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  officer: 'bg-brand-900/50 text-brand-400 border-brand-700/50',
  dispatcher: 'bg-green-900/50 text-green-400 border-green-700/50',
  client_viewer: 'bg-teal-900/50 text-teal-400 border-teal-700/50',
  contract_manager: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
  human_resources: 'bg-pink-900/50 text-pink-400 border-pink-700/50',
};

type UserStatus = 'active' | 'inactive' | 'terminated';

const STATUS_CONFIG: Record<UserStatus, { label: string; color: string; icon: typeof CheckCircle }> = {
  active:     { label: 'Active',     color: 'text-green-400',  icon: CheckCircle },
  inactive:   { label: 'Suspended',  color: 'text-yellow-400', icon: Ban },
  terminated: { label: 'Terminated', color: 'text-red-400',    icon: XCircle },
};

// ============================================================
// Props
// ============================================================

interface AdminUsersTabProps {
  users: (User & { last_login_display?: string })[];
  loadingUsers: boolean;
  error: string | null;
  setError: (error: string | null) => void;

  // Selected user detail
  selectedUser: (User & { last_login_display?: string }) | null;
  setSelectedUser: React.Dispatch<React.SetStateAction<(User & { last_login_display?: string }) | null>>;
  userActivity: AuditEntry[];
  loadingUserActivity: boolean;

  // Modal handlers
  openAddUser: () => void;
  openEditUser: (user: User & { last_login_display?: string }) => void;
  openDeleteUser: (user: User & { last_login_display?: string }) => void;
  onStatusChange?: (userId: string, newStatus: string) => void;

  // Loading spinner component
  LoadingSpinner: React.FC;
}

// ============================================================
// Component
// ============================================================

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function AdminUsersTab({
  users,
  loadingUsers,
  selectedUser,
  setSelectedUser,
  userActivity,
  loadingUserActivity,
  openAddUser,
  openEditUser,
  openDeleteUser,
  onStatusChange,
  LoadingSpinner,
}: AdminUsersTabProps) {
  const { addToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // ── List filters / sort ──
  type StatusFilter = 'all' | UserStatus;
  type TotpFilter = 'all' | 'enabled' | 'disabled';
  type SortField = 'name' | 'role' | 'status' | 'last_login';
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [totpFilter, setTotpFilter] = useState<TotpFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const resetFilters = () => {
    setSearchQuery('');
    setRoleFilter('all');
    setStatusFilter('all');
    setTotpFilter('all');
    setSortField('name');
    setSortDir('asc');
  };
  const filtersActive = !!searchQuery || roleFilter !== 'all' || statusFilter !== 'all' || totpFilter !== 'all';
  const [userDetailTab, setUserDetailTab] = useState<'profile' | 'personal' | 'credentials' | 'security' | 'activity' | 'email'>('profile');
  const [securityActionLoading, setSecurityActionLoading] = useState<string | null>(null);
  const [securityMsg, setSecurityMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [userSessions, setUserSessions] = useState<UserSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [roleEditing, setRoleEditing] = useState(false);
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);

  // Security Questions ("Forgot password?" recovery) — admin view of a
  // selected user's setup. Never shows answers (bcrypt-hashed, one-way).
  const [sqAdminConfigured, setSqAdminConfigured] = useState<boolean | null>(null);
  const [sqAdminQuestions, setSqAdminQuestions] = useState<string[]>([]);
  const [sqAdminLoading, setSqAdminLoading] = useState(false);

  // Per-user Microsoft Graph mailbox connection status (Email Integration
  // sub-tab) — mirrors what GET /email/connect/status shows an officer
  // about their own account, read via an admin-scoped endpoint instead.
  const [emailStatus, setEmailStatus] = useState<{ connected: boolean; mailbox: string | null } | null>(null);
  const [emailStatusLoading, setEmailStatusLoading] = useState(false);

  // Centralized destructive-action ConfirmDialog state — replaces the four
  // window.confirm() prompts that scattered through Suspend / Reactivate /
  // Reset 2FA / Revoke Sessions. Each handler stores its title/message/
  // onConfirm here; the dialog renders once at the bottom of the tab so
  // there is a single Esc target and a single overlay (the AdminPage Esc
  // smart-cascade does NOT see browser-native confirms; they were
  // unreachable by keyboard cascade and broke the day/night surface).
  interface DeleteConfirm {
    title: string;
    message: string;
    confirmLabel?: string;
    confirmVariant?: 'danger' | 'warning' | 'default';
    onConfirm: () => Promise<void> | void;
  }
  const [confirmDlg, setConfirmDlg] = useState<DeleteConfirm | null>(null);
  const [confirmDlgLoading, setConfirmDlgLoading] = useState(false);
  const runConfirmDlg = async () => {
    if (!confirmDlg) return;
    setConfirmDlgLoading(true);
    try {
      await confirmDlg.onConfirm();
    } finally {
      setConfirmDlgLoading(false);
      setConfirmDlg(null);
    }
  };

  const handleReset2FA = async (userId: string) => {
    setSecurityActionLoading('reset-2fa');
    setSecurityMsg(null);
    try {
      await apiFetch(`/admin/users/${userId}/reset-2fa`, { method: 'POST' });
      setSecurityMsg({ type: 'success', text: '2FA has been reset. User will be prompted to set up 2FA on next login.' });
      addToast('2FA reset successfully', 'success');
    } catch (err) {
      setSecurityMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to reset 2FA' });
      addToast(err instanceof Error ? err.message : 'Failed to reset 2FA', 'error');
    }
    setSecurityActionLoading(null);
  };

  // Tracks the currently-selected user id without being part of any
  // useCallback's dependency array, so loadUserSessions/loadUserSecurity
  // keep a stable identity across renders — using `selectedUser` (which
  // gets a new object reference on every security/role update) here would
  // re-trigger the effect below on every fetch, causing an infinite
  // refetch loop against /admin/sessions and /admin/users/:id/security.
  const selectedUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedUserIdRef.current = selectedUser ? String(selectedUser.id) : null;
  }, [selectedUser?.id]);

  // Load active sessions for a user when the Security tab is shown
  const loadUserSessions = useCallback(async (userId: string) => {
    setLoadingSessions(true);
    try {
      const sessions = await apiFetch<UserSession[]>('/admin/sessions');
      // Stale-response guard: skip if the admin has switched to a
      // different user while this request was in flight.
      if (selectedUserIdRef.current === String(userId)) {
        setUserSessions((sessions || []).filter((s: UserSession) => String(s.user_id || (s as any).userId) === String(userId) && s.is_active));
      }
    } catch {
      if (selectedUserIdRef.current === String(userId)) setUserSessions([]);
    }
    setLoadingSessions(false);
  }, []);

  // Load the 2FA/password-status fields and security-questions setup for a
  // user when the Security tab is shown — the users list this page starts
  // from doesn't carry them, so selectedUser.totpEnabled etc. would
  // otherwise always be undefined (always rendering "Not Configured").
  const loadUserSecurity = useCallback(async (userId: string) => {
    try {
      const security = await apiFetch<Record<string, unknown>>(`/admin/users/${userId}/security`);
      // Guard against a stale response landing after the admin has already
      // switched to a different user. Uses the functional setState form
      // (not the `selectedUser` closure) so this callback never needs
      // `selectedUser` in its dependency array — depending on it caused an
      // infinite loop, since merging `security` into selectedUser produces
      // a new object reference every call, which re-triggers the effect
      // that calls this callback.
      setSelectedUser((prev) => (prev && String(prev.id) === String(userId) ? ({ ...prev, ...security } as any) : prev));
    } catch { /* leave selectedUser's fields as-is */ }

    setSqAdminLoading(true);
    try {
      const sq = await apiFetch<{ configured: boolean; questions: string[] }>(`/admin/users/${userId}/security-questions`);
      if (selectedUserIdRef.current === String(userId)) {
        setSqAdminConfigured(sq.configured);
        setSqAdminQuestions(sq.questions || []);
      }
    } catch {
      if (selectedUserIdRef.current === String(userId)) {
        setSqAdminConfigured(null);
        setSqAdminQuestions([]);
      }
    }
    setSqAdminLoading(false);
  }, [setSelectedUser]);

  // Load sessions + security status when security tab is opened
  useEffect(() => {
    if (selectedUser && userDetailTab === 'security') {
      loadUserSessions(selectedUser.id);
      loadUserSecurity(selectedUser.id);
    }
  }, [selectedUser?.id, userDetailTab, loadUserSessions, loadUserSecurity]);

  const loadEmailStatus = useCallback(async (userId: string) => {
    setEmailStatusLoading(true);
    try {
      const status = await apiFetch<{ connected: boolean; mailbox: string | null }>(`/admin/users/${userId}/email-status`);
      if (selectedUserIdRef.current === String(userId)) setEmailStatus(status);
    } catch {
      if (selectedUserIdRef.current === String(userId)) setEmailStatus(null);
    }
    setEmailStatusLoading(false);
  }, []);

  // Load email connection status when the Email Integration tab is opened
  useEffect(() => {
    if (selectedUser && userDetailTab === 'email') {
      loadEmailStatus(selectedUser.id);
    }
  }, [selectedUser?.id, userDetailTab, loadEmailStatus]);

  const handleRevokeAllSessions = async (userId: string) => {
    setSecurityActionLoading('revoke-sessions');
    setSecurityMsg(null);
    try {
      const result = await apiFetch<{ message: string; count: number }>(`/admin/users/${userId}/revoke-sessions`, { method: 'POST' });
      setSecurityMsg({ type: 'success', text: result.message || `All sessions revoked.` });
      setUserSessions([]);
      addToast('All sessions revoked', 'success');
    } catch (err) {
      setSecurityMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to revoke sessions' });
      addToast(err instanceof Error ? err.message : 'Failed to revoke sessions', 'error');
    }
    setSecurityActionLoading(null);
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setSecurityActionLoading('role-change');
    setSecurityMsg(null);
    try {
      // The real endpoint is POST /personnel/:id/role (admin-only, self-change
      // blocked server-side) — /admin/users/:id/role never existed.
      const result = await apiFetch<{ message?: string; role: string }>(`/personnel/${userId}/role`, {
        method: 'POST',
        body: JSON.stringify({ role: newRole }),
      });
      setSecurityMsg({ type: 'success', text: result.message || `Role changed to ${newRole}` });
      setRoleEditing(false);
      setPendingRole(null);
      addToast(`Role changed to ${newRole}`, 'success');
      // Update local state
      if (selectedUser) {
        setSelectedUser({ ...selectedUser, role: newRole } as any);
      }
    } catch (err) {
      setSecurityMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change role' });
      addToast(err instanceof Error ? err.message : 'Failed to change role', 'error');
    }
    setSecurityActionLoading(null);
  };

  const handleForcePasswordChange = async (userId: string) => {
    setSecurityActionLoading('force-pw');
    setSecurityMsg(null);
    try {
      await apiFetch(`/admin/users/${userId}/force-password-change`, { method: 'POST' });
      setSecurityMsg({ type: 'success', text: 'User will be required to change their password on next login.' });
      addToast('Password change required on next login', 'success');
    } catch (err) {
      setSecurityMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to force password change' });
      addToast(err instanceof Error ? err.message : 'Failed to force password change', 'error');
    }
    setSecurityActionLoading(null);
  };

  const handleClearSecurityQuestions = async (userId: string) => {
    setSecurityActionLoading('clear-security-questions');
    setSecurityMsg(null);
    try {
      await apiFetch(`/admin/users/${userId}/security-questions`, { method: 'DELETE' });
      setSqAdminConfigured(false);
      setSqAdminQuestions([]);
      setSecurityMsg({ type: 'success', text: 'Security questions cleared. The user can set up new ones from their profile.' });
      addToast('Security questions cleared', 'success');
    } catch (err) {
      setSecurityMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to clear security questions' });
      addToast(err instanceof Error ? err.message : 'Failed to clear security questions', 'error');
    }
    setSecurityActionLoading(null);
  };

  const filteredUsers = (Array.isArray(users) ? users : [])
    .filter((u) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        u.username.toLowerCase().includes(q) ||
        `${u.first_name} ${u.last_name}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.badge_number || '').toLowerCase().includes(q)
      );
    })
    .filter((u) => roleFilter === 'all' || u.role === roleFilter)
    .filter((u) => {
      if (statusFilter === 'all') return true;
      const rawStatus = ((u as any).raw_status || (u.is_active ? 'active' : 'inactive')) as UserStatus;
      return rawStatus === statusFilter;
    })
    .filter((u) => {
      if (totpFilter === 'all') return true;
      const enabled = !!(u as any).totpEnabled;
      return totpFilter === 'enabled' ? enabled : !enabled;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
      } else if (sortField === 'role') {
        cmp = a.role.localeCompare(b.role);
      } else if (sortField === 'status') {
        const sa = (a as any).raw_status || (a.is_active ? 'active' : 'inactive');
        const sb = (b as any).raw_status || (b.is_active ? 'active' : 'inactive');
        cmp = String(sa).localeCompare(String(sb));
      } else if (sortField === 'last_login') {
        const ta = parseTimestamp(a.last_login || '').getTime();
        const tb = parseTimestamp(b.last_login || '').getTime();
        cmp = (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selectedIds.has(u.id));
  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.delete(u.id));
        return next;
      }
      const next = new Set(prev);
      filteredUsers.forEach((u) => next.add(u.id));
      return next;
    });
  };

  // Bulk suspend/reactivate — runs sequentially (not Promise.all) so a
  // rejection on one user doesn't abort the rest, and so the shared
  // fetchUsers() refresh in onStatusChange doesn't race concurrent calls.
  const runBulkStatusChange = async (newStatus: 'active' | 'inactive') => {
    if (!onStatusChange || selectedIds.size === 0) return;
    setBulkActionLoading(true);
    let ok = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await onStatusChange(id, newStatus);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBulkActionLoading(false);
    setSelectedIds(new Set());
    setConfirmDlg(null);
    if (failed === 0) {
      addToast(`${ok} user${ok === 1 ? '' : 's'} ${newStatus === 'active' ? 'reactivated' : 'suspended'}`, 'success');
    } else {
      addToast(`${ok} succeeded, ${failed} failed`, ok > 0 ? 'success' : 'error');
    }
  };

  // Generic bulk runner for the single-user handlers below (reset 2FA,
  // force password change) — same sequential-not-parallel rationale as
  // runBulkStatusChange.
  const runBulkAction = async (fn: (id: string) => Promise<void>, label: string) => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    let ok = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await fn(id);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBulkActionLoading(false);
    setSelectedIds(new Set());
    setConfirmDlg(null);
    if (failed === 0) {
      addToast(`${label} for ${ok} user${ok === 1 ? '' : 's'}`, 'success');
    } else {
      addToast(`${ok} succeeded, ${failed} failed`, ok > 0 ? 'success' : 'error');
    }
  };

  const runBulkForcePasswordChange = () => runBulkAction(
    (id) => apiFetch(`/admin/users/${id}/force-password-change`, { method: 'POST' }),
    'Password change required',
  );
  const runBulkReset2FA = () => runBulkAction(
    (id) => apiFetch(`/admin/users/${id}/reset-2fa`, { method: 'POST' }),
    '2FA reset',
  );

  const copySelectedEmails = async () => {
    const emails = filteredUsers.filter((u) => selectedIds.has(u.id)).map((u) => u.email).filter(Boolean);
    if (emails.length === 0) return;
    try {
      await navigator.clipboard.writeText(emails.join(', '));
      addToast(`Copied ${emails.length} email${emails.length === 1 ? '' : 's'}`, 'success');
    } catch {
      addToast('Failed to copy to clipboard', 'error');
    }
  };

  // Exports whatever is currently visible under the active search/filter,
  // or just the selection when one exists — matches the "select all
  // visible" semantics used elsewhere in this tab.
  const exportUsersCsv = () => {
    const rows = selectedIds.size > 0 ? filteredUsers.filter((u) => selectedIds.has(u.id)) : filteredUsers;
    if (rows.length === 0) return;
    const headers = ['First Name', 'Last Name', 'Username', 'Email', 'Role', 'Status', 'Badge #', '2FA', 'Last Login'];
    const escapeCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [headers.map(escapeCell).join(',')];
    for (const u of rows) {
      const rawStatus = ((u as any).raw_status || (u.is_active ? 'active' : 'inactive')) as UserStatus;
      lines.push([
        u.first_name || '', u.last_name || '', u.username, u.email || '',
        toDisplayLabel(u.role), STATUS_CONFIG[rawStatus]?.label || rawStatus,
        u.badge_number || '', (u as any).totpEnabled ? 'Enabled' : 'Disabled',
        u.last_login || u.last_login_display || '',
      ].map((v) => escapeCell(String(v))).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rmpg-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    addToast(`Exported ${rows.length} user${rows.length === 1 ? '' : 's'}`, 'success');
  };

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const buildUserMenu = (user: User & { last_login_display?: string }): ContextMenuItem[] => {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    const rawStatus = ((user as any).raw_status || (user.is_active ? 'active' : 'inactive')) as UserStatus;
    return [
      m.action('Open user', () => { setSelectedUser(user); setUserDetailTab('profile'); }, { icon: <Eye size={12} /> }),
      m.action('Edit user', () => openEditUser(user), { icon: <Edit size={12} /> }),
      m.separator(),
      m.copy('Copy name', fullName),
      m.copy('Copy username', user.username),
      m.copy('Copy email', user.email, <Globe size={12} />),
      m.copyId(user.id),
      m.separator(),
      m.action('Force password change', () => handleForcePasswordChange(user.id), { icon: <KeyRound size={12} /> }),
      m.action('Reset 2FA', () => handleReset2FA(user.id), { icon: <ShieldOff size={12} /> }),
      m.action('Revoke all sessions', () => handleRevokeAllSessions(user.id), { icon: <LogOut size={12} /> }),
      ...(onStatusChange
        ? (rawStatus === 'active'
            ? [m.action('Suspend user', () => onStatusChange(user.id, 'inactive'), { icon: <Ban size={12} /> })]
            : rawStatus === 'inactive'
              ? [m.action('Reactivate user', () => onStatusChange(user.id, 'active'), { icon: <UserCheck size={12} /> })]
              : [])
        : []),
      m.separator(),
      m.action('Terminate user', () => openDeleteUser(user), { icon: <Trash2 size={12} />, danger: true }),
    ];
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: User List */}
      <div className={`${selectedUser ? 'w-[40%]' : 'w-full'} border-r border-rmpg-700 flex flex-col overflow-hidden transition-all duration-200`}>
        <div className="px-4 py-3 flex items-center justify-between border-b border-rmpg-700 flex-shrink-0 bg-surface-sunken">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" aria-hidden="true" />
            <input id="ff-adminuserstab-0"
              type="text"
              className="input-dark pl-9 text-xs min-h-[36px]"
              placeholder="Search users..." aria-label="Search users"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-rmpg-500 hover:text-rmpg-300 transition-colors" aria-label="Clear search">
                <XCircle className="w-3 h-3" />
              </button>
            )}
          </div>
          <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50" onClick={openAddUser} aria-label="Add new user">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add User
          </button>
        </div>

        {/* Filter / sort toolbar */}
        <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-rmpg-700 flex-shrink-0 bg-surface-sunken/60 print:hidden">
          <select id="ff-adminuserstab-rolefilter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)} className="input-dark text-[10px] py-1 min-h-0" aria-label="Filter by role">
            <option value="all">All Roles</option>
            {ALL_ROLES.map((r) => <option key={r} value={r}>{toDisplayLabel(r)}</option>)}
          </select>
          <select id="ff-adminuserstab-statusfilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="input-dark text-[10px] py-1 min-h-0" aria-label="Filter by status">
            <option value="all">All Statuses</option>
            {(Object.keys(STATUS_CONFIG) as UserStatus[]).map((s) => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
          </select>
          <select id="ff-adminuserstab-totpfilter" value={totpFilter} onChange={(e) => setTotpFilter(e.target.value as any)} className="input-dark text-[10px] py-1 min-h-0" aria-label="Filter by 2FA status">
            <option value="all">2FA: Any</option>
            <option value="enabled">2FA: Enabled</option>
            <option value="disabled">2FA: Disabled</option>
          </select>
          <select id="ff-adminuserstab-sortfield" value={sortField} onChange={(e) => setSortField(e.target.value as any)} className="input-dark text-[10px] py-1 min-h-0" aria-label="Sort by">
            <option value="name">Sort: Name</option>
            <option value="role">Sort: Role</option>
            <option value="status">Sort: Status</option>
            <option value="last_login">Sort: Last Login</option>
          </select>
          <button type="button" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="toolbar-btn text-[9px]" title={sortDir === 'asc' ? 'Ascending' : 'Descending'} aria-label="Toggle sort direction">
            <ArrowUpDown className="w-3 h-3" /> {sortDir === 'asc' ? 'Asc' : 'Desc'}
          </button>
          {filtersActive && (
            <button type="button" onClick={resetFilters} className="toolbar-btn text-[9px]" aria-label="Reset filters">
              <FilterX className="w-3 h-3" /> Reset
            </button>
          )}
          <span className="text-[9px] text-fg-muted ml-auto">
            Showing {filteredUsers.length} of {users.length}
          </span>
          <button type="button" onClick={exportUsersCsv} className="toolbar-btn text-[9px]" title="Export visible users to CSV" aria-label="Export users to CSV">
            <Download className="w-3 h-3" /> Export CSV
          </button>
        </div>

        {onStatusChange && selectedIds.size > 0 && (
          <div className="px-4 py-2 flex items-center justify-between border-b border-rmpg-700 bg-brand-900/10 flex-shrink-0">
            <span className="text-[11px] text-rmpg-200 font-medium">{selectedIds.size} selected</span>
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => setConfirmDlg({
                  title: 'Suspend Selected Users',
                  message: `Suspend ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'}? Their active sessions will be terminated and they will be unable to log in until reactivated.`,
                  confirmLabel: 'Suspend All',
                  confirmVariant: 'warning',
                  onConfirm: () => runBulkStatusChange('inactive'),
                })}
                disabled={bulkActionLoading}
                className="toolbar-btn text-[9px] text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/30"
              >
                <Ban className="w-3 h-3" /> Suspend
              </button>
              <button type="button"
                onClick={() => setConfirmDlg({
                  title: 'Reactivate Selected Users',
                  message: `Reactivate ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'}? They will be able to log in again.`,
                  confirmLabel: 'Reactivate All',
                  confirmVariant: 'default',
                  onConfirm: () => runBulkStatusChange('active'),
                })}
                disabled={bulkActionLoading}
                className="toolbar-btn text-[9px] text-green-400 hover:text-green-300 hover:bg-green-900/30"
              >
                <UserCheck className="w-3 h-3" /> Reactivate
              </button>
              <button type="button"
                onClick={() => setConfirmDlg({
                  title: 'Force Password Change',
                  message: `Require ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'} to change their password on next login?`,
                  confirmLabel: 'Force Change',
                  confirmVariant: 'warning',
                  onConfirm: runBulkForcePasswordChange,
                })}
                disabled={bulkActionLoading}
                className="toolbar-btn text-[9px]"
              >
                <KeyRound className="w-3 h-3" /> Force PW Change
              </button>
              <button type="button"
                onClick={() => setConfirmDlg({
                  title: 'Reset 2FA',
                  message: `Reset two-factor authentication for ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'}? This action is audited.`,
                  confirmLabel: 'Reset 2FA',
                  confirmVariant: 'warning',
                  onConfirm: runBulkReset2FA,
                })}
                disabled={bulkActionLoading}
                className="toolbar-btn text-[9px]"
              >
                <ShieldOff className="w-3 h-3" /> Reset 2FA
              </button>
              <button type="button" onClick={copySelectedEmails} disabled={bulkActionLoading} className="toolbar-btn text-[9px]" title="Copy selected emails">
                <Copy className="w-3 h-3" /> Copy Emails
              </button>
              <button type="button" onClick={() => window.print()} disabled={bulkActionLoading} className="toolbar-btn text-[9px] print:hidden" title="Print selected roster">
                <Printer className="w-3 h-3" /> Print
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())} disabled={bulkActionLoading} className="toolbar-btn text-[9px]">
                Clear
              </button>
            </div>
          </div>
        )}

        {loadingUsers ? (
          <LoadingSpinner />
        ) : (
          <div className="flex-1 overflow-auto scrollbar-dark">
            {onStatusChange && filteredUsers.length > 0 && (
              <label className="flex items-center gap-2 px-4 py-1.5 border-b border-rmpg-700/60 text-[10px] text-fg-muted cursor-pointer select-none">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} className="accent-brand-500" aria-label="Select all visible users" />
                Select all ({filteredUsers.length})
              </label>
            )}
            {filteredUsers
              .map((user, idx) => (
                <div
                  key={user.id}
                  onClick={() => { setSelectedUser(selectedUser?.id === user.id ? null : user); setUserDetailTab('profile'); }}
                  onContextMenu={(e) => openMenu(e, buildUserMenu(user))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedUser(selectedUser?.id === user.id ? null : user); setUserDetailTab('profile'); } }}
                  aria-label={`Select ${user.first_name} ${user.last_name}`}
                  className={`px-4 py-3 border-b border-rmpg-700/60 cursor-pointer transition-all duration-150 ${
                    selectedUser?.id === user.id
                      ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                      : `hover:bg-[rgba(42,42,42,0.6)] border-l-2 border-l-transparent ${idx % 2 === 0 ? '' : 'bg-rmpg-800/10'}`
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {onStatusChange && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(user.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelected(user.id)}
                        className="flex-shrink-0 accent-brand-500"
                        aria-label={`Select ${user.first_name} ${user.last_name} for bulk action`}
                      />
                    )}
                    <div className={`flex-shrink-0 w-9 h-9 rounded-full border flex items-center justify-center text-xs font-bold select-none transition-colors ${
                      user.is_active ? 'bg-rmpg-700 border-rmpg-600 text-rmpg-300' : 'bg-rmpg-800 border-rmpg-700 text-rmpg-500 opacity-60'
                    }`} aria-hidden="true">
                      {user.first_name?.[0]}{user.last_name?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-rmpg-100 truncate">
                          {user.first_name} {user.last_name}
                        </span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase border ${ROLE_COLORS[user.role]}`}>
                          {toDisplayLabel(user.role)}
                        </span>
                        {(user as any).totpEnabled ? (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-bold uppercase bg-green-900/40 text-green-400 border border-green-700/40">
                            <Shield className="w-2 h-2" />2FA
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-bold uppercase bg-red-900/30 text-red-400 border border-red-700/30">
                            <ShieldOff className="w-2 h-2" />NO 2FA
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400">
                        <span className="font-mono">@{user.username}</span>
                        {user.badge_number && <span>Badge: {user.badge_number}</span>}
                        {user.rank && <span>{user.rank}</span>}
                        {/* Enhancement 45: Active sessions count */}
                        {(user as any).active_sessions > 0 && (
                          <span className="text-green-400 font-mono">{(user as any).active_sessions} session{(user as any).active_sessions > 1 ? 's' : ''}</span>
                        )}
                        {user.last_login || user.last_login_display ? (
                          <span title="Last login">{timeAgo(user.last_login || user.last_login_display || '')}</span>
                        ) : (
                          <span className="text-fg-muted">Never logged in</span>
                        )}
                        {(user as any).forcePasswordChange && (
                          <span className="inline-flex items-center gap-0.5 text-amber-400" title="Must change password on next login">
                            <KeyRound className="w-2.5 h-2.5" />PW change pending
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {(() => {
                        const rawStatus = ((user as any).raw_status || (user.is_active ? 'active' : 'inactive')) as UserStatus;
                        const cfg = STATUS_CONFIG[rawStatus] || STATUS_CONFIG.active;
                        const Icon = cfg.icon;
                        return (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold ${cfg.color}`}>
                            <Icon className="w-2.5 h-2.5" />
                            {cfg.label}
                          </span>
                        );
                      })()}
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); openEditUser(user); }}
                        className="p-1 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors rounded-sm"
                        title="Edit user"
                        aria-label={`Edit ${user.first_name} ${user.last_name}`}
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            {users.length === 0 && !loadingUsers && (
              <div className="flex flex-col items-center justify-center text-center text-rmpg-400 py-16 gap-2">
                <Users className="w-8 h-8 text-rmpg-600" aria-hidden="true" />
                <span className="text-xs font-medium text-rmpg-500">No users found</span>
                <span className="text-[9px] text-rmpg-600">{searchQuery ? 'Try a different search term' : 'Add personnel to get started'}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: User Detail Panel */}
      {selectedUser && (
        <div className="w-[60%] flex flex-col overflow-hidden">
          {/* Detail Header */}
          <div className="p-4 border-b border-rmpg-700 bg-surface-sunken flex-shrink-0">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {selectedUser.profile_image ? (
                  <img src={selectedUser.profile_image} alt="" className="w-12 h-12 rounded-full border border-rmpg-600 object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-rmpg-700 border border-rmpg-600 flex items-center justify-center text-sm font-bold text-rmpg-300">
                    {selectedUser.first_name?.[0]}{selectedUser.last_name?.[0]}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-bold text-rmpg-100">
                    {selectedUser.first_name} {selectedUser.last_name}
                  </h2>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-rmpg-300">
                    <span className="font-mono">@{selectedUser.username}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase border ${ROLE_COLORS[selectedUser.role]}`}>
                      {toDisplayLabel(selectedUser.role)}
                    </span>
                    {selectedUser.rank && <span className="text-rmpg-400">{selectedUser.rank}</span>}
                    {selectedUser.badge_number && <span className="font-mono text-rmpg-400">Badge #{selectedUser.badge_number}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={() => openEditUser(selectedUser)}
                  className="toolbar-btn focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50"
                  aria-label={`Edit ${selectedUser.first_name} ${selectedUser.last_name}`}
                >
                  <Edit className="w-3.5 h-3.5" aria-hidden="true" /> Edit
                </button>
                {/* Suspend / Reactivate quick-actions */}
                {(() => {
                  const rawStatus = ((selectedUser as any).raw_status || (selectedUser.is_active ? 'active' : 'inactive')) as UserStatus;
                  if (rawStatus === 'active' && onStatusChange) {
                    return (
                      <button type="button"
                        onClick={() => setConfirmDlg({
                          title: 'Suspend User',
                          message: `Suspend ${selectedUser.first_name} ${selectedUser.last_name}? Their active sessions will be terminated and they will be unable to log in until reactivated.`,
                          confirmLabel: 'Suspend',
                          confirmVariant: 'warning',
                          onConfirm: () => onStatusChange(selectedUser.id, 'inactive'),
                        })}
                        className="toolbar-btn text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/30"
                        title="Suspend user"
                      >
                        <Ban className="w-3.5 h-3.5" /> Suspend
                      </button>
                    );
                  } else if (rawStatus === 'inactive' && onStatusChange) {
                    return (
                      <button type="button"
                        onClick={() => setConfirmDlg({
                          title: 'Reactivate User',
                          message: `Reactivate ${selectedUser.first_name} ${selectedUser.last_name}? They will be able to log in again.`,
                          confirmLabel: 'Reactivate',
                          confirmVariant: 'default',
                          onConfirm: () => onStatusChange(selectedUser.id, 'active'),
                        })}
                        className="toolbar-btn text-green-400 hover:text-green-300 hover:bg-green-900/30"
                        title="Reactivate user"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Reactivate
                      </button>
                    );
                  }
                  return null;
                })()}
                {(selectedUser as any).totpEnabled ? (
                  <button type="button"
                    onClick={() => setConfirmDlg({
                      title: 'Reset 2FA',
                      message: `Reset two-factor authentication for ${selectedUser.first_name} ${selectedUser.last_name}? They will be prompted to set up 2FA again on their next login. This action is audited.`,
                      confirmLabel: 'Reset 2FA',
                      confirmVariant: 'warning',
                      onConfirm: () => apiFetch(`/admin/users/${selectedUser.id}/totp`, { method: 'DELETE' })
                        .then(() => {
                          setSelectedUser({ ...selectedUser, totpEnabled: false } as any);
                          addToast('2FA reset', 'success');
                        })
                        .catch((err) => {
                          console.warn('[AdminUsersTab] reset 2FA failed:', err);
                          addToast(err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : 'Failed to reset 2FA', 'error');
                        }),
                    })}
                    className="toolbar-btn text-amber-400 hover:text-amber-300 hover:bg-amber-900/30"
                    title="Reset two-factor authentication"
                  >
                    <ShieldOff className="w-3.5 h-3.5" /> Reset 2FA
                  </button>
                ) : null}
                <button type="button"
                  onClick={() => openDeleteUser(selectedUser)}
                  className="toolbar-btn text-red-400 hover:text-red-300 hover:bg-red-900/30"
                  title="Terminate user"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Terminate
                </button>
                <button type="button" onClick={() => setSelectedUser(null)} className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-rmpg-100 transition-colors rounded-sm" aria-label="Close user details">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Detail Tabs */}
          <div className="flex gap-0.5 px-4 pt-2 border-b border-rmpg-700 flex-shrink-0 overflow-x-auto scrollbar-dark" role="tablist" aria-label="User detail sections">
            {([
              { id: 'profile' as const, label: 'Profile' },
              { id: 'personal' as const, label: 'Personal' },
              { id: 'credentials' as const, label: 'Credentials' },
              { id: 'security' as const, label: 'Security' },
              { id: 'activity' as const, label: 'Activity Log' },
              { id: 'email' as const, label: 'Email Integration' },
            ]).map((tab) => (
              <button type="button"
                key={tab.id}
                role="tab"
                aria-selected={userDetailTab === tab.id}
                onClick={() => setUserDetailTab(tab.id)}
                className={`px-3 py-1.5 text-[10px] font-medium transition-all duration-150 whitespace-nowrap relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50 ${
                  userDetailTab === tab.id
                    ? 'bg-surface-raised text-rmpg-100 border border-rmpg-700 border-b-surface-raised'
                    : 'text-rmpg-400 hover:text-rmpg-100 hover:bg-[rgba(42,42,42,0.6)]'
                }`}
              >
                {tab.label}
                {userDetailTab === tab.id && <div className="absolute bottom-0 left-1 right-1 h-[2px] bg-brand-500" aria-hidden="true" />}
              </button>
            ))}
          </div>

          {/* Detail Content */}
          <div className="flex-1 overflow-auto scrollbar-dark p-4 space-y-4" role="tabpanel">
            {/* Profile Tab */}
            {userDetailTab === 'profile' && (
              <>
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3 border-b border-rmpg-700 pb-1.5">Employment Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div><span className="text-rmpg-400">Department:</span> <span className="text-rmpg-200 ml-1">{selectedUser.department || '--'}</span></div>
                    <div><span className="text-rmpg-400">Rank:</span> <span className="text-rmpg-200 ml-1">{selectedUser.rank || '--'}</span></div>
                    <div><span className="text-rmpg-400">Badge #:</span> <span className="text-rmpg-200 font-mono ml-1">{selectedUser.badge_number || '--'}</span></div>
                    <div><span className="text-rmpg-400">Employee ID:</span> <span className="text-rmpg-200 font-mono ml-1">{selectedUser.employee_id || '--'}</span></div>
                    <div><span className="text-rmpg-400">Hire Date:</span> <span className="text-rmpg-200 ml-1">{selectedUser.hire_date || '--'}</span></div>
                    <div><span className="text-rmpg-400">Termination:</span> <span className="text-rmpg-200 ml-1">{selectedUser.termination_date || '--'}</span></div>
                    <div><span className="text-rmpg-400">Status:</span> {(() => {
                      const rawStatus = ((selectedUser as any).raw_status || (selectedUser.is_active ? 'active' : 'inactive')) as UserStatus;
                      const cfg = STATUS_CONFIG[rawStatus] || STATUS_CONFIG.active;
                      return <span className={`ml-1 font-bold ${cfg.color}`}>{cfg.label}</span>;
                    })()}</div>
                    <div><span className="text-rmpg-400">Shift:</span> <span className="text-rmpg-200 ml-1">{selectedUser.shift_preference || '--'}</span></div>
                  </div>
                </div>

                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Contact Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div><span className="text-rmpg-400">Email:</span> <span className="text-rmpg-200 ml-1">{selectedUser.email || '--'}</span></div>
                    <div><span className="text-rmpg-400">Phone:</span> <span className="text-rmpg-200 ml-1">{selectedUser.phone || '--'}</span></div>
                    <div className="col-span-2"><span className="text-rmpg-400">Address:</span> <span className="text-rmpg-200 ml-1">{[selectedUser.address, selectedUser.city, selectedUser.state, selectedUser.zip].filter(Boolean).join(', ') || '--'}</span></div>
                  </div>
                </div>

                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Account Statistics</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div><span className="text-rmpg-400">Last Login:</span> <span className="text-rmpg-200 ml-1">{selectedUser.last_login || selectedUser.last_login_display || '--'}</span></div>
                    <div><span className="text-rmpg-400">Login Count:</span> <span className="text-rmpg-200 ml-1">{selectedUser.login_count ?? '--'}</span></div>
                    <div><span className="text-rmpg-400">Created:</span> <span className="text-rmpg-200 ml-1">{selectedUser.created_at ? parseTimestamp(selectedUser.created_at).toLocaleDateString('en-US', { timeZone: 'America/Denver', year: 'numeric', month: 'short', day: 'numeric' }) : '--'}</span></div>
                  </div>
                </div>

                {selectedUser.notes && (
                  <div className="panel-beveled p-3 bg-surface-base">
                    <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2">Notes</h3>
                    <p className="text-xs text-rmpg-200 leading-relaxed">{selectedUser.notes}</p>
                  </div>
                )}
              </>
            )}

            {/* Personal Tab */}
            {userDetailTab === 'personal' && (
              <>
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Personal Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div><span className="text-rmpg-400">Date of Birth:</span> <span className="text-rmpg-200 ml-1">{selectedUser.date_of_birth || '--'}</span></div>
                    <div><span className="text-rmpg-400">Blood Type:</span> <span className="text-rmpg-200 ml-1">{selectedUser.blood_type || '--'}</span></div>
                    <div><span className="text-rmpg-400">Allergies:</span> <span className="text-rmpg-200 ml-1">{selectedUser.allergies || '--'}</span></div>
                    <div><span className="text-rmpg-400">Uniform Size:</span> <span className="text-rmpg-200 ml-1">{selectedUser.uniform_size || '--'}</span></div>
                  </div>
                </div>

                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Driver License</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div><span className="text-rmpg-400">DL #:</span> <span className="text-rmpg-200 font-mono ml-1">{selectedUser.dl_number || '--'}</span></div>
                    <div><span className="text-rmpg-400">State:</span> <span className="text-rmpg-200 ml-1">{selectedUser.dl_state || '--'}</span></div>
                    <div><span className="text-rmpg-400">Expiry:</span> <span className="text-rmpg-200 ml-1">{selectedUser.dl_expiry || '--'}</span></div>
                  </div>
                </div>

                <div className="panel-beveled p-3 border-l-2 border-l-red-600 bg-surface-base">
                  <h3 className="text-[10px] text-red-400 uppercase font-bold tracking-wider mb-3">Emergency Contact</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div><span className="text-rmpg-400">Name:</span> <span className="text-rmpg-200 ml-1">{selectedUser.emergency_contact_name || '--'}</span></div>
                    <div><span className="text-rmpg-400">Phone:</span> <span className="text-rmpg-200 ml-1">{selectedUser.emergency_contact_phone || '--'}</span></div>
                    <div><span className="text-rmpg-400">Relationship:</span> <span className="text-rmpg-200 ml-1">{selectedUser.emergency_contact_relationship || '--'}</span></div>
                  </div>
                </div>
              </>
            )}

            {/* Credentials Tab */}
            {userDetailTab === 'credentials' && (
              <>
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Certifications & Training</h3>
                  {selectedUser.certifications ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedUser.certifications.split(',').map((cert, i) => (
                        <span key={cert.trim()} className="px-2 py-1 bg-brand-900/30 text-brand-300 text-[10px] font-medium border border-brand-700/40">
                          {cert.trim()}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-rmpg-500">No certifications on file</p>
                  )}
                </div>

                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Password</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div><span className="text-rmpg-400">Last Changed:</span> <span className="text-rmpg-200 ml-1">{selectedUser.last_password_change || '--'}</span></div>
                  </div>
                </div>
              </>
            )}

            {/* Security Tab */}
            {userDetailTab === 'security' && (
              <>
                {/* Role Management */}
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Role & Privileges</h3>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-1 text-[10px] font-semibold uppercase border ${ROLE_COLORS[selectedUser.role]}`}>
                        {toDisplayLabel(selectedUser.role)}
                      </span>
                      {!roleEditing && (
                        <button type="button" onClick={() => { setRoleEditing(true); setPendingRole(selectedUser.role); }} className="toolbar-btn text-[9px]">
                          <Edit className="w-3 h-3" /> Change Role
                        </button>
                      )}
                    </div>
                  </div>
                  {roleEditing && (
                    <div className="mt-3 flex items-center gap-2">
                      <select id="ff-adminuserstab-1"
                        className="input-dark text-xs flex-1 min-h-[36px]"
                        value={pendingRole || selectedUser.role}
                        onChange={(e) => setPendingRole(e.target.value as UserRole)}
                      >
                        {ALL_ROLES.map(r => (
                          <option key={r} value={r}>{toDisplayLabel(r)}</option>
                        ))}
                      </select>
                      <button type="button"
                        onClick={() => pendingRole && handleRoleChange(selectedUser.id, pendingRole)}
                        disabled={securityActionLoading === 'role-change' || pendingRole === selectedUser.role}
                        className="toolbar-btn toolbar-btn-primary text-[9px]"
                      >
                        {securityActionLoading === 'role-change' ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <CheckCircle className="w-3 h-3" />}
                        Apply
                      </button>
                      <button type="button" onClick={() => { setRoleEditing(false); setPendingRole(null); }} className="toolbar-btn text-[9px]">
                        Cancel
                      </button>
                    </div>
                  )}
                  <div className="mt-2 text-[9px] text-rmpg-500">
                    <strong>Privileges:</strong> {selectedUser.role === 'admin' ? 'Full system access — all modules, user management, system settings'
                      : selectedUser.role === 'manager' ? 'Manage users, view all modules, reports, clients, billing'
                      : selectedUser.role === 'supervisor' ? 'Oversee officers, approve reports, view dispatch and patrol'
                      : selectedUser.role === 'officer' ? 'Field operations — incidents, arrests, citations, patrol, MDT'
                      : selectedUser.role === 'dispatcher' ? 'Dispatch operations — calls, units, GPS tracking, comms'
                      : 'Contract and process service management'
                    }
                  </div>
                </div>

                {/* 2FA Status */}
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Two-Factor Authentication</h3>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {(selectedUser as any).totpEnabled ? (
                        <>
                          <span className="led-dot led-green" />
                          <span className="text-xs text-green-400 font-semibold">Enabled</span>
                        </>
                      ) : (selectedUser as any).totpSetupRequired ? (
                        <>
                          <span className="led-dot led-amber" />
                          <span className="text-xs text-amber-400 font-semibold">Setup Required</span>
                        </>
                      ) : (
                        <>
                          <span className="led-dot led-red" />
                          <span className="text-xs text-red-400 font-semibold">Not Configured</span>
                        </>
                      )}
                    </div>
                    <button type="button"
                      onClick={() => handleReset2FA(selectedUser.id)}
                      disabled={securityActionLoading === 'reset-2fa'}
                      className="toolbar-btn text-[9px] flex items-center gap-1"
                    >
                      {securityActionLoading === 'reset-2fa' ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <ShieldOff className="w-3 h-3" />
                      )}
                      Reset 2FA
                    </button>
                  </div>
                  <p className="text-[9px] mt-2" style={{ color: 'var(--text-muted)' }}>
                    Resetting 2FA will delete the user's TOTP secret, backup codes, and trusted devices.
                  </p>
                </div>

                {/* Password Security */}
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Password Security</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mb-3">
                    <div>
                      <span className="text-rmpg-400">Last Changed:</span>
                      <span className="text-rmpg-200 ml-1">
                        {(selectedUser as any).passwordChangedAt
                          ? new Date((selectedUser as any).passwordChangedAt).toLocaleDateString()
                          : selectedUser.last_password_change || '--'}
                      </span>
                    </div>
                    <div>
                      <span className="text-rmpg-400">Expires:</span>
                      <span className={`ml-1 font-semibold ${
                        (selectedUser as any).passwordExpiringSoon ? 'text-amber-400' : 'text-rmpg-200'
                      }`}>
                        {(selectedUser as any).passwordExpiresAt
                          ? new Date((selectedUser as any).passwordExpiresAt).toLocaleDateString()
                          : 'No expiry set'}
                      </span>
                    </div>
                    <div>
                      <span className="text-rmpg-400">Force Change:</span>
                      <span className={`ml-1 font-semibold ${(selectedUser as any).forcePasswordChange ? 'text-amber-400' : 'text-rmpg-200'}`}>
                        {(selectedUser as any).forcePasswordChange ? 'Yes \u2014 on next login' : 'No'}
                      </span>
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => handleForcePasswordChange(selectedUser.id)}
                    disabled={securityActionLoading === 'force-pw'}
                    className="toolbar-btn text-[9px] flex items-center gap-1"
                  >
                    {securityActionLoading === 'force-pw' ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <KeyRound className="w-3 h-3" />
                    )}
                    Force Password Change
                  </button>
                </div>

                {/* Security Questions ("Forgot password?" recovery setup) */}
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Security Questions</h3>
                  {sqAdminLoading ? (
                    <div className="flex items-center gap-2 text-[10px] text-rmpg-500">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`led-dot ${sqAdminConfigured ? 'led-green' : 'led-red'}`} />
                        <span className={`text-xs font-semibold ${sqAdminConfigured ? 'text-green-400' : 'text-red-400'}`}>
                          {sqAdminConfigured ? 'Configured' : 'Not Configured'}
                        </span>
                      </div>
                      {sqAdminConfigured && sqAdminQuestions.length > 0 && (
                        <ul className="text-[10px] text-rmpg-400 mb-3 space-y-1 list-disc list-inside">
                          {sqAdminQuestions.map((q, i) => <li key={i}>{q}</li>)}
                        </ul>
                      )}
                      <p className="text-[9px] mb-3" style={{ color: 'var(--text-muted)' }}>
                        Answers are hashed and never shown here. Clear them if the user is locked out
                        of "Forgot password?" or the questions/answers may be compromised — the user
                        will need to set up new ones from their profile's Security tab.
                      </p>
                      <button type="button"
                        onClick={() => setConfirmDlg({
                          title: 'Clear Security Questions',
                          message: `Clear security questions for ${selectedUser.first_name} ${selectedUser.last_name}? They will need to set up new ones before "Forgot password?" works again. This action is audited.`,
                          confirmLabel: 'Clear Questions',
                          confirmVariant: 'warning',
                          onConfirm: () => handleClearSecurityQuestions(selectedUser.id),
                        })}
                        disabled={!sqAdminConfigured || securityActionLoading === 'clear-security-questions'}
                        className="toolbar-btn text-[9px] flex items-center gap-1"
                      >
                        {securityActionLoading === 'clear-security-questions' ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <HelpCircle className="w-3 h-3" />
                        )}
                        Clear Security Questions
                      </button>
                    </>
                  )}
                </div>

                {/* Active Sessions */}
                <div className="panel-beveled p-3 bg-surface-base">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">
                      Active Sessions ({userSessions.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <button type="button"
                        onClick={() => loadUserSessions(selectedUser.id)}
                        disabled={loadingSessions}
                        className="toolbar-btn text-[9px] flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${loadingSessions ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                      {userSessions.length > 0 && (
                        <button type="button"
                          onClick={() => setConfirmDlg({
                            title: 'Revoke All Sessions',
                            message: `Revoke all ${userSessions.length} active session${userSessions.length === 1 ? '' : 's'} for ${selectedUser.first_name} ${selectedUser.last_name}? They will be logged out from every device immediately. This action is audited.`,
                            confirmLabel: 'Revoke All',
                            confirmVariant: 'danger',
                            onConfirm: () => handleRevokeAllSessions(selectedUser.id),
                          })}
                          disabled={securityActionLoading === 'revoke-sessions'}
                          className="toolbar-btn text-[9px] text-red-400 hover:text-red-300 hover:bg-red-900/30 flex items-center gap-1"
                        >
                          {securityActionLoading === 'revoke-sessions' ? (
                            <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
                          ) : (
                            <LogOut className="w-3 h-3" />
                          )}
                          Revoke All
                        </button>
                      )}
                    </div>
                  </div>
                  {loadingSessions ? (
                    <div className="flex items-center gap-2 py-3"><Loader2 className="w-3 h-3 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[11px] text-rmpg-400">Loading sessions...</span></div>
                  ) : userSessions.length > 0 ? (
                    <div className="space-y-1.5">
                      {userSessions.map((session) => (
                        <div key={session.session_id} className="flex items-center gap-3 px-2.5 py-2 bg-surface-raised border border-rmpg-700 text-xs">
                          <Monitor className="w-3.5 h-3.5 text-rmpg-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-rmpg-200 font-medium truncate">{session.device_name || 'Unknown Device'}</div>
                            <div className="flex items-center gap-3 text-[9px] text-rmpg-500 mt-0.5 flex-wrap">
                              <span className="flex items-center gap-1"><Globe className="w-2.5 h-2.5" />{session.ip_address}</span>
                              {session.location && (
                                <span className="flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{session.location}</span>
                              )}
                              {session.isp && (
                                <span className="flex items-center gap-1"><Wifi className="w-2.5 h-2.5" />{session.isp}</span>
                              )}
                              {session.device_latitude && session.device_longitude && (
                                <span className="flex items-center gap-1" title="Device-reported GPS (browser navigator.geolocation), distinct from the IP-derived location above">
                                  <MapPin className="w-2.5 h-2.5 text-green-400" />
                                  GPS {Number(session.device_latitude).toFixed(4)}, {Number(session.device_longitude).toFixed(4)}
                                  {session.device_geo_accuracy_m && ` (±${Math.round(Number(session.device_geo_accuracy_m))}m)`}
                                </span>
                              )}
                              <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{session.last_used_at ? parseTimestamp(session.last_used_at).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'}</span>
                            </div>
                          </div>
                          {!!session.likely_vpn_or_hosting && (
                            <span className="text-[8px] font-bold uppercase text-amber-400 border border-amber-700/50 bg-amber-900/20 px-1 py-0.5 flex-shrink-0" title="Connecting IP's network organization looks like a VPN or hosting/datacenter provider — heuristic, not certain">
                              VPN?
                            </span>
                          )}
                          <span className="led-dot led-green flex-shrink-0" title="Active" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-rmpg-500 py-2">No active sessions</p>
                  )}
                </div>

                {/* Action result message */}
                {securityMsg && (
                  <div className={`flex items-center gap-2 px-3 py-2 text-xs ${
                    securityMsg.type === 'success'
                      ? 'text-green-400 bg-green-900/20 border border-green-800/40'
                      : 'text-red-400 bg-red-900/20 border border-red-800/40'
                  }`}>
                    {securityMsg.type === 'success' ? (
                      <CheckCircle className="w-3 h-3 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    )}
                    {securityMsg.text}
                  </div>
                )}
              </>
            )}

            {/* Activity Log Tab */}
            {userDetailTab === 'activity' && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">
                  Recent Activity ({userActivity.length})
                </h3>
                {loadingUserActivity ? (
                  <div className="flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[11px] text-rmpg-400">Loading...</span></div>
                ) : userActivity.length > 0 ? (
                  <div className="space-y-1">
                    {userActivity.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-3 text-xs px-2 py-1.5 bg-surface-raised border border-rmpg-700">
                        <span className="text-rmpg-400 font-mono text-[10px] flex-shrink-0">
                          {safeDateTimeStr(entry.timestamp)}
                        </span>
                        <span className="text-brand-400 font-medium">{toDisplayLabel(entry.action)}</span>
                        <span className="text-rmpg-300 min-w-0 flex-1 truncate">{formatActivityDetails(entry.details)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-rmpg-500">No activity recorded</p>
                )}
              </div>
            )}

            {/* Email Integration Tab */}
            {userDetailTab === 'email' && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Microsoft 365 Business Email</h3>
                {emailStatusLoading ? (
                  <div className="flex items-center gap-2 text-[10px] text-fg-muted py-3">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                  </div>
                ) : emailStatus?.connected ? (
                  <div className="py-6 text-center border border-dashed border-rmpg-700">
                    <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-3" />
                    <p className="text-sm text-rmpg-200 font-medium">Mailbox Connected</p>
                    {emailStatus.mailbox && (
                      <p className="text-[11px] text-fg-secondary mt-1">{emailStatus.mailbox}</p>
                    )}
                    <p className="text-[10px] text-fg-muted mt-2 max-w-sm mx-auto">
                      This user has authorized RMPG Flex to access their Microsoft 365 mailbox for
                      the in-app Email module. To disconnect it, the user must do so from their own
                      Email settings — an admin cannot revoke another officer's mailbox grant here.
                    </p>
                  </div>
                ) : (
                  <div className="py-8 text-center border border-dashed border-rmpg-700">
                    <Settings className="w-8 h-8 text-fg-muted mx-auto mb-3" />
                    <p className="text-sm text-fg-secondary font-medium">Not Connected</p>
                    <p className="text-[11px] text-fg-muted mt-1 max-w-sm mx-auto">
                      This user has not connected a Microsoft 365 mailbox. They can do so from their
                      own Email module ("Connect Mailbox"). Microsoft 365 integration requires Azure
                      AD application registration and admin consent for this deployment.
                    </p>
                    <div className="mt-3 text-[10px] text-fg-muted space-y-0.5">
                      <p>Required: Azure AD App ID, Client Secret, Tenant ID</p>
                      <p>Configure in Admin &rarr; System &rarr; Integrations</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Centralized destructive-action confirm — Suspend / Reactivate /
          Reset 2FA / Revoke Sessions all flow through here. The dialog
          handles Esc, focus trap, and the day/night surface; the old
          window.confirm() did none of these. */}
      <ConfirmDialog
        isOpen={!!confirmDlg}
        onClose={() => { if (!confirmDlgLoading) setConfirmDlg(null); }}
        onConfirm={runConfirmDlg}
        title={confirmDlg?.title || ''}
        message={confirmDlg instanceof Error ? confirmDlg.message : ''}
        confirmLabel={confirmDlg?.confirmLabel || 'Confirm'}
        confirmVariant={confirmDlg?.confirmVariant || 'danger'}
        isLoading={confirmDlgLoading}
      />
    </div>
  );
}
