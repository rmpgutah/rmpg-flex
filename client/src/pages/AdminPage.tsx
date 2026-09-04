import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
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
  AlertTriangle,
  Megaphone,
  Network,
  Zap,
  Link2,
  Shield,
  GraduationCap,
  DatabaseZap,
  CreditCard,
  Navigation,
  Fingerprint,
  Search,
  Mail,
  Plug,
  ClipboardList,
  Brain,
  Map,
  Radio,
  Cloud,
  RefreshCw,
  Package,
  Download,
  MonitorSmartphone,
  ScanText,
  WifiOff,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import UserFormModal, { type UserFormData } from '../components/UserFormModal';
import ClientFormModal from '../components/ClientFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import type { User, Client, UserRole } from '../types';
import { isFleetioSyncStatusUnhealthy, type FleetioSyncStatus } from '../utils/fleetioHealth';

// Tab components
import AdminSettingsTab from './admin/AdminSettingsTab';
import AutomationsTab from './admin/AutomationsTab';
import AdminUsersTab from './admin/AdminUsersTab';
import AdminWalletIdTab from './admin/AdminWalletIdTab';
import AdminClientsTab from './admin/AdminClientsTab';
import AdminSystemTab from './admin/AdminSystemTab';
import AdminAuditTab from './admin/AdminAuditTab';
import AdminHealthTab from './admin/AdminHealthTab';
import AdminDownloadsTab from './admin/AdminDownloadsTab';
import AdminAnnouncementsTab from './admin/AdminAnnouncementsTab';
import AdminDepartmentsTab from './admin/AdminDepartmentsTab';
import AdminNotifRulesTab from './admin/AdminNotifRulesTab';
import AdminAlertSoundsTab from './admin/AdminAlertSoundsTab';
import AdminGpsHealthTab from './admin/AdminGpsHealthTab';
import AdminServeManagerTab from './admin/AdminServeManagerTab';
import AdminSessionsTab from './admin/AdminSessionsTab';
import AdminTrainingTab from './admin/AdminTrainingTab';
import AdminMicrobiltTab from './admin/AdminMicrobiltTab';
import AdminPersonIntelTab from './admin/AdminPersonIntelTab';
import AdminCloudflareTab from './admin/AdminCloudflareTab';
import AdminFleetioHealthTab from './admin/AdminFleetioHealthTab';
import AdminFleetioDirectoryTab from './admin/AdminFleetioDirectoryTab';
import AdminInspectionTemplatesTab from './admin/AdminInspectionTemplatesTab';
import KioskDevicesTab from './admin/KioskDevicesTab';
import AdminClearPathGpsTab from './admin/AdminClearPathGpsTab';
import AdminArrestsTab from './admin/AdminArrestsTab';
import AdminWarrantScrapersTab from './admin/AdminWarrantScrapersTab';
import AdminIPEDTab from './admin/AdminIPEDTab';
import AdminSkipTracerV2Tab from './admin/AdminSkipTracerV2Tab';
import OfflineQueueTab from './admin/OfflineQueueTab';
import AdminEmailTab from './admin/AdminEmailTab';
import AdminIntegrationsTab from './admin/AdminIntegrationsTab';
import AdminAISettingsTab from './admin/AdminAISettingsTab';
import AdminGodModeTab from './admin/AdminGodModeTab';
import AdminMapSettingsTab from './admin/AdminMapSettingsTab';
import AdminMapDataTab from './admin/AdminMapDataTab';
import AdminRadioTab from './admin/AdminRadioTab';
import AdminReanalysisTab from './admin/AdminReanalysisTab';
import AdminDevSettingsTab from './admin/AdminDevSettingsTab';
import SyncStatusTab from './admin/SyncStatusTab';
import { Book, Server } from 'lucide-react';
import { AdminVmrsBrowser } from './admin/AdminVmrsBrowser';
import AdminCourtLookupsTab from './admin/AdminCourtLookupsTab';
import TesseractTrainingPage from './TesseractTrainingPage';
import LinkageOptionsEditor from '../components/LinkageOptionsEditor';
import { formatEnumValue } from '../utils/formatters';

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
  // NOTE: the roster query only ever selected must_change_password, not a
  // password_expires_at/force_password_change column (neither exists on
  // `users` — passwordExpiresAt is computed on the fly by GET
  // /admin/users/:id/security). Destructuring those two names here was a
  // silent no-op for every row; fixed to read the real column.
  const { status, full_name, last_login_at, totp_enabled, totp_setup_required, must_change_password, password_changed_at, ...rest } = row as PersonnelRow & Record<string, any>;
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
    forcePasswordChange: must_change_password === 1,
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

type TabId = 'users' | 'clients' | 'system' | 'settings' | 'audit' | 'health' | 'downloads' | 'announcements' | 'departments' | 'wallet_ids' | 'linkage' | 'notif_rules' | 'alert_sounds' | 'gps_health' | 'servemanager' | 'microbilt' | 'clearpathgps' | 'arrests' | 'warrant_scrapers' | 'skiptracer_v2' | 'sessions' | 'training' | 'email' | 'iped' | 'integrations' | 'ai_settings' | 'godmode' | 'map_settings' | 'map_data_files' | 'radio' | 'cloudflare' | 'reanalysis' | 'fleetio_health' | 'fleetio_directory' | 'inspection_templates' | 'person_intel' | 'vmrs_browser' | 'dev' | 'court_lookups' | 'kiosk_devices' | 'ocr_learning' | 'automations' | 'sync_status' | 'offline-queue';

const LS_ADMIN_TAB = 'rmpg_admin_tab';

// ============================================================
// Component
// ============================================================

export default function AdminPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  // Ref to suppress LiveSync refresh while a client inline edit is pending save
  const clientEditPendingRef = useRef(false);

  // ── URL deep-link contract ──
  // /admin?tab=<id> selects a section (round-trip: tab clicks update the URL
  // so a copy-paste lands the recipient back on the same tab).
  // /admin?user_id=<id> auto-selects a user on the Users tab once the roster
  // hydrates; /admin?client_id=<id> the same on the Clients tab. /admin?setting_key=
  // is forwarded as-is to the settings tab (it owns its own scroll behavior).
  // All non-tab params are stripped after consumption so a hard refresh
  // doesn't re-trigger the lookup, but ?tab= stays so the operator's tab
  // selection is bookmarkable.
  const [searchParams, setSearchParams] = useSearchParams();

  // Restore active tab from URL ?tab= param or localStorage (default: 'users')
  const VALID_TABS = ['users', 'clients', 'system', 'settings', 'audit', 'health', 'downloads', 'announcements', 'departments', 'notif_rules', 'alert_sounds', 'gps_health', 'servemanager', 'microbilt', 'clearpathgps', 'arrests', 'warrant_scrapers', 'skiptracer_v2', 'sessions', 'training', 'email', 'iped', 'integrations', 'ai_settings', 'godmode', 'map_settings', 'map_data_files', 'radio', 'cloudflare', 'linkage', 'reanalysis', 'fleetio_health', 'fleetio_directory', 'inspection_templates', 'wallet_ids', 'person_intel', 'vmrs_browser', 'dev', 'court_lookups', 'kiosk_devices', 'ocr_learning', 'automations', 'sync_status', 'offline-queue'];
  const [activeTab, setActiveTabState] = useState<TabId>(() => {
    try {
      // URL ?tab= param takes priority (used by Help → Training link, and
      // by external deep-links that point at a specific admin section).
      const urlTab = searchParams.get('tab');
      if (urlTab && VALID_TABS.includes(urlTab)) return urlTab as TabId;
      const saved = localStorage.getItem(LS_ADMIN_TAB);
      if (saved && VALID_TABS.includes(saved)) return saved as TabId;
    } catch { /* ignore */ }
    return 'users';
  });
  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabState(tab);
    try { localStorage.setItem(LS_ADMIN_TAB, tab); } catch { /* ignore */ }
    // Round-trip the tab into the URL so a copy-paste recipient lands on the
    // same section. We do this in setActiveTab (not a useEffect on activeTab)
    // so the back-button history is one entry per real navigation, not one
    // per render. `replace: true` avoids polluting history when an operator
    // clicks through several tabs in a row.
    try {
      const next = new URLSearchParams(searchParams);
      if (next.get('tab') !== tab) {
        next.set('tab', tab);
        setSearchParams(next, { replace: true });
      }
    } catch { /* ignore */ }
  }, [searchParams, setSearchParams]);

  // Deep-link refs — consumed once the roster/clients hydrate, then stripped.
  const pendingUserIdRef = useRef<string | null>(searchParams.get('user_id'));
  const pendingClientIdRef = useRef<string | null>(searchParams.get('client_id'));

  // --- Data states ---
  const [users, setUsers] = useState<(User & { last_login_display?: string })[]>([]);
  const [clients, setClients] = useState<(Client & { property_count?: number })[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  // --- Loading / error ---
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [fleetioUnhealthy, setFleetioUnhealthy] = useState(false);
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
        badge_number: data.badge_number,
        phone: data.phone,
        department: data.department,
        rank: data.rank,
        employee_id: data.employee_id,
        hire_date: data.hire_date,
        termination_date: data.termination_date,
        shift_preference: data.shift_preference,
        address: data.address,
        address_2: data.address_2,
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
        sso_enabled: data.sso_enabled === '1' ? 1 : 0,
      };

      if (editingUser) {
        // Role/status/password each have a dedicated endpoint so they
        // can be audited individually. The general PUT silently drops
        // them, so we fan out the writes here when the admin changed
        // those specific fields.
        const updated = await apiFetch(`/personnel/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        if (data.role && data.role !== editingUser.role) {
          await apiFetch(`/personnel/${editingUser.id}/role`, {
            method: 'POST',
            body: JSON.stringify({ role: data.role }),
          });
        }
        // mapPersonnelToUser strips `status` and stores it as `raw_status`, so
        // editingUser.status is always undefined — compare against raw_status to
        // avoid firing a redundant status POST (+ spurious audit) on every save.
        if (data.status && data.status !== (editingUser as any).raw_status) {
          await apiFetch(`/personnel/${editingUser.id}/status`, {
            method: 'POST',
            body: JSON.stringify({ status: data.status }),
          });
        }
        if (data.password) {
          await apiFetch(`/personnel/${editingUser.id}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ new_password: data.password }),
          });
        }
        if (selectedUser && selectedUser.id === editingUser.id && updated) {
          setSelectedUser(prev => prev ? { ...prev, ...(updated as Record<string, any>) } : prev);
        }
      } else {
        body.username = data.username;
        body.password = data.password;
        body.role = data.role;
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
      await apiFetch(`/personnel/${userId}/status`, {
        method: 'POST',
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
        { id: 'wallet_ids', label: 'Officer IDs', icon: CreditCard },
        { id: 'sessions', label: 'Sessions', icon: Shield },
        // 'security' (Security Policy) consolidated into System Config → Security Policy sub-tab (2026-06-02)
      ],
    },
    {
      category: 'System',
      tabs: [
        { id: 'system', label: 'System Config', icon: Cog },
        { id: 'settings', label: 'Console Settings', icon: Settings },
        { id: 'map_settings', label: 'Map Settings', icon: Map },
        { id: 'map_data_files', label: 'Map Data Files', icon: Map },
        { id: 'linkage', label: 'Linkage Options', icon: Link2 },
        { id: 'health', label: 'System Health', icon: Activity },
        { id: 'gps_health', label: 'GPS Health', icon: Navigation },
        { id: 'downloads', label: 'Downloads', icon: Download },
        { id: 'reanalysis', label: 'Reanalysis', icon: RefreshCw },
        { id: 'sync_status' as TabId, label: 'Sync Status', icon: Server },
        { id: 'offline-queue' as TabId, label: 'Offline Queue', icon: WifiOff },
        // 'branding' (Branding & Reports) consolidated into System Config → Branding & Reports sub-tab (2026-06-02)
        // 'retention' (Data Retention) removed 2026-06-02 — destructive auto-purge was never built; backend stayed a stub.
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
        { id: 'alert_sounds', label: 'Alert Sounds', icon: Radio },
        { id: 'automations', label: 'Smart Automations', icon: Zap },
        { id: 'radio', label: 'Radio Channels', icon: Radio },
      ],
    },
    {
      category: 'Integrations',
      tabs: [
        // Reordered 2026-05-24: operator complaint that warrant-polling
        // status was undiscoverable. Surfaced at top of Integrations and
        // renamed from "Warrant Scrapers" (engineer-speak) to
        // "Warrant Polling Status" (the term operators actually search for).
        { id: 'warrant_scrapers', label: 'Warrant Polling Status', icon: Shield },
        { id: 'arrests', label: 'Arrest Records', icon: Fingerprint },
        // 'skiptracer' (v1) retired in favor of Skip Tracer V2 (2026-06-02)
        { id: 'skiptracer_v2', label: 'Skip Tracer', icon: Search },
        { id: 'servemanager', label: 'ServeManager', icon: Link2 },
        { id: 'microbilt', label: 'Microbilt', icon: DatabaseZap },
        { id: 'person_intel', label: 'Person Intel', icon: Search },
        { id: 'court_lookups', label: 'Court Lookups', icon: Search },
        { id: 'cloudflare', label: 'Cloudflare', icon: Cloud },
        { id: 'kiosk_devices', label: 'Kiosk Devices', icon: MonitorSmartphone },
        { id: 'clearpathgps', label: 'ClearPathGPS', icon: Navigation },
        { id: 'email', label: 'Microsoft Email', icon: Mail },
        { id: 'integrations', label: 'API Integrations', icon: Plug },
        { id: 'training', label: 'Training', icon: GraduationCap },
        { id: 'ocr_learning', label: 'Tesseract OCR Learning', icon: ScanText },
      ],
    },
    {
      category: 'Compliance',
      tabs: [
        { id: 'audit', label: 'Audit Log', icon: ScrollText },
        { id: 'iped', label: 'IPED', icon: ClipboardList },
        { id: 'fleetio_health', label: 'Fleet.io Health', icon: Activity },
        { id: 'fleetio_directory', label: 'Fleet.io Vendors/Parts', icon: Package },
        { id: 'inspection_templates', label: 'Inspection Templates', icon: ClipboardList },
        { id: 'vmrs_browser', label: 'VMRS Browser', icon: Book },
      ],
    },
    {
      category: 'God Mode',
      tabs: [
        { id: 'godmode', label: 'God Mode', icon: Shield },
      ],
    },
    {
      category: 'Developer',
      tabs: [
        { id: 'dev', label: 'Dev ⚙', icon: Cog },
      ],
    },
  ];


  // ============================================================
  // Render
  // ============================================================

  // Set document title
  useEffect(() => { document.title = 'Administration \u2014 RMPG Flex'; }, []);

  // Fleet.io queue health \u2014 small badge on the tab label so a stuck sync
  // doesn't require an admin to remember to open the tab (see
  // docs/superpowers/specs/2026-07-23-fleetio-reliability-observability-design.md).
  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;
    const check = () => {
      apiFetch<FleetioSyncStatus>('/fleetio/sync-status')
        .then((status) => { if (!cancelled && status) setFleetioUnhealthy(isFleetioSyncStatusUnhealthy(status, Date.now())); })
        .catch(() => { /* best-effort \u2014 a failed check just leaves the badge as-is */ });
    };
    check();
    const t = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [user?.role]);

  // \u2500\u2500 /admin?user_id=<id> deep-link auto-select \u2500\u2500
  // Once the personnel roster hydrates, find the target by id, flip to the
  // Users tab, and select it. Strip the param so a refresh doesn't re-pin.
  useEffect(() => {
    const target = pendingUserIdRef.current;
    if (!target) return;
    if (loadingUsers) return;
    const hit = users.find(u => String(u.id) === String(target));
    if (hit) {
      pendingUserIdRef.current = null;
      setActiveTab('users');
      setSelectedUser(hit);
      const next = new URLSearchParams(searchParams);
      next.delete('user_id');
      setSearchParams(next, { replace: true });
      return;
    }
    // Wait for hydration before deciding it's missing.
    if (users.length === 0) return;
    pendingUserIdRef.current = null;
    addToast(`User ${target} not found`, 'warning');
    const next = new URLSearchParams(searchParams);
    next.delete('user_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, loadingUsers]);

  // \u2500\u2500 /admin?client_id=<id> deep-link auto-select \u2500\u2500
  useEffect(() => {
    const target = pendingClientIdRef.current;
    if (!target) return;
    if (loadingClients) return;
    const hit = clients.find(c => String(c.id) === String(target));
    if (hit) {
      pendingClientIdRef.current = null;
      setActiveTab('clients');
      setSelectedClient(hit);
      const next = new URLSearchParams(searchParams);
      next.delete('client_id');
      setSearchParams(next, { replace: true });
      return;
    }
    if (clients.length === 0) return;
    pendingClientIdRef.current = null;
    addToast(`Client ${target} not found`, 'warning');
    const next = new URLSearchParams(searchParams);
    next.delete('client_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, loadingClients]);

  // \u2500\u2500 If the deep-link is for Clients but the tab opened to Users, force
  // a clients fetch so the auto-select effect can resolve. \u2500\u2500
  useEffect(() => {
    if (pendingClientIdRef.current && clients.length === 0 && !loadingClients) {
      fetchClients();
    }
    if (pendingUserIdRef.current && users.length === 0 && !loadingUsers) {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // \u2500\u2500 Keyboard: Esc smart-cascade + N \u2192 New User / New Client \u2500\u2500
  // Esc closes the smallest-open thing first so a delete confirm raised on
  // top of an edit modal doesn't dismiss both at once. Order: delete
  // confirms \u2192 primary modals \u2192 selected detail pane. The old handler only
  // closed the user modal, leaving every other dialog captive to its own
  // close button.
  // N opens "Add User" on the Users tab or "Add Client" on the Clients tab;
  // typing-suppressed so an admin filling out a search box doesn't trigger
  // the shortcut mid-type.
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (userDeleteConfirmOpen) { setUserDeleteConfirmOpen(false); setDeletingUser(null); return; }
        if (deleteConfirmOpen) { setDeleteConfirmOpen(false); setDeletingClient(null); return; }
        if (userModalOpen) { setUserModalOpen(false); setEditingUser(null); return; }
        if (clientModalOpen) { setClientModalOpen(false); setEditingClient(null); return; }
        if (selectedUser) { setSelectedUser(null); return; }
        if (selectedClient) { setSelectedClient(null); return; }
        return;
      }
      if ((e.key === 'n' || e.key === 'N')
          && !e.ctrlKey && !e.metaKey && !e.altKey
          && !isTypingTarget(e.target)) {
        // Suppress when any modal already owns the page.
        if (userModalOpen || clientModalOpen || deleteConfirmOpen || userDeleteConfirmOpen) return;
        if (activeTab === 'users') {
          e.preventDefault();
          openAddUser();
        } else if (activeTab === 'clients') {
          e.preventDefault();
          openAddClient();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    userDeleteConfirmOpen, deleteConfirmOpen, userModalOpen, clientModalOpen,
    selectedUser, selectedClient, activeTab,
  ]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Portal Header */}
      {!isMobile && (
        <div className="panel-beveled bg-surface-base overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-2.5 relative">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, var(--surface-base), rgb(var(--rmpg-500-rgb)) 30%, rgb(var(--rmpg-500-rgb)) 70%, var(--surface-base))' }} aria-hidden="true" />
            <RmpgLogo height={64} />
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold tracking-wider uppercase" style={{ color: 'var(--text-secondary)', letterSpacing: '0.12em' }}>System Administration</h1>
              <p className="text-[9px] tracking-wide mt-0.5 text-rmpg-500">Rocky Mountain Protective Group, LLC</p>
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
          className="flex overflow-x-auto flex-shrink-0 gap-1 px-2 py-1.5 scrollbar-dark tab-scroll"
          style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}
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
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: isActive ? 'rgba(var(--rmpg-500-rgb), 0.15)' : 'transparent',
                  border: isActive ? '1px solid rgba(var(--rmpg-500-rgb), 0.4)' : '1px solid transparent',
                  borderBottom: isActive ? '2px solid rgb(var(--rmpg-500-rgb))' : '2px solid transparent',
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
              background: 'var(--surface-overlay)',
              borderRight: '1px solid var(--border-subtle)',
            }}
            aria-label="Admin navigation"
            role="tablist"
          >
            {tabGroups.map((group, gi) => (
              <div key={group.category} className={gi > 0 ? 'mt-2' : ''}>
                <div
                  className="px-3 py-1.5 text-[8px] font-bold uppercase tracking-[0.18em] select-none border-b border-border-subtle/60 mb-0.5 text-rmpg-500"
                  aria-hidden="true"
                >
                  {formatEnumValue(group.category)}
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
                      className="w-full flex items-center gap-2 px-3 py-[5px] text-left text-[11px] transition-all duration-150 hover:bg-rmpg-500/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50"
                      style={{
                        color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                        background: isActive ? 'rgba(var(--rmpg-500-rgb), 0.14)' : undefined,
                        borderLeft: isActive ? '2px solid rgb(var(--rmpg-500-rgb))' : '2px solid transparent',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      <Icon style={{ width: 13, height: 13 }} className={`transition-colors duration-150 shrink-0 ${isActive ? 'text-brand-400' : 'text-rmpg-600'}`} aria-hidden="true" />
                      <span className={`truncate${tab.id === 'dev' ? ' text-red-400' : ''}`}>{tab.label}</span>
                      {tab.id === 'fleetio_health' && fleetioUnhealthy && (
                        <AlertTriangle
                          style={{ width: 11, height: 11 }}
                          className="shrink-0 text-amber-400 ml-auto"
                          aria-label="Fleet.io sync queue needs attention"
                        />
                      )}
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

        {activeTab === 'settings' && (
          <AdminSettingsTab LoadingSpinner={LoadingSpinner} />
        )}

        {activeTab === 'system' && (
          <AdminSystemTab
            users={users}
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'map_settings' && (
          <AdminMapSettingsTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'map_data_files' && (
          <AdminMapDataTab />
        )}

        {activeTab === 'health' && (
          <AdminHealthTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'downloads' && (
          <AdminDownloadsTab />
        )}

        {activeTab === 'reanalysis' && (
          <AdminReanalysisTab
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

        {activeTab === 'alert_sounds' && (
          <AdminAlertSoundsTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'gps_health' && (
          <AdminGpsHealthTab
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
            isAdmin={user?.role === 'admin'}
          />
        )}

        {activeTab === 'microbilt' && (
          <AdminMicrobiltTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'person_intel' && (
          <AdminPersonIntelTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'cloudflare' && (
          <AdminCloudflareTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'fleetio_health' && (
          <AdminFleetioHealthTab />
        )}
        {activeTab === 'fleetio_directory' && (
          <AdminFleetioDirectoryTab />
        )}

        {activeTab === 'inspection_templates' && (
          <AdminInspectionTemplatesTab />
        )}

        {activeTab === 'kiosk_devices' && (
          <KioskDevicesTab />
        )}

        {activeTab === 'vmrs_browser' && (
          <AdminVmrsBrowser />
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

        {activeTab === 'skiptracer_v2' && (
          <AdminSkipTracerV2Tab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'wallet_ids' && (
          <AdminWalletIdTab LoadingSpinner={LoadingSpinner} />
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

        {activeTab === 'ocr_learning' && <TesseractTrainingPage />}

        {activeTab === 'automations' && <AutomationsTab />}
        {activeTab === 'sync_status' && <SyncStatusTab />}
        {activeTab === 'offline-queue' && <OfflineQueueTab />}

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

        {activeTab === 'dev' && (
          <AdminDevSettingsTab role={user?.role ?? 'officer'} />
        )}

        {activeTab === 'radio' && (
          <AdminRadioTab />
        )}

        {activeTab === 'linkage' && <LinkageOptionsEditor />}

        {activeTab === 'audit' && (
          <AdminAuditTab
            auditLog={auditLog}
            loadingAudit={loadingAudit}
            LoadingSpinner={LoadingSpinner}
          />
        )}

        {activeTab === 'court_lookups' && (
          <AdminCourtLookupsTab
            LoadingSpinner={LoadingSpinner}
            error={error}
            setError={setError}
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
