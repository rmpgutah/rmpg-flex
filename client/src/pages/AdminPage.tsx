import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings,
  Users,
  Building2,
  Cog,
  ScrollText,
  Loader2,
  AlertCircle,
  XCircle,
  Activity,
  Megaphone,
  Archive,
  Network,
  Zap,
  Link2,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import UserFormModal, { type UserFormData } from '../components/UserFormModal';
import ClientFormModal from '../components/ClientFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import type { User, Client, UserRole } from '../types';

// Tab components
import AdminUsersTab from './admin/AdminUsersTab';
import AdminClientsTab from './admin/AdminClientsTab';
import AdminSystemTab from './admin/AdminSystemTab';
import AdminAuditTab from './admin/AdminAuditTab';
import AdminHealthTab from './admin/AdminHealthTab';
import AdminAnnouncementsTab from './admin/AdminAnnouncementsTab';
import AdminRetentionTab from './admin/AdminRetentionTab';
import AdminDepartmentsTab from './admin/AdminDepartmentsTab';
import AdminNotifRulesTab from './admin/AdminNotifRulesTab';
import AdminServeManagerTab from './admin/AdminServeManagerTab';

// ============================================================
// Shared sub-components (module-level to avoid remounting)
// ============================================================

const LoadingSpinner: React.FC = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
    <span className="ml-2 text-sm text-rmpg-300">Loading...</span>
  </div>
);

function ErrorBanner({ error, setError }: { error: string | null; setError: (e: string | null) => void }) {
  if (!error) return null;
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-700/50 text-red-400 text-xs">
      <AlertCircle className="w-4 h-4 shrink-0" />
      {error}
      <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
        <XCircle className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ============================================================
// Backend response shapes
// ============================================================

interface PersonnelRow extends Record<string, any> {
  id: string;
  username: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  email: string;
  role: UserRole;
  badge_number?: string;
  phone?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ClientRow {
  id: string;
  name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  contract_start?: string;
  contract_end?: string;
  sla_response_minutes?: number;
  notes?: string;
  status: string;
  property_count?: number;
  created_at: string;
  updated_at: string;
}

interface AuditRow {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  user_name: string;
  created_at: string;
}

// ============================================================
// Mappers
// ============================================================

function mapPersonnelToUser(row: PersonnelRow): User & { last_login_display?: string } {
  // Use server-provided first_name/last_name if available, otherwise derive from full_name
  const first_name = row.first_name || (row.full_name || '').trim().split(/\s+/)[0] || '';
  const last_name = row.last_name || (row.full_name || '').trim().split(/\s+/).slice(1).join(' ') || '';

  // Spread all server fields through so no data is lost (profile_image, notes, etc.)
  const { status, full_name, totp_enabled, totp_setup_required, password_expires_at, force_password_change, password_changed_at, ...rest } = row as PersonnelRow & Record<string, any>;
  return {
    ...rest,
    first_name,
    last_name,
    full_name: full_name || `${first_name} ${last_name}`.trim(),
    is_active: status === 'active',
    // Map snake_case security fields to camelCase for UI components
    totpEnabled: totp_enabled === 1,
    totpSetupRequired: totp_setup_required === 1,
    passwordExpiresAt: password_expires_at || undefined,
    forcePasswordChange: force_password_change === 1,
    passwordChangedAt: password_changed_at || undefined,
  };
}

function mapClientRowToClient(row: ClientRow & Record<string, any>): Client & { property_count?: number } {
  return {
    id: row.id,
    name: row.name,
    client_code: row.client_code || undefined,
    industry: row.industry || undefined,
    website: row.website || undefined,
    contact_name: row.contact_name || '',
    contact_email: row.contact_email || '',
    contact_phone: row.contact_phone || '',
    address: row.address || '',
    billing_email: row.billing_email || undefined,
    billing_address: row.billing_address || undefined,
    tax_id: row.tax_id || undefined,
    payment_method: row.payment_method || undefined,
    billing_cycle: row.billing_cycle || undefined,
    billing_day: row.billing_day != null ? Number(row.billing_day) : undefined,
    contract_start: row.contract_start,
    contract_end: row.contract_end,
    contract_type: row.contract_type || undefined,
    contract_value: row.contract_value != null ? Number(row.contract_value) : undefined,
    payment_terms: row.payment_terms || undefined,
    auto_renew: !!row.auto_renew,
    sla_response_minutes: row.sla_response_minutes != null ? Number(row.sla_response_minutes) : undefined,
    discount_percent: row.discount_percent != null ? Number(row.discount_percent) : undefined,
    late_fee_percent: row.late_fee_percent != null ? Number(row.late_fee_percent) : undefined,
    total_invoiced: row.total_invoiced != null ? Number(row.total_invoiced) : undefined,
    total_paid: row.total_paid != null ? Number(row.total_paid) : undefined,
    outstanding_balance: row.outstanding_balance != null ? Number(row.outstanding_balance) : undefined,
    incident_count: row.incident_count != null ? Number(row.incident_count) : undefined,
    last_incident_date: row.last_incident_date || undefined,
    account_manager: row.account_manager || undefined,
    priority_client: !!row.priority_client,
    client_since: row.client_since || undefined,
    is_active: row.status === 'active',
    notes: row.notes,
    property_count: row.property_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface AuditEntry {
  id: string;
  user: string;
  action: string;
  details: string;
  timestamp: string;
}

function mapAuditRow(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    user: row.user_name || 'system',
    action: row.action,
    details: row.details || `${row.entity_type} ${row.entity_id}`,
    timestamp: row.created_at,
  };
}

// ============================================================
// Constants
// ============================================================

type TabId = 'users' | 'clients' | 'system' | 'audit' | 'health' | 'announcements' | 'retention' | 'departments' | 'notif_rules' | 'servemanager';

const LS_ADMIN_TAB = 'rmpg_admin_tab';

// ============================================================
// Component
// ============================================================

export default function AdminPage() {
  // Ref to suppress LiveSync refresh while a client inline edit is pending save
  const clientEditPendingRef = useRef(false);

  // Restore active tab from localStorage (default: 'users')
  const [activeTab, setActiveTabState] = useState<TabId>(() => {
    try {
      const saved = localStorage.getItem(LS_ADMIN_TAB);
      if (saved && ['users', 'clients', 'system', 'audit', 'health', 'announcements', 'retention', 'departments', 'notif_rules', 'servemanager'].includes(saved)) return saved as TabId;
    } catch { /* ignore */ }
    return 'users';
  });
  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabState(tab);
    try { localStorage.setItem(LS_ADMIN_TAB, tab); } catch { /* ignore */ }
  }, []);

  // --- Data states ---
  const [users, setUsers] = useState<(User & { last_login_display?: string })[]>([]);
  const [clients, setClients] = useState<(Client & { property_count?: number })[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  // --- Loading / error ---
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Selected user detail ---
  const [selectedUser, setSelectedUser] = useState<(User & { last_login_display?: string }) | null>(null);
  const [userActivity, setUserActivity] = useState<AuditEntry[]>([]);
  const [loadingUserActivity, setLoadingUserActivity] = useState(false);

  // --- Modals ---
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<(User & { last_login_display?: string }) | null>(null);
  const [userSubmitting, setUserSubmitting] = useState(false);

  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<(Client & { property_count?: number }) | null>(null);
  const [clientSubmitting, setClientSubmitting] = useState(false);

  // Client detail state
  const [selectedClient, setSelectedClient] = useState<(Client & { property_count?: number }) | null>(null);

  // Delete confirm states
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [userDeleteConfirmOpen, setUserDeleteConfirmOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<(User & { last_login_display?: string }) | null>(null);
  const [userDeleteLoading, setUserDeleteLoading] = useState(false);

  // ============================================================
  // Fetch helpers
  // ============================================================

  const fetchUsers = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent;
    if (!silent) {
      setLoadingUsers(true);
      setError(null);
    }
    try {
      const rows = await apiFetch<PersonnelRow[]>('/personnel');
      setUsers((Array.isArray(rows) ? rows : []).map(mapPersonnelToUser));
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      if (!silent) setLoadingUsers(false);
    }
  }, []);

  // Fetch user activity when a user is selected
  useEffect(() => {
    if (selectedUser) {
      setLoadingUserActivity(true);
      apiFetch<{ data: AuditRow[] }>(`/comms/activity-feed?user_id=${selectedUser.id}&limit=50`)
        .then((res) => setUserActivity((Array.isArray(res?.data) ? res.data : []).map(mapAuditRow)))
        .catch(() => setUserActivity([]))
        .finally(() => setLoadingUserActivity(false));
    } else {
      setUserActivity([]);
    }
  }, [selectedUser?.id]);

  const fetchClients = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent;
    if (!silent) {
      setLoadingClients(true);
      setError(null);
    }
    try {
      const rows = await apiFetch<ClientRow[]>('/admin/clients');
      setClients((Array.isArray(rows) ? rows : []).map(mapClientRowToClient));
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load clients');
    } finally {
      if (!silent) setLoadingClients(false);
    }
  }, []);

  const fetchAuditLog = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent;
    if (!silent) {
      setLoadingAudit(true);
      setError(null);
    }
    try {
      const res = await apiFetch<{ data: AuditRow[] }>('/comms/activity-feed');
      setAuditLog((Array.isArray(res?.data) ? res.data : []).map(mapAuditRow));
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      if (!silent) setLoadingAudit(false);
    }
  }, []);

  // ============================================================
  // Load data when tab changes
  // ============================================================

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
    else if (activeTab === 'clients') fetchClients();
    else if (activeTab === 'system') { if (users.length === 0) fetchUsers(); }
    else if (activeTab === 'audit') fetchAuditLog();
  }, [activeTab, fetchUsers, fetchClients, fetchAuditLog]);

  // Live sync — auto-refresh when any device modifies admin data
  // Uses silent mode so loading spinners don't unmount the UI (prevents focus loss while typing)
  const refreshAdmin = useCallback(() => {
    if (activeTab === 'users') fetchUsers({ silent: true });
    else if (activeTab === 'clients') {
      // Skip LiveSync refresh if user has an unsaved inline edit
      if (!clientEditPendingRef.current) fetchClients({ silent: true });
    }
    else if (activeTab === 'audit') fetchAuditLog({ silent: true });
  }, [activeTab, fetchUsers, fetchClients, fetchAuditLog]);
  useLiveSync('admin', refreshAdmin);

  // ============================================================
  // User CRUD handlers
  // ============================================================

  const handleUserSubmit = async (data: UserFormData) => {
    setUserSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        full_name: data.full_name || `${data.first_name} ${data.last_name}`.trim(),
        first_name: data.first_name,
        last_name: data.last_name,
        middle_name: data.middle_name,
        email: data.email,
        role: data.role,
        badge_number: data.badge_number,
        phone: data.phone,
        department: data.department,
        rank: data.rank,
        employee_id: data.employee_id,
        hire_date: data.hire_date,
        termination_date: data.termination_date,
        shift_preference: data.shift_preference,
        address: data.address,
        city: data.city,
        state: data.state,
        zip: data.zip,
        date_of_birth: data.date_of_birth,
        emergency_contact_name: data.emergency_contact_name,
        emergency_contact_phone: data.emergency_contact_phone,
        emergency_contact_relationship: data.emergency_contact_relationship,
        blood_type: data.blood_type,
        allergies: data.allergies,
        uniform_size: data.uniform_size,
        dl_number: data.dl_number,
        dl_state: data.dl_state,
        dl_expiry: data.dl_expiry,
        certifications: data.certifications,
        notes: data.notes,
        profile_image: data.profile_image,
      };

      if (editingUser) {
        if (data.password) {
          body.password = data.password;
        }
        const updated = await apiFetch(`/personnel/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        if (selectedUser && selectedUser.id === editingUser.id) {
          setSelectedUser(prev => prev ? { ...prev, ...(updated as any) } : prev);
        }
      } else {
        body.username = data.username;
        body.password = data.password;
        await apiFetch('/personnel', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      setUserModalOpen(false);
      setEditingUser(null);
      await fetchUsers({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user');
    } finally {
      setUserSubmitting(false);
    }
  };

  const openEditUser = (user: User & { last_login_display?: string }) => {
    setEditingUser(user);
    setUserModalOpen(true);
  };

  const openAddUser = () => {
    setEditingUser(null);
    setUserModalOpen(true);
  };

  const openDeleteUser = (user: User & { last_login_display?: string }) => {
    setDeletingUser(user);
    setUserDeleteConfirmOpen(true);
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setUserDeleteLoading(true);
    try {
      await apiFetch(`/personnel/${deletingUser.id}`, { method: 'DELETE' });
      setUserDeleteConfirmOpen(false);
      setDeletingUser(null);
      if (selectedUser?.id === deletingUser.id) {
        setSelectedUser(null);
      }
      await fetchUsers({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to terminate user');
    } finally {
      setUserDeleteLoading(false);
    }
  };

  // ============================================================
  // Client CRUD handlers
  // ============================================================

  const handleClientSubmit = async (data: Record<string, any>) => {
    setClientSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: data.name,
        contact_name: data.contact_name || undefined,
        contact_email: data.contact_email || undefined,
        contact_phone: data.contact_phone || undefined,
        address: data.address || undefined,
        billing_email: data.billing_email || undefined,
        billing_address: data.billing_address || undefined,
        contract_start: data.contract_start || undefined,
        contract_end: data.contract_end || undefined,
        contract_type: data.contract_type || undefined,
        contract_value: data.contract_value ? parseFloat(data.contract_value) : undefined,
        payment_terms: data.payment_terms || undefined,
        auto_renew: data.auto_renew || false,
        sla_response_minutes: data.sla_response_minutes ? parseInt(data.sla_response_minutes, 10) : undefined,
        notes: data.notes || undefined,
      };

      if (editingClient) {
        await apiFetch(`/admin/clients/${editingClient.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/admin/clients', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      setClientModalOpen(false);
      setEditingClient(null);
      await fetchClients({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save client');
    } finally {
      setClientSubmitting(false);
    }
  };

  const openEditClient = (client: Client & { property_count?: number }) => {
    setEditingClient(client);
    setClientModalOpen(true);
  };

  const openAddClient = () => {
    setEditingClient(null);
    setClientModalOpen(true);
  };

  const openDeleteClient = (client: Client) => {
    setDeletingClient(client);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteClient = async () => {
    if (!deletingClient) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/admin/clients/${deletingClient.id}`, { method: 'DELETE' });
      setDeleteConfirmOpen(false);
      setDeletingClient(null);
      await fetchClients({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete client');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleArchiveClient = async (clientId: string) => {
    try {
      await apiFetch(`/admin/clients/${clientId}/archive`, { method: 'POST' });
      await fetchClients({ silent: true });
      if (selectedClient?.id === clientId) setSelectedClient(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive client');
    }
  };

  const handleUnarchiveClient = async (clientId: string) => {
    try {
      await apiFetch(`/admin/clients/${clientId}/unarchive`, { method: 'POST' });
      await fetchClients({ silent: true });
      if (selectedClient?.id === clientId) setSelectedClient(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unarchive client');
    }
  };

  // ============================================================
  // Render helpers
  // ============================================================

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'users', label: 'Users', icon: Users },
    { id: 'clients', label: 'Clients', icon: Building2 },
    { id: 'departments', label: 'Departments', icon: Network },
    { id: 'system', label: 'System Config', icon: Cog },
    { id: 'announcements', label: 'Announcements', icon: Megaphone },
    { id: 'notif_rules', label: 'Alert Rules', icon: Zap },
    { id: 'retention', label: 'Data Retention', icon: Archive },
    { id: 'health', label: 'System Health', icon: Activity },
    { id: 'servemanager', label: 'ServeManager', icon: Link2 },
    { id: 'audit', label: 'Audit Log', icon: ScrollText },
  ];


  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Portal Header */}
      <div className="panel-beveled bg-surface-base overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-2.5 relative">
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #6e0a0a, #bc1010 30%, #bc1010 70%, #6e0a0a)' }} />
          <RmpgLogo height={64} />
          <div className="flex-1">
            <h1 className="text-sm font-bold tracking-wider uppercase" style={{ color: '#d0d0d0' }}>System Administration</h1>
            <p className="text-[9px] tracking-wide" style={{ color: '#484848' }}>Rocky Mountain Protective Group, LLC</p>
          </div>
        </div>
      </div>

      {/* Header */}
      <PanelTitleBar title="ADMINISTRATION" icon={Settings}><PrintButton /></PanelTitleBar>
      <div className="px-6 py-3 border-b border-rmpg-600">
        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors
                  ${activeTab === tab.id
                    ? 'bg-gray-700 text-white border border-rmpg-600 border-b-gray-700'
                    : 'text-rmpg-300 hover:text-white hover:bg-rmpg-700/50'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error banner */}
      <ErrorBanner error={error} setError={setError} />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'users' && (
          <AdminUsersTab
            users={users}
            loadingUsers={loadingUsers}
            error={error}
            setError={setError}
            selectedUser={selectedUser}
            setSelectedUser={setSelectedUser}
            userActivity={userActivity}
            loadingUserActivity={loadingUserActivity}
            openAddUser={openAddUser}
            openEditUser={openEditUser}
            openDeleteUser={openDeleteUser}
            LoadingSpinner={LoadingSpinner}
          />
        )}

        {activeTab === 'clients' && (
          <AdminClientsTab
            clients={clients}
            setClients={setClients}
            loadingClients={loadingClients}
            error={error}
            setError={setError}
            selectedClient={selectedClient}
            setSelectedClient={setSelectedClient}
            openAddClient={openAddClient}
            openEditClient={openEditClient}
            openDeleteClient={openDeleteClient}
            handleArchiveClient={handleArchiveClient}
            handleUnarchiveClient={handleUnarchiveClient}
            mapClientRowToClient={mapClientRowToClient}
            editPendingRef={clientEditPendingRef}
            LoadingSpinner={LoadingSpinner}
          />
        )}

        {activeTab === 'system' && (
          <AdminSystemTab
            users={users}
            error={error}
            setError={setError}
            LoadingSpinner={LoadingSpinner}
          />
        )}

        {activeTab === 'health' && (
          <AdminHealthTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'announcements' && (
          <AdminAnnouncementsTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'retention' && (
          <AdminRetentionTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'departments' && (
          <AdminDepartmentsTab
            users={users}
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'notif_rules' && (
          <AdminNotifRulesTab
            users={users}
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'servemanager' && (
          <AdminServeManagerTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'audit' && (
          <AdminAuditTab
            auditLog={auditLog}
            loadingAudit={loadingAudit}
            LoadingSpinner={LoadingSpinner}
          />
        )}
      </div>

      {/* ===================== Modals ===================== */}

      <UserFormModal
        isOpen={userModalOpen}
        onClose={() => {
          setUserModalOpen(false);
          setEditingUser(null);
        }}
        onSubmit={handleUserSubmit}
        isSubmitting={userSubmitting}
        editingUser={editingUser}
      />

      <ClientFormModal
        isOpen={clientModalOpen}
        onClose={() => {
          setClientModalOpen(false);
          setEditingClient(null);
        }}
        onSubmit={handleClientSubmit}
        isSubmitting={clientSubmitting}
        editingClient={editingClient}
      />

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setDeletingClient(null);
        }}
        onConfirm={handleDeleteClient}
        title="Delete Client"
        message={`Are you sure you want to delete "${deletingClient?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteLoading}
      />

      <ConfirmDialog
        isOpen={userDeleteConfirmOpen}
        onClose={() => {
          setUserDeleteConfirmOpen(false);
          setDeletingUser(null);
        }}
        onConfirm={handleDeleteUser}
        title="Terminate User"
        message={`Are you sure you want to terminate "${deletingUser?.first_name} ${deletingUser?.last_name}" (@${deletingUser?.username})? This will set their status to terminated and free any assigned units.`}
        confirmLabel="Terminate"
        confirmVariant="danger"
        isLoading={userDeleteLoading}
      />
    </div>
  );
}
