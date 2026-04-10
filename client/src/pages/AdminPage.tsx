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
  Shield,
  GraduationCap,
  Radio,
  WifiOff,
  DatabaseZap,
  Lock,
  Palette,
  Navigation,
  Fingerprint,
  Search,
  Mail,
  Plug,
  ClipboardList,
  Brain,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
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
import AdminSessionsTab from './admin/AdminSessionsTab';
import AdminTrainingTab from './admin/AdminTrainingTab';
import AdminRadioTab from './admin/AdminRadioTab';
import AdminOfflineTab from './admin/AdminOfflineTab';
import AdminMicrobiltTab from './admin/AdminMicrobiltTab';
import AdminClearPathGpsTab from './admin/AdminClearPathGpsTab';
import AdminArrestsTab from './admin/AdminArrestsTab';
import AdminWarrantScrapersTab from './admin/AdminWarrantScrapersTab';
import AdminIPEDTab from './admin/AdminIPEDTab';
import AdminSkipTracerTab from './admin/AdminSkipTracerTab';
import AdminSecurityTab from './admin/AdminSecurityTab';
import AdminBrandingTab from './admin/AdminBrandingTab';
import AdminEmailTab from './admin/AdminEmailTab';
import AdminIntegrationsTab from './admin/AdminIntegrationsTab';
import AdminAISettingsTab from './admin/AdminAISettingsTab';
import AdminGodModeTab from './admin/AdminGodModeTab';

// ============================================================
// Shared sub-components (module-level to avoid remounting)
// ============================================================

const LoadingSpinner: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-20 gap-3" role="status" aria-label="Loading content">
    <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
    <span className="text-xs text-rmpg-400 tracking-wide uppercase">Loading...</span>
  </div>
);

function ErrorBanner({ error, setError }: { error: string | null; setError: (e: string | null) => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-700/50 text-red-400 text-xs animate-fade-in">
      <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{error}</span>
      <button type="button" onClick={() => setError(null)} className="ml-auto p-0.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors" aria-label="Dismiss error">
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

function mapPersonnelToUser(row: PersonnelRow): User & { last_login_display?: string; raw_status?: string } {
  // Use server-provided first_name/last_name if available, otherwise derive from full_name
  const first_name = row.first_name || (row.full_name || '').trim().split(/\s+/)[0] || '';
  const last_name = row.last_name || (row.full_name || '').trim().split(/\s+/).slice(1).join(' ') || '';

  // Spread all server fields through so no data is lost (profile_image, notes, etc.)
  const { status, full_name, last_login_at, totp_enabled, totp_setup_required, password_expires_at, force_password_change, password_changed_at, ...rest } = row as PersonnelRow & Record<string, any>;
  return {
    ...rest,
    first_name,
    last_name,
    full_name: full_name || `${first_name} ${last_name}`.trim(),
    is_active: status === 'active',
    raw_status: status, // Preserve for admin UI (active/inactive/terminated)
    last_login: last_login_at || rest.last_login, // Map DB column to User type field
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

type TabId = 'users' | 'clients' | 'system' | 'audit' | 'health' | 'announcements' | 'retention' | 'departments' | 'notif_rules' | 'servemanager' | 'microbilt' | 'clearpathgps' | 'arrests' | 'warrant_scrapers' | 'skiptracer' | 'sessions' | 'training' | 'radio' | 'offline' | 'security' | 'branding' | 'email' | 'iped' | 'integrations' | 'ai_settings' | 'godmode';

const LS_ADMIN_TAB = 'rmpg_admin_tab';

// ============================================================
// Component
// ============================================================

export default function AdminPage() {
  const isMobile = useIsMobile();
  // Ref to suppress LiveSync refresh while a client inline edit is pending save
  const clientEditPendingRef = useRef(false);

  // Restore active tab from URL ?tab= param or localStorage (default: 'users')
  const VALID_TABS = ['users', 'clients', 'system', 'audit', 'health', 'announcements', 'retention', 'departments', 'notif_rules', 'servemanager', 'microbilt', 'clearpathgps', 'arrests', 'warrant_scrapers', 'skiptracer', 'skiptracer_v2', 'sessions', 'training', 'radio', 'offline', 'security', 'branding', 'email', 'iped', 'integrations', 'ai_settings', 'godmode'];
  const [activeTab, setActiveTabState] = useState<TabId>(() => {
    try {
      // URL ?tab= param takes priority (used by Help → Training link)
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      if (urlTab && VALID_TABS.includes(urlTab)) return urlTab as TabId;
      const saved = localStorage.getItem(LS_ADMIN_TAB);
      if (saved && VALID_TABS.includes(saved)) return saved as TabId;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    else if (activeTab === 'system') { if (users.length === 0 && !loadingUsers) fetchUsers(); }
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
        if (data.status) {
          body.status = data.status;
        }
        const updated = await apiFetch(`/personnel/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        if (selectedUser && selectedUser.id === editingUser.id && updated) {
          setSelectedUser(prev => prev ? { ...prev, ...(updated as Record<string, any>) } : prev);
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

  const handleStatusChange = useCallback(async (userId: string, newStatus: string) => {
    try {
      await apiFetch(`/personnel/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchUsers({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user status');
    }
  }, [fetchUsers]);

  // ============================================================
  // Client CRUD handlers
  // ============================================================

  const handleClientSubmit = async (data: Record<string, any>) => {
    setClientSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        // General
        name: data.name,
        client_code: data.client_code || undefined,
        industry: data.industry || undefined,
        website: data.website || undefined,
        address: data.address || undefined,
        notes: data.notes || undefined,
        // Contact & Billing
        contact_name: data.contact_name || undefined,
        contact_email: data.contact_email || undefined,
        contact_phone: data.contact_phone || undefined,
        billing_email: data.billing_email || undefined,
        billing_address: data.billing_address || undefined,
        tax_id: data.tax_id || undefined,
        payment_method: data.payment_method || undefined,
        billing_cycle: data.billing_cycle || undefined,
        billing_day: data.billing_day ? parseInt(data.billing_day, 10) : undefined,
        // Contract
        contract_start: data.contract_start || undefined,
        contract_end: data.contract_end || undefined,
        contract_type: data.contract_type || undefined,
        contract_value: data.contract_value ? parseFloat(data.contract_value) : undefined,
        payment_terms: data.payment_terms || undefined,
        auto_renew: data.auto_renew || false,
        sla_response_minutes: data.sla_response_minutes ? parseInt(data.sla_response_minutes, 10) : undefined,
        discount_percent: data.discount_percent ? parseFloat(data.discount_percent) : undefined,
        late_fee_percent: data.late_fee_percent ? parseFloat(data.late_fee_percent) : undefined,
        // Account Details
        account_manager: data.account_manager || undefined,
        priority_client: data.priority_client || false,
        client_since: data.client_since || undefined,
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

  const tabGroups: { category: string; tabs: { id: TabId; label: string; icon: React.ElementType }[] }[] = [
    {
      category: 'People & Access',
      tabs: [
        { id: 'users', label: 'Users', icon: Users },
        { id: 'clients', label: 'Clients', icon: Building2 },
        { id: 'departments', label: 'Departments', icon: Network },
        { id: 'sessions', label: 'Sessions', icon: Shield },
        { id: 'security', label: 'Security Policy', icon: Lock },
      ],
    },
    {
      category: 'System',
      tabs: [
        { id: 'system', label: 'System Config', icon: Cog },
        { id: 'health', label: 'System Health', icon: Activity },
        { id: 'branding', label: 'Branding & Reports', icon: Palette },
        { id: 'retention', label: 'Data Retention', icon: Archive },
        { id: 'offline', label: 'Offline Mode', icon: WifiOff },
      ],
    },
    {
      category: 'AI & Intelligence',
      tabs: [
        { id: 'ai_settings', label: 'AI Command Center', icon: Brain },
      ],
    },
    {
      category: 'Communications',
      tabs: [
        { id: 'announcements', label: 'Announcements', icon: Megaphone },
        { id: 'notif_rules', label: 'Alert Rules', icon: Zap },
        { id: 'radio', label: 'Radio Config', icon: Radio },
      ],
    },
    {
      category: 'Integrations',
      tabs: [
        { id: 'servemanager', label: 'ServeManager', icon: Link2 },
        { id: 'microbilt', label: 'Microbilt', icon: DatabaseZap },
        { id: 'clearpathgps', label: 'ClearPathGPS', icon: Navigation },
        { id: 'arrests', label: 'Arrest Records', icon: Fingerprint },
        { id: 'warrant_scrapers', label: 'Warrant Scrapers', icon: Shield },
        { id: 'skiptracer', label: 'Skip Tracker', icon: Search },
        { id: 'email', label: 'Microsoft Email', icon: Mail },
        { id: 'integrations', label: 'API Integrations', icon: Plug },
        { id: 'training', label: 'Training', icon: GraduationCap },
      ],
    },
    {
      category: 'Compliance',
      tabs: [
        { id: 'audit', label: 'Audit Log', icon: ScrollText },
        { id: 'iped', label: 'IPED', icon: ClipboardList },
      ],
    },
    {
      category: 'God Mode',
      tabs: [
        { id: 'godmode', label: 'God Mode', icon: Shield },
      ],
    },
  ];


  // ============================================================
  // Render
  // ============================================================

  // Set document title
  useEffect(() => { document.title = 'Administration \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setUserModalOpen(false); setEditingUser(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Portal Header */}
      {!isMobile && (
        <div className="panel-beveled bg-surface-base overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-2.5 relative">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #1a1a1a, #888888 30%, #888888 70%, #1a1a1a)' }} aria-hidden="true" />
            <RmpgLogo height={64} />
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold tracking-wider uppercase" style={{ color: '#d0d0d0', letterSpacing: '0.12em' }}>System Administration</h1>
              <p className="text-[9px] tracking-wide mt-0.5" style={{ color: '#383838' }}>Rocky Mountain Protective Group, LLC</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      {!isMobile && <PanelTitleBar title="ADMINISTRATION" icon={Settings}><PrintButton /></PanelTitleBar>}

      {/* Error banner */}
      <ErrorBanner error={error} setError={setError} />

      {/* Mobile: horizontal scroll tabs */}
      {isMobile && (
        <div
          className="flex overflow-x-auto flex-shrink-0 gap-1 px-2 py-1.5 scrollbar-dark"
          style={{ background: '#050505', borderBottom: '1px solid #181818' }}
          role="tablist"
          aria-label="Admin sections"
        >
          {tabGroups.flatMap(g => g.tabs).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button type="button"
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold whitespace-nowrap shrink-0 transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50"
                style={{
                  color: isActive ? '#ffffff' : '#888888',
                  background: isActive ? 'rgba(136, 136, 136, 0.15)' : 'transparent',
                  border: isActive ? '1px solid rgba(136,136,136,0.4)' : '1px solid transparent',
                  borderBottom: isActive ? '2px solid #888888' : '2px solid transparent',
                }}
              >
                <Icon style={{ width: 12, height: 12 }} className={isActive ? 'text-brand-400' : 'text-rmpg-600'} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Sidebar + Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar */}
        {!isMobile && (
          <nav
            className="flex-shrink-0 overflow-y-auto py-2 scrollbar-dark"
            style={{
              width: 200,
              background: '#050505',
              borderRight: '1px solid #181818',
            }}
            aria-label="Admin navigation"
            role="tablist"
          >
            {tabGroups.map((group, gi) => (
              <div key={group.category} className={gi > 0 ? 'mt-2' : ''}>
                <div
                  className="px-3 py-1.5 text-[8px] font-bold uppercase tracking-[0.18em] select-none border-b border-[#181818]/60 mb-0.5"
                  style={{ color: '#505050' }}
                  aria-hidden="true"
                >
                  {group.category}
                </div>
                {group.tabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button type="button"
                      key={tab.id}
                      role="tab"
                      aria-selected={isActive}
                      id={`admin-tab-${tab.id}`}
                      aria-controls={`admin-tabpanel-${tab.id}`}
                      onClick={() => setActiveTab(tab.id)}
                      className="w-full flex items-center gap-2 px-3 py-[5px] text-left text-[11px] transition-all duration-150 hover:bg-[rgba(136,136,136,0.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50"
                      style={{
                        color: isActive ? '#ffffff' : '#888888',
                        background: isActive ? 'rgba(136, 136, 136, 0.14)' : undefined,
                        borderLeft: isActive ? '2px solid #888888' : '2px solid transparent',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      <Icon style={{ width: 13, height: 13 }} className={`transition-colors duration-150 shrink-0 ${isActive ? 'text-brand-400' : 'text-rmpg-600'}`} aria-hidden="true" />
                      <span className="truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto scrollbar-dark" role="tabpanel" id={`admin-tabpanel-${activeTab}`} aria-labelledby={`admin-tab-${activeTab}`}>
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
            onStatusChange={handleStatusChange}
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

        {activeTab === 'microbilt' && (
          <AdminMicrobiltTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'clearpathgps' && (
          <AdminClearPathGpsTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'arrests' && (
          <AdminArrestsTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'warrant_scrapers' && (
          <AdminWarrantScrapersTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'iped' && (
          <AdminIPEDTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'skiptracer' && (
          <AdminSkipTracerTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'sessions' && (
          <AdminSessionsTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'training' && (
          <AdminTrainingTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'radio' && (
          <AdminRadioTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'offline' && (
          <AdminOfflineTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'security' && (
          <AdminSecurityTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'branding' && (
          <AdminBrandingTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'email' && (
          <AdminEmailTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'integrations' && (
          <AdminIntegrationsTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'ai_settings' && (
          <AdminAISettingsTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'godmode' && (
          <AdminGodModeTab />
        )}

        {activeTab === 'audit' && (
          <AdminAuditTab
            auditLog={auditLog}
            loadingAudit={loadingAudit}
            LoadingSpinner={LoadingSpinner}
          />
        )}
      </div>
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
        editingUser={editingUser ? { ...editingUser, status: (editingUser as any).raw_status || (editingUser.is_active ? 'active' : 'inactive') } : null}
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
