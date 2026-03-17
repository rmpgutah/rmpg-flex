import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import type { User, UserRole } from '../../types';
import type { UserFormData } from '../../components/UserFormModal';
import { toDisplayLabel } from '../../utils/formatters';
import { apiFetch } from '../../hooks/useApi';

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

interface UserSession {
  id: number;
  user_id: number;
  session_id: string;
  ip_address: string;
  user_agent: string;
  device_name: string;
  is_active: number;
  created_at: string;
  last_used_at: string;
}

const ALL_ROLES: UserRole[] = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-red-900/50 text-red-400 border-red-700/50',
  manager: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  supervisor: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  officer: 'bg-brand-900/50 text-brand-400 border-brand-700/50',
  dispatcher: 'bg-green-900/50 text-green-400 border-green-700/50',
  client_viewer: 'bg-teal-900/50 text-teal-400 border-teal-700/50',
  contract_manager: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
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
  setSelectedUser: (user: (User & { last_login_display?: string }) | null) => void;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [userDetailTab, setUserDetailTab] = useState<'profile' | 'personal' | 'credentials' | 'security' | 'activity' | 'email'>('profile');
  const [securityActionLoading, setSecurityActionLoading] = useState<string | null>(null);
  const [securityMsg, setSecurityMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [userSessions, setUserSessions] = useState<UserSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [roleEditing, setRoleEditing] = useState(false);
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);

  const handleReset2FA = async (userId: string) => {
    setSecurityActionLoading('reset-2fa');
    setSecurityMsg(null);
    try {
      await apiFetch(`/admin/users/${userId}/reset-2fa`, { method: 'POST' });
      setSecurityMsg({ type: 'success', text: '2FA has been reset. User will be prompted to set up 2FA on next login.' });
    } catch (err: any) {
      setSecurityMsg({ type: 'error', text: err.message || 'Failed to reset 2FA' });
    }
    setSecurityActionLoading(null);
  };

  // Load active sessions for a user when the Security tab is shown
  const loadUserSessions = useCallback(async (userId: string) => {
    setLoadingSessions(true);
    try {
      const sessions = await apiFetch<UserSession[]>('/admin/sessions');
      setUserSessions((sessions || []).filter((s: UserSession) => String(s.user_id || (s as any).userId) === String(userId) && s.is_active));
    } catch {
      setUserSessions([]);
    }
    setLoadingSessions(false);
  }, []);

  // Load sessions when security tab is opened
  useEffect(() => {
    if (selectedUser && userDetailTab === 'security') {
      loadUserSessions(selectedUser.id);
    }
  }, [selectedUser?.id, userDetailTab, loadUserSessions]);

  const handleRevokeAllSessions = async (userId: string) => {
    setSecurityActionLoading('revoke-sessions');
    setSecurityMsg(null);
    try {
      const result = await apiFetch<{ message: string; count: number }>(`/admin/users/${userId}/revoke-sessions`, { method: 'POST' });
      setSecurityMsg({ type: 'success', text: result.message || `All sessions revoked.` });
      setUserSessions([]);
    } catch (err: any) {
      setSecurityMsg({ type: 'error', text: err.message || 'Failed to revoke sessions' });
    }
    setSecurityActionLoading(null);
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setSecurityActionLoading('role-change');
    setSecurityMsg(null);
    try {
      const result = await apiFetch<{ message: string }>(`/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      setSecurityMsg({ type: 'success', text: result.message || `Role changed to ${newRole}` });
      setRoleEditing(false);
      setPendingRole(null);
      // Update local state
      if (selectedUser) {
        setSelectedUser({ ...selectedUser, role: newRole } as any);
      }
    } catch (err: any) {
      setSecurityMsg({ type: 'error', text: err.message || 'Failed to change role' });
    }
    setSecurityActionLoading(null);
  };

  const handleForcePasswordChange = async (userId: string) => {
    setSecurityActionLoading('force-pw');
    setSecurityMsg(null);
    try {
      await apiFetch(`/admin/users/${userId}/force-password-change`, { method: 'POST' });
      setSecurityMsg({ type: 'success', text: 'User will be required to change their password on next login.' });
    } catch (err: any) {
      setSecurityMsg({ type: 'error', text: err.message || 'Failed to force password change' });
    }
    setSecurityActionLoading(null);
  };

  const handleAdminResetPassword = async (userId: string) => {
    const newPassword = prompt('Enter new temporary password for this user (min 8 characters):');
    if (!newPassword || newPassword.trim().length < 8) {
      if (newPassword !== null) setSecurityMsg({ type: 'error', text: 'Password must be at least 8 characters.' });
      return;
    }
    setSecurityActionLoading('reset-pw');
    setSecurityMsg(null);
    try {
      await apiFetch(`/admin/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: newPassword.trim() }),
      });
      setSecurityMsg({ type: 'success', text: 'Password reset. User must change it on next login. Login lockout cleared.' });
    } catch (err: any) {
      setSecurityMsg({ type: 'error', text: err.message || 'Failed to reset password' });
    }
    setSecurityActionLoading(null);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: User List */}
      <div className={`${selectedUser ? 'w-[40%]' : 'w-full'} border-r border-rmpg-600 flex flex-col overflow-hidden transition-all`}>
        <div className="px-4 py-3 flex items-center justify-between border-b border-rmpg-600 flex-shrink-0">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
            <input
              type="text"
              className="input-dark pl-9 text-xs"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="toolbar-btn toolbar-btn-primary" onClick={openAddUser}>
            <Plus className="w-3.5 h-3.5" /> Add User
          </button>
        </div>

        {loadingUsers ? (
          <LoadingSpinner />
        ) : (
          <div className="flex-1 overflow-auto">
            {users
              .filter((u) => {
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (
                  u.username.toLowerCase().includes(q) ||
                  `${u.first_name} ${u.last_name}`.toLowerCase().includes(q) ||
                  u.email.toLowerCase().includes(q)
                );
              })
              .map((user) => (
                <div
                  key={user.id}
                  onClick={() => { setSelectedUser(selectedUser?.id === user.id ? null : user); setUserDetailTab('profile'); }}
                  className={`px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-colors ${
                    selectedUser?.id === user.id
                      ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                      : 'hover:bg-rmpg-700/30 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex-shrink-0 w-9 h-9 rounded-full border flex items-center justify-center text-xs font-bold ${
                      user.is_active ? 'bg-rmpg-700 border-rmpg-600 text-rmpg-300' : 'bg-rmpg-800 border-rmpg-700 text-rmpg-500'
                    }`}>
                      {user.first_name?.[0]}{user.last_name?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">
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
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditUser(user); }}
                        className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            {users.length === 0 && !loadingUsers && (
              <div className="text-center text-rmpg-400 py-12">No users found</div>
            )}
          </div>
        )}
      </div>

      {/* Right: User Detail Panel */}
      {selectedUser && (
        <div className="w-[60%] flex flex-col overflow-hidden">
          {/* Detail Header */}
          <div className="p-4 border-b border-rmpg-600 bg-surface-sunken flex-shrink-0">
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
                  <h2 className="text-lg font-bold text-white">
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
                <button
                  onClick={() => openEditUser(selectedUser)}
                  className="toolbar-btn"
                >
                  <Edit className="w-3.5 h-3.5" /> Edit
                </button>
                {/* Suspend / Reactivate quick-actions */}
                {(() => {
                  const rawStatus = ((selectedUser as any).raw_status || (selectedUser.is_active ? 'active' : 'inactive')) as UserStatus;
                  if (rawStatus === 'active' && onStatusChange) {
                    return (
                      <button
                        onClick={() => { if (window.confirm(`Suspend ${selectedUser.first_name} ${selectedUser.last_name}? Their sessions will be terminated.`)) onStatusChange(selectedUser.id, 'inactive'); }}
                        className="toolbar-btn text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/30"
                        title="Suspend user"
                      >
                        <Ban className="w-3.5 h-3.5" /> Suspend
                      </button>
                    );
                  } else if (rawStatus === 'inactive' && onStatusChange) {
                    return (
                      <button
                        onClick={() => { if (window.confirm(`Reactivate ${selectedUser.first_name} ${selectedUser.last_name}?`)) onStatusChange(selectedUser.id, 'active'); }}
                        className="toolbar-btn text-green-400 hover:text-green-300 hover:bg-green-900/30"
                        title="Reactivate user"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Reactivate
                      </button>
                    );
                  }
                  return null;
                })()}
                {(selectedUser as any).totp_enabled ? (
                  <button
                    onClick={() => {
                      if (window.confirm(`Reset 2FA for ${selectedUser.first_name} ${selectedUser.last_name}? They will need to set up 2FA again.`))
                        apiFetch(`/admin/users/${selectedUser.id}/totp`, { method: 'DELETE' })
                          .then(() => { (selectedUser as any).totp_enabled = false; setSelectedUser({ ...selectedUser }); })
                          .catch((err) => { console.warn('[AdminUsersTab] reset 2FA failed:', err); });
                    }}
                    className="toolbar-btn text-amber-400 hover:text-amber-300 hover:bg-amber-900/30"
                    title="Reset two-factor authentication"
                  >
                    <ShieldOff className="w-3.5 h-3.5" /> Reset 2FA
                  </button>
                ) : null}
                <button
                  onClick={() => openDeleteUser(selectedUser)}
                  className="toolbar-btn text-red-400 hover:text-red-300 hover:bg-red-900/30"
                  title="Terminate user"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Terminate
                </button>
                <button onClick={() => setSelectedUser(null)} className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-white transition-colors">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Detail Tabs */}
          <div className="flex gap-1 px-4 pt-2 border-b border-rmpg-600 flex-shrink-0">
            {([
              { id: 'profile' as const, label: 'Profile' },
              { id: 'personal' as const, label: 'Personal' },
              { id: 'credentials' as const, label: 'Credentials' },
              { id: 'security' as const, label: 'Security' },
              { id: 'activity' as const, label: 'Activity Log' },
              { id: 'email' as const, label: 'Email Integration' },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setUserDetailTab(tab.id)}
                className={`px-3 py-1.5 text-[10px] font-medium transition-colors ${
                  userDetailTab === tab.id
                    ? 'bg-rmpg-700 text-white border border-rmpg-600 border-b-rmpg-700'
                    : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Detail Content */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* Profile Tab */}
            {userDetailTab === 'profile' && (
              <>
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Employment Information</h3>
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
                    <div><span className="text-rmpg-400">Created:</span> <span className="text-rmpg-200 ml-1">{selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '--'}</span></div>
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
                        <span key={i} className="px-2 py-1 bg-brand-900/30 text-brand-300 text-[10px] font-medium border border-brand-700/40">
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
                        <button onClick={() => { setRoleEditing(true); setPendingRole(selectedUser.role); }} className="toolbar-btn text-[9px]">
                          <Edit className="w-3 h-3" /> Change Role
                        </button>
                      )}
                    </div>
                  </div>
                  {roleEditing && (
                    <div className="mt-3 flex items-center gap-2">
                      <select
                        className="input-dark text-xs flex-1"
                        value={pendingRole || selectedUser.role}
                        onChange={(e) => setPendingRole(e.target.value as UserRole)}
                      >
                        {ALL_ROLES.map(r => (
                          <option key={r} value={r}>{toDisplayLabel(r)}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => pendingRole && handleRoleChange(selectedUser.id, pendingRole)}
                        disabled={securityActionLoading === 'role-change' || pendingRole === selectedUser.role}
                        className="toolbar-btn toolbar-btn-primary text-[9px]"
                      >
                        {securityActionLoading === 'role-change' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        Apply
                      </button>
                      <button onClick={() => { setRoleEditing(false); setPendingRole(null); }} className="toolbar-btn text-[9px]">
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
                    <button
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
                  <p className="text-[9px] mt-2" style={{ color: '#4b5563' }}>
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
                  <button
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
                  <button
                    onClick={() => handleAdminResetPassword(selectedUser.id)}
                    disabled={securityActionLoading === 'reset-pw'}
                    className="toolbar-btn toolbar-btn-primary text-[9px] flex items-center gap-1"
                  >
                    {securityActionLoading === 'reset-pw' ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <KeyRound className="w-3 h-3" />
                    )}
                    Reset Password
                  </button>
                </div>

                {/* Active Sessions */}
                <div className="panel-beveled p-3 bg-surface-base">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">
                      Active Sessions ({userSessions.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => loadUserSessions(selectedUser.id)}
                        disabled={loadingSessions}
                        className="toolbar-btn text-[9px] flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${loadingSessions ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                      {userSessions.length > 0 && (
                        <button
                          onClick={() => {
                            if (window.confirm(`Revoke all ${userSessions.length} active sessions for ${selectedUser.first_name} ${selectedUser.last_name}? They will be logged out from all devices.`))
                              handleRevokeAllSessions(selectedUser.id);
                          }}
                          disabled={securityActionLoading === 'revoke-sessions'}
                          className="toolbar-btn text-[9px] text-red-400 hover:text-red-300 hover:bg-red-900/30 flex items-center gap-1"
                        >
                          {securityActionLoading === 'revoke-sessions' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <LogOut className="w-3 h-3" />
                          )}
                          Revoke All
                        </button>
                      )}
                    </div>
                  </div>
                  {loadingSessions ? (
                    <div className="flex items-center gap-2 py-3"><Loader2 className="w-3 h-3 animate-spin text-brand-400" /><span className="text-[11px] text-rmpg-400">Loading sessions...</span></div>
                  ) : userSessions.length > 0 ? (
                    <div className="space-y-1.5">
                      {userSessions.map((session) => (
                        <div key={session.session_id} className="flex items-center gap-3 px-2.5 py-2 bg-surface-raised border border-rmpg-700 text-xs">
                          <Monitor className="w-3.5 h-3.5 text-rmpg-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-rmpg-200 font-medium truncate">{session.device_name || 'Unknown Device'}</div>
                            <div className="flex items-center gap-3 text-[9px] text-rmpg-500 mt-0.5">
                              <span className="flex items-center gap-1"><Globe className="w-2.5 h-2.5" />{session.ip_address}</span>
                              <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{session.last_used_at ? new Date(session.last_used_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'}</span>
                            </div>
                          </div>
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
                  <div className="flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin text-brand-400" /><span className="text-[11px] text-rmpg-400">Loading...</span></div>
                ) : userActivity.length > 0 ? (
                  <div className="space-y-1">
                    {userActivity.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-3 text-xs px-2 py-1.5 bg-surface-raised border border-rmpg-700">
                        <span className="text-rmpg-400 font-mono text-[10px] flex-shrink-0">
                          {new Date(entry.timestamp).toLocaleString('en-US', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
                          })}
                        </span>
                        <span className="text-brand-400 font-medium">{entry.action}</span>
                        <span className="text-rmpg-300 flex-1 truncate">{entry.details}</span>
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
                <div className="py-8 text-center border border-dashed border-rmpg-700">
                  <Settings className="w-8 h-8 text-rmpg-500 mx-auto mb-3" />
                  <p className="text-sm text-rmpg-300 font-medium">Email Integration Coming Soon</p>
                  <p className="text-[11px] text-rmpg-500 mt-1 max-w-sm mx-auto">
                    Microsoft 365 business email connection will be established when online live integration between dispatchers and officers is implemented.
                  </p>
                  <button className="toolbar-btn mt-4 opacity-50 cursor-not-allowed" disabled>
                    Connect Microsoft 365
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
