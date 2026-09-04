import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import RichTextArea from '../components/RichTextArea';
import {
  LayoutDashboard,
  Building2,
  MapPin,
  Users,
  FileText,
  CheckSquare,
  Plus,
  Search,
  Loader2,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Calendar,
  Edit3,
  Trash2,
  Phone,
  Mail,
  RefreshCw,
  X,
  Save,
  BarChart3,
  Activity,
  Target,
  FileSignature,
  Globe,
  Eye,
  Flame,
  Telescope,
  Check,
} from 'lucide-react';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import LeadsTab from '../components/crm/LeadsTab';
import ProposalsTab from '../components/crm/ProposalsTab';
import ReportsTab from '../components/crm/ReportsTab';
import WebIntelPanel from '../components/crm/WebIntelPanel';
import CompetitorMonitorPanel from '../components/crm/CompetitorMonitorPanel';
import FirecrawlTab from '../components/crm/FirecrawlTab';
import DeepResearchTab from '../components/crm/DeepResearchTab';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { useLiveSync } from '../hooks/useLiveSync';
import { useToast } from '../components/ToastProvider';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import ClientFormModal from '../components/ClientFormModal';
import ExportButton from '../components/ExportButton';
import { parseTimestamp } from '../utils/dateUtils';
import type {
  Client,
  Property,
  Invoice,
  CrmTask,
  CrmActivity,
  CrmDashboardStats,
} from '../types';
import { crmAccountsToCsv, downloadTextFile } from '../utils/rmsListExport';
import { useSlashFocus } from '../hooks/useSlashFocus';

type CrmSection = 'dashboard' | 'clients' | 'properties' | 'contacts' | 'invoices' | 'tasks' | 'leads' | 'proposals' | 'reports' | 'webintel' | 'competitors' | 'firecrawl' | 'deepresearch';

// Intel/research tabs require at least supervisor role — these pull live web
// data, launch Firecrawl jobs, and expose raw intelligence. Officers and
// dispatchers (read-only) should not see them in the sidebar.
const INTEL_ROLES = new Set(['admin', 'manager', 'supervisor']);

const SIDEBAR_ITEMS: { id: CrmSection; label: string; icon: React.ElementType; intelOnly?: true }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads', label: 'Leads', icon: Target },
  { id: 'clients', label: 'Clients', icon: Building2 },
  { id: 'properties', label: 'Properties', icon: MapPin },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'proposals', label: 'Proposals', icon: FileSignature },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'webintel', label: 'Web Intel', icon: Globe, intelOnly: true },
  { id: 'competitors', label: 'Competitors', icon: Eye, intelOnly: true },
  { id: 'firecrawl', label: 'Firecrawl', icon: Flame, intelOnly: true },
  { id: 'deepresearch', label: 'Deep Research', icon: Telescope, intelOnly: true },
];

const TASK_TYPES = ['follow_up', 'site_visit', 'contract_renewal', 'billing', 'other'] as const;
const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
const ACTIVITY_TYPES = ['note', 'call', 'email', 'meeting', 'invoice', 'contract_change', 'site_visit'] as const;
const RELATIONSHIP_TYPES = ['employee', 'contact', 'tenant', 'owner', 'manager', 'subject', 'trespass_warning', 'frequent_visitor', 'banned', 'other'] as const;

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function formatDate(d?: string): string {
  if (!d) return '—';
  return parseTimestamp(d).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d?: string): string {
  if (!d) return '—';
  return parseTimestamp(d).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}



// ── Priority badge colors ──────────────────────────────
function priorityColor(p: string): string {
  switch (p) {
    case 'urgent': return 'text-red-400 bg-red-900/30 border-red-700/50';
    case 'high': return 'text-amber-400 bg-amber-900/30 border-amber-700/50';
    case 'normal': return 'text-rmpg-200 bg-rmpg-700/20 border-rmpg-600/60';
    case 'low': return 'text-rmpg-300 bg-rmpg-800/30 border-rmpg-700/50';
    default: return 'text-rmpg-300 bg-rmpg-800/30 border-rmpg-700/50';
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'pending': return 'text-amber-400 bg-amber-900/30 border-amber-700/50';
    case 'in_progress': return 'text-rmpg-200 bg-rmpg-700/20 border-rmpg-600/60';
    case 'completed': return 'text-green-400 bg-green-900/30 border-green-700/50';
    case 'cancelled': return 'text-rmpg-300 bg-rmpg-800/30 border-rmpg-700/50';
    default: return 'text-rmpg-300 bg-rmpg-800/30 border-rmpg-700/50';
  }
}

function invoiceStatusColor(s: string): string {
  switch (s) {
    case 'paid': return 'text-green-400 bg-green-900/30 border-green-700/50';
    case 'sent': return 'text-rmpg-200 bg-rmpg-700/20 border-rmpg-600/60';
    case 'overdue': return 'text-red-400 bg-red-900/30 border-red-700/50';
    case 'partial': return 'text-amber-400 bg-amber-900/30 border-amber-700/50';
    case 'draft': return 'text-rmpg-300 bg-rmpg-800/30 border-rmpg-700/50';
    case 'void': case 'cancelled': return 'text-rmpg-400 bg-rmpg-900/30 border-rmpg-700/50';
    default: return 'text-rmpg-300 bg-rmpg-800/30 border-rmpg-700/50';
  }
}

// ════════════════════════════════════════════════════════
// CRM PAGE
// ════════════════════════════════════════════════════════
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

export default function CrmPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const { user } = useAuth();
  const isIntelUser = INTEL_ROLES.has(user?.role ?? '');
  const clientSearchRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);
  useSlashFocus(clientSearchRef);
  // Per-user localStorage key — the prior global 'crm_active_section' key
  // leaked the previous operator's last-viewed tab to the next person who
  // logged in on a shared shift workstation. Same data-leak pattern called
  // out in earlier audits; namespacing on user.id (or anonymous fallback)
  // gives each operator their own remembered section.
  const sectionKey = useMemo(() => `crm_active_section:${user?.id ?? 'anon'}`, [user?.id]);
  // admin|manager can delete tasks/contacts. supervisor and below are read-only
  // for destructive operations.
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState<CrmSection>(() => {
    // URL deep-link wins over saved-section so a link from elsewhere
    // (?section=tasks&client_id=42) lands the operator on the right tab.
    const urlSection = searchParams.get('section') as CrmSection | null;
    if (urlSection && SIDEBAR_ITEMS.some((i) => i.id === urlSection)) return urlSection;
    const saved = localStorage.getItem(sectionKey)
      // One-shot migration: lift the legacy global key into per-user namespace
      // so an existing user doesn't suddenly lose their preferred section.
      || (user?.id ? localStorage.getItem('crm_active_section') : null);
    return (saved as CrmSection) || 'dashboard';
  });
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Dashboard
  const [stats, setStats] = useState<CrmDashboardStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<CrmActivity[]>([]);
  const [expiringContracts, setExpiringContracts] = useState<any[]>([]);

  // Clients
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientModal, setShowClientModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientActivity, setClientActivity] = useState<CrmActivity[]>([]);

  // Properties
  const [properties, setProperties] = useState<(Property & { client_name?: string })[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');

  // Contacts
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');

  // Invoices
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoiceFilter, setInvoiceFilter] = useState('');

  // Tasks
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [taskFilter, setTaskFilter] = useState('pending,in_progress');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<CrmTask | null>(null);
  const [taskForm, setTaskForm] = useState<Partial<CrmTask>>({});

  // Officers for assignment
  const [officers, setOfficers] = useState<{ id: string; full_name: string }[]>([]);

  // Task delete confirmation
  const [taskToDelete, setTaskToDelete] = useState<CrmTask | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [isSavingTask, setIsSavingTask] = useState(false);

  // Activity log modal
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [isLoggingActivity, setIsLoggingActivity] = useState(false);
  const [isSubmittingClient, setIsSubmittingClient] = useState(false);
  const [activityForm, setActivityForm] = useState<{ client_id: string; activity_type: string; subject: string; details: string }>({
    client_id: '', activity_type: 'note', subject: '', details: '',
  });

  // Feature 12: Pipeline summary
  const [pipelineSummary, setPipelineSummary] = useState<any>(null);
  // Feature 13: Follow-ups
  const [followUps, setFollowUps] = useState<any>(null);
  // Feature 14: Source analytics
  const [sourceAnalytics, setSourceAnalytics] = useState<any>(null);
  // Feature 15: Revenue forecast
  const [revenueForecast, setRevenueForecast] = useState<any>(null);

  const fetchPipelineSummary = useCallback(async () => {
    try { const res = await apiFetch<any>('/crm/pipeline-summary'); if (mountedRef.current) setPipelineSummary(res); } catch { /* ignore */ }
  }, []);

  const fetchFollowUps = useCallback(async () => {
    try { const res = await apiFetch<any>('/crm/leads/follow-ups'); if (mountedRef.current) setFollowUps(res); } catch { /* ignore */ }
  }, []);

  const fetchSourceAnalytics = useCallback(async () => {
    try { const res = await apiFetch<any>('/crm/leads/source-analytics'); if (mountedRef.current) setSourceAnalytics(res); } catch { /* ignore */ }
  }, []);

  const fetchRevenueForecast = useCallback(async () => {
    try { const res = await apiFetch<any>('/crm/revenue-forecast'); if (mountedRef.current) setRevenueForecast(res); } catch { /* ignore */ }
  }, []);

  // Persist active section (per-user)
  useEffect(() => { try { localStorage.setItem(sectionKey, activeSection); } catch { /* ignore */ } }, [activeSection, sectionKey]);

  // ── Data Fetching ──────────────────────────────────────
  const fetchDashboard = useCallback(async () => {
    setFetchError('');
    try {
      const [statsRes, activityRes, expiringRes] = await Promise.all([
        apiFetch<CrmDashboardStats>('/crm/dashboard'),
        apiFetch<CrmActivity[]>('/crm/recent-activity?limit=20'),
        apiFetch<any[]>('/crm/expiring-contracts?days=90'),
      ]);
      if (!mountedRef.current) return;
      setStats(statsRes);
      setRecentActivity(Array.isArray(activityRes) ? activityRes : []);
      setExpiringContracts(Array.isArray(expiringRes) ? expiringRes : []);
    } catch (err) {
      if (!mountedRef.current) return;
      setFetchError(err instanceof Error ? err.message : 'Failed to load data');
    }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const res = await apiFetch<any[]>('/admin/clients');
      if (!mountedRef.current) return;
      setClients(Array.isArray(res) ? res : []);
    } catch { if (mountedRef.current) setClients([]); }
  }, []);

  const fetchProperties = useCallback(async () => {
    setPropertiesLoading(true);
    try {
      const res = await apiFetch<any[]>('/records/properties');
      if (!mountedRef.current) return;
      setProperties(Array.isArray(res) ? res : []);
    } catch { if (mountedRef.current) setProperties([]); }
    finally { if (mountedRef.current) setPropertiesLoading(false); }
  }, []);

  const fetchContacts = useCallback(async () => {
    setContactsLoading(true);
    try {
      const params = new URLSearchParams();
      if (contactSearch) params.set('search', contactSearch);
      if (contactRelationship) params.set('relationship', contactRelationship);
      const res = await apiFetch<any[]>(`/crm/contacts?${params}`);
      if (!mountedRef.current) return;
      setContacts(Array.isArray(res) ? res : []);
    } catch { if (mountedRef.current) setContacts([]); }
    finally { if (mountedRef.current) setContactsLoading(false); }
  }, [contactSearch, contactRelationship]);

  const fetchInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      // /invoices (legacy) returns { data, pagination }, not a bare array — the
      // old Array.isArray check always failed, so the CRM Invoices tab was empty.
      const res = await apiFetch<{ data?: any[] } | any[]>('/invoices');
      if (!mountedRef.current) return;
      setInvoices(Array.isArray(res) ? res : (res?.data ?? []));
    } catch { if (mountedRef.current) setInvoices([]); }
    finally { if (mountedRef.current) setInvoicesLoading(false); }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (taskFilter) params.set('status', taskFilter);
      const res = await apiFetch<CrmTask[]>(`/crm/tasks?${params}`);
      if (!mountedRef.current) return;
      setTasks(Array.isArray(res) ? res : []);
    } catch { if (mountedRef.current) setTasks([]); }
  }, [taskFilter]);

  const fetchClientActivity = useCallback(async (clientId: string) => {
    try {
      const res = await apiFetch<CrmActivity[]>(`/crm/activity/${clientId}`);
      if (!mountedRef.current) return;
      setClientActivity(Array.isArray(res) ? res : []);
    } catch { if (mountedRef.current) setClientActivity([]); }
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDashboard(), fetchClients(), fetchTasks(), apiFetch<any>('/personnel?status=active').then((r: any) => {
      if (cancelled) return;
      const list = Array.isArray(r) ? r : r?.data ?? [];
      setOfficers(list.map((u: any) => ({ id: String(u.id), full_name: u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username })));
    }).catch((err) => { console.warn('[CrmPage] fetch personnel failed:', err); })]).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [fetchDashboard, fetchClients, fetchTasks]);

  // ── URL deep-link: /crm?client_id=<n>&section=clients ──────────────────
  // Cross-page contract — incidents / cases / patrol can link directly to a
  // client. One-shot per page load; the param is stripped after applying so
  // back-button / refresh don't keep re-selecting the same row. Mirrors the
  // FlexCam (?request_id=) / AuditLog (?source_*=) pattern.
  const pendingClientIdRef = useRef<string | null>(searchParams.get('client_id'));
  // ?contact_id= routes to the Contacts tab and pre-searches by id.
  const pendingContactIdRef = useRef<string | null>(searchParams.get('contact_id'));
  // ?section= is seeded into activeSection at init time (above). Strip it
  // from the URL in a one-shot effect so refresh / back-button don't lock
  // the operator to the same tab when they've since navigated away.
  const pendingSectionStripRef = useRef<boolean>(searchParams.has('section'));

  useEffect(() => {
    const target = pendingClientIdRef.current;
    if (!target) return;
    // Wait until clients have loaded so the selection actually resolves;
    // an empty clients[] would silently drop the deep-link.
    if (clients.length === 0) return;
    pendingClientIdRef.current = null;
    // Switch to Clients section and select the target row.
    setActiveSection('clients');
    const found = clients.some(c => String(c.id) === target);
    if (!found) {
      addToast(`Client #${target} not found`, 'warning');
    }
    setSelectedClientId(target);
    const next = new URLSearchParams(searchParams);
    next.delete('client_id');
    next.delete('account_id');
    next.delete('section');
    next.delete('contact_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);

  // Strip standalone ?section= (when there's no client_id, the effect above
  // never fires, so the param would persist in the URL across navigation).
  // Also handles ?contact_id= routing when no client_id is present.
  useEffect(() => {
    const hasClientId = pendingClientIdRef.current !== null;
    // If client_id deep-link is also present, that effect handles all cleanup.
    if (hasClientId) return;

    const contactId = pendingContactIdRef.current;
    const shouldStrip = pendingSectionStripRef.current || contactId !== null;
    if (!shouldStrip) return;

    pendingSectionStripRef.current = false;
    pendingContactIdRef.current = null;

    if (contactId) {
      // Route to contacts tab and pre-fill search with the contact id so the
      // operator lands directly on that person without extra clicks.
      setActiveSection('contacts');
      setContactSearch(contactId);
    }

    const next = new URLSearchParams(searchParams);
    next.delete('section');
    next.delete('contact_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch section data on tab change
  useEffect(() => {
    if (activeSection === 'properties') fetchProperties();
    if (activeSection === 'contacts') fetchContacts();
    if (activeSection === 'invoices') fetchInvoices();
    if (activeSection === 'tasks') fetchTasks();
    if (activeSection === 'dashboard') {
      fetchDashboard();
      fetchPipelineSummary();
      fetchFollowUps();
      fetchSourceAnalytics();
      fetchRevenueForecast();
    }
  }, [activeSection, fetchProperties, fetchContacts, fetchInvoices, fetchTasks, fetchDashboard, fetchPipelineSummary, fetchFollowUps, fetchSourceAnalytics, fetchRevenueForecast]);

  // Live sync
  useLiveSync('admin', useCallback(() => { fetchClients(); fetchDashboard(); }, [fetchClients, fetchDashboard]));

  // When selected client changes, fetch their activity
  useEffect(() => {
    if (selectedClientId) fetchClientActivity(selectedClientId);
  }, [selectedClientId, fetchClientActivity]);

  // ── Task Handlers ──────────────────────────────────────
  const openNewTask = (clientId?: string) => {
    setEditingTask(null);
    setTaskForm({ client_id: clientId ? Number(clientId) as any : undefined, task_type: 'follow_up', priority: 'normal' });
    setShowTaskModal(true);
  };

  const openEditTask = (task: CrmTask) => {
    setEditingTask(task);
    setTaskForm({ ...task });
    setShowTaskModal(true);
  };

  const saveTask = async () => {
    setIsSavingTask(true);
    try {
      if (editingTask) {
        await apiFetch(`/crm/tasks/${editingTask.id}`, { method: 'PUT', body: JSON.stringify(taskForm) });
        addToast('Task updated', 'success');
      } else {
        await apiFetch('/crm/tasks', { method: 'POST', body: JSON.stringify(taskForm) });
        addToast('Task created', 'success');
      }
      setShowTaskModal(false);
      fetchTasks();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save task', 'error');
    } finally {
      setIsSavingTask(false);
    }
  };

  // Stage for confirm dialog; actual delete in confirmDeleteTask below.
  const deleteTask = (task: CrmTask) => { setTaskToDelete(task); };

  const confirmDeleteTask = useCallback(async () => {
    if (!taskToDelete) return;
    setDeletingTask(true);
    try {
      await apiFetch(`/crm/tasks/${taskToDelete.id}`, { method: 'DELETE' });
      addToast('Task deleted', 'success');
      setTaskToDelete(null);
      fetchTasks();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete task', 'error');
    } finally {
      setDeletingTask(false);
    }
  }, [taskToDelete, addToast, fetchTasks]);

  const toggleTaskComplete = async (task: CrmTask) => {
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    try {
      await apiFetch(`/crm/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
      fetchTasks();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update task', 'error');
    }
  };

  // ── Activity Handlers ──────────────────────────────────
  const logActivity = async () => {
    if (!activityForm.client_id || !activityForm.activity_type) return;
    setIsLoggingActivity(true);
    try {
      await apiFetch('/crm/activity', { method: 'POST', body: JSON.stringify(activityForm) });
      addToast('Activity logged', 'success');
      setShowActivityModal(false);
      setActivityForm({ client_id: '', activity_type: 'note', subject: '', details: '' });
      if (selectedClientId) fetchClientActivity(selectedClientId);
      fetchDashboard();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to log activity', 'error');
    } finally {
      setIsLoggingActivity(false);
    }
  };

  // ── Filtered Data ──────────────────────────────────────
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.contact_name?.toLowerCase().includes(q) ||
      c.contact_email?.toLowerCase().includes(q) ||
      c.address?.toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  const filteredProperties = useMemo(() => {
    if (!propertySearch.trim()) return properties;
    const q = propertySearch.toLowerCase();
    return properties.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.address?.toLowerCase().includes(q) ||
      (p as any).client_name?.toLowerCase().includes(q)
    );
  }, [properties, propertySearch]);

  const filteredInvoices = useMemo(() => {
    if (!invoiceFilter) return invoices;
    return invoices.filter(i => i.status === invoiceFilter);
  }, [invoices, invoiceFilter]);

  const selectedClient = useMemo(() => {
    if (!selectedClientId) return null;
    return clients.find(c => String(c.id) === selectedClientId) || null;
  }, [clients, selectedClientId]);

  // ── Right-click context menus ──
  const buildClientMenu = (c: Client): ContextMenuItem[] => [
    m.action('Open client', () => setSelectedClientId(String(c.id)), { icon: <Eye size={12} /> }),
    m.action('Edit client', () => { setEditingClient(c); setShowClientModal(true); }, { icon: <Edit3 size={12} /> }),
    m.action('New task', () => openNewTask(String(c.id)), { icon: <Plus size={12} /> }),
    m.separator(),
    m.copy('Copy name', c.name),
    ...(c.contact_phone ? [m.copy('Copy phone', c.contact_phone, <Phone size={12} />)] : []),
    ...(c.contact_email ? [m.copy('Copy email', c.contact_email, <Mail size={12} />)] : []),
    m.copyId(c.id),
  ];

  const buildTaskMenu = (task: CrmTask): ContextMenuItem[] => [
    m.action(task.status === 'completed' ? 'Mark incomplete' : 'Mark complete', () => toggleTaskComplete(task), { icon: <CheckSquare size={12} /> }),
    m.action('Edit task', () => openEditTask(task), { icon: <Edit3 size={12} /> }),
    m.separator(),
    m.copy('Copy title', task.title),
    m.copyId(task.id),
    m.separator(),
    m.action('Delete', () => deleteTask(task), { icon: <Trash2 size={12} />, danger: true }),
  ];

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════
  // Set document title
  useEffect(() => { document.title = 'CRM \u2014 RMPG Flex'; }, []);

  // Keyboard shortcuts
  // - Esc smart-cascade: close the NEWEST-open modal first, then the
  //   activity modal, the client modal, then drop the selected client.
  //   Matches the page-wide audit contract (FlexCam, AuditLog).
  // - 'N' opens a new record relevant to the current section (parity with
  //   Cases / Audit Log shortcut surface). Skipped while typing.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Cascade: innermost modal first → task delete confirm → task edit → activity → client → client selection
        if (taskToDelete) { setTaskToDelete(null); return; }
        if (showTaskModal) { setShowTaskModal(false); setEditingTask(null); return; }
        if (showActivityModal) { setShowActivityModal(false); return; }
        if (showClientModal) { setShowClientModal(false); setEditingClient(null); return; }
        if (selectedClientId) { setSelectedClientId(null); return; }
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isTypingInField(e.target)) return;
        // Don't shortcut while a modal is already open.
        if (taskToDelete || showTaskModal || showActivityModal || showClientModal) return;
        if (activeSection === 'tasks') { e.preventDefault(); openNewTask(); return; }
        if (activeSection === 'clients') { e.preventDefault(); setEditingClient(null); setShowClientModal(true); return; }
        if (activeSection === 'dashboard') {
          e.preventDefault();
          setActivityForm({ client_id: '', activity_type: 'note', subject: '', details: '' });
          setShowActivityModal(true);
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [taskToDelete, showTaskModal, showActivityModal, showClientModal, selectedClientId, activeSection]);
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading" />
      </div>
    );
  }

  const buildContactMenu = (c: any): ContextMenuItem[] => {
    return [
      m.copy('Copy name', `${c.first_name} ${c.last_name}`),
      m.copy('Copy email', c.email || ''),
      m.copy('Copy phone', c.phone || ''),
    ];
  };

  const deleteContact = async (c: any) => {
    try { await apiFetch(`/crm/contacts/${c.id}`, { method: 'DELETE' }); setContacts((prev) => prev.filter((x) => x.id !== c.id)); addToast('Contact deleted', 'success'); } catch { addToast('Failed to delete contact', 'error'); }
  };


  return (
    <div className="flex h-full">
      {/* ── Sidebar ────────────────────────────────────── */}
      <div className="w-48 border-r border-rmpg-600 bg-surface-sunken flex flex-col flex-shrink-0">
        <div className="px-3 py-2.5 border-b border-rmpg-600" style={{ background: 'var(--surface-deep)' }}>
          <div className="flex items-center gap-2">
            <RmpgLogo height={14} iconOnly />
            <span className="text-xs font-bold text-brand-400 tracking-wider uppercase">Overwatch</span>
          </div>
        </div>
        <nav className="flex-1 py-1">
          {SIDEBAR_ITEMS.filter(item => !item.intelOnly || isIntelUser).map(item => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button type="button"
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-all duration-150 ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-400 border-l-2 border-brand-400 font-medium'
                    : 'text-rmpg-300 hover:bg-rmpg-700/30 hover:text-rmpg-200 border-l-2 border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                {item.label}
                {item.id === 'tasks' && tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length > 0 && (
                  <span className="ml-auto text-[8px] font-mono font-bold px-1.5 py-0.5 bg-amber-900/30 text-amber-400 border border-amber-700/50 tabular-nums" style={{ borderRadius: '2px' }}>
                    {tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Main Content ──────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {fetchError && (
          <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2 shadow-lg">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
            <span className="flex-1">{fetchError}</span>
            <button type="button" className="toolbar-btn" onClick={() => { void fetchDashboard(); void fetchClients(); void fetchTasks(); }}>Retry</button>
          </div>
        )}
        {activeSection === 'dashboard' && renderDashboard()}
        {activeSection === 'leads' && <LeadsTab />}
        {activeSection === 'clients' && renderClients()}
        {activeSection === 'properties' && renderProperties()}
        {activeSection === 'contacts' && renderContacts()}
        {activeSection === 'proposals' && <ProposalsTab />}
        {activeSection === 'invoices' && renderInvoices()}
        {activeSection === 'tasks' && renderTasks()}
        {activeSection === 'reports' && <ReportsTab />}
        {activeSection === 'webintel' && (isIntelUser ? <WebIntelPanel /> : renderIntelGate())}
        {activeSection === 'competitors' && (isIntelUser ? <CompetitorMonitorPanel /> : renderIntelGate())}
        {activeSection === 'firecrawl' && (isIntelUser ? <FirecrawlTab /> : renderIntelGate())}
        {activeSection === 'deepresearch' && (isIntelUser ? <DeepResearchTab /> : renderIntelGate())}
      </div>

      {/* ── Task Modal ────────────────────────────────── */}
      {showTaskModal && (
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true" onClick={() => setShowTaskModal(false)}>
          <div className="bg-surface-raised border border-rmpg-600 w-full max-w-lg shadow-xl my-auto" onClick={e => e.stopPropagation()}>
            <div className="panel-title-bar flex items-center justify-between">
              <span className="text-xs font-bold text-rmpg-100">{editingTask ? 'Edit Task' : 'New Task'}</span>
              <IconButton onClick={() => setShowTaskModal(false)} className="text-rmpg-400 hover:text-rmpg-200" aria-label="Close task modal"><X className="w-3.5 h-3.5" /></IconButton>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="ff-crmpage-0" className="field-label">Title</label>
                <input id="ff-crmpage-0" className="input-dark w-full min-h-[36px]" value={taskForm.title || ''} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-crmpage-1" className="field-label">Type</label>
                  <select id="ff-crmpage-1" className="input-dark w-full min-h-[36px]" value={taskForm.task_type || 'follow_up'} onChange={e => setTaskForm(p => ({ ...p, task_type: e.target.value as any }))}>
                    {TASK_TYPES.map(t => <option key={t} value={t}>{toDisplayLabel(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-crmpage-2" className="field-label">Priority</label>
                  <select id="ff-crmpage-2" className="input-dark w-full min-h-[36px]" value={taskForm.priority || 'normal'} onChange={e => setTaskForm(p => ({ ...p, priority: e.target.value as any }))}>
                    {TASK_PRIORITIES.map(p => <option key={p} value={p}>{toDisplayLabel(p)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-crmpage-3" className="field-label">Due Date</label>
                  <input id="ff-crmpage-3" type="date" className="input-dark w-full min-h-[36px]" value={taskForm.due_date || ''} onChange={e => setTaskForm(p => ({ ...p, due_date: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="ff-crmpage-4" className="field-label">Assign To</label>
                  <select id="ff-crmpage-4" className="input-dark w-full min-h-[36px]" value={taskForm.assigned_to || ''} onChange={e => setTaskForm(p => ({ ...p, assigned_to: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="ff-crmpage-5" className="field-label">Client</label>
                <select id="ff-crmpage-5" className="input-dark w-full min-h-[36px]" value={String(taskForm.client_id || '')} onChange={e => setTaskForm(p => ({ ...p, client_id: e.target.value ? Number(e.target.value) as any : undefined }))}>
                  <option value="">No client</option>
                  {clients.filter(c => c.is_active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ff-crmpage-11" className="field-label">Description</label>
                <RichTextArea className="input-dark w-full min-h-[36px]" rows={3} value={taskForm.description || ''} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))} />
              </div>
              {editingTask && (
                <div>
                  <label htmlFor="ff-crmpage-6" className="field-label">Status</label>
                  <select id="ff-crmpage-6" className="input-dark w-full min-h-[36px]" value={taskForm.status || 'pending'} onChange={e => setTaskForm(p => ({ ...p, status: e.target.value as any }))}>
                    {TASK_STATUSES.map(s => <option key={s} value={s}>{toDisplayLabel(s)}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600 bg-surface-sunken/50">
              <button type="button" onClick={() => setShowTaskModal(false)} className="toolbar-btn">Cancel</button>
              <button type="button" onClick={saveTask} className="toolbar-btn toolbar-btn-primary print:hidden" disabled={!taskForm.title?.trim() || isSavingTask}>
                <Save className="w-3 h-3" /> {editingTask ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Activity Log Modal ────────────────────────── */}
      {showActivityModal && (
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true" onClick={() => setShowActivityModal(false)}>
          <div className="bg-surface-raised border border-rmpg-600 w-full max-w-md shadow-xl my-auto" onClick={e => e.stopPropagation()}>
            <div className="panel-title-bar flex items-center justify-between">
              <span className="text-xs font-bold text-rmpg-100">Log Activity</span>
              <IconButton onClick={() => setShowActivityModal(false)} className="text-rmpg-400 hover:text-rmpg-200" aria-label="Close activity modal"><X className="w-3.5 h-3.5" /></IconButton>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="ff-crmpage-7" className="field-label">Client</label>
                <select id="ff-crmpage-7" className="input-dark w-full min-h-[36px]" value={activityForm.client_id} onChange={e => setActivityForm(p => ({ ...p, client_id: e.target.value }))}>
                  <option value="">Select client...</option>
                  {clients.filter(c => c.is_active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ff-crmpage-8" className="field-label">Type</label>
                <select id="ff-crmpage-8" className="input-dark w-full min-h-[36px]" value={activityForm.activity_type} onChange={e => setActivityForm(p => ({ ...p, activity_type: e.target.value }))}>
                  {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{toDisplayLabel(t)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ff-crmpage-9" className="field-label">Subject</label>
                <input id="ff-crmpage-9" className="input-dark w-full min-h-[36px]" value={activityForm.subject} onChange={e => setActivityForm(p => ({ ...p, subject: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="ff-crmpage-10" className="field-label">Details</label>
                <RichTextArea className="input-dark w-full min-h-[36px]" rows={3} value={activityForm.details} onChange={e => setActivityForm(p => ({ ...p, details: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
              <button type="button" onClick={() => setShowActivityModal(false)} className="toolbar-btn">Cancel</button>
              <button type="button" onClick={logActivity} className="toolbar-btn toolbar-btn-primary print:hidden" disabled={!activityForm.client_id || isLoggingActivity}>
                <Save className="w-3 h-3" /> Log
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Form Modal */}
      {showClientModal && (
        <ClientFormModal
          isOpen={showClientModal}
          onClose={() => { setShowClientModal(false); setEditingClient(null); }}
          onSubmit={async (data: any) => {
            setIsSubmittingClient(true);
            try {
              if (editingClient) {
                await apiFetch(`/admin/clients/${editingClient.id}`, { method: 'PUT', body: JSON.stringify(data) });
                addToast('Client updated', 'success');
              } else {
                await apiFetch('/admin/clients', { method: 'POST', body: JSON.stringify(data) });
                addToast('Client created', 'success');
              }
              setShowClientModal(false);
              setEditingClient(null);
              fetchClients();
              fetchDashboard();
            } catch (err) {
              addToast(err instanceof Error ? err.message : 'Failed to save client', 'error');
            } finally {
              setIsSubmittingClient(false);
            }
          }}
          editingClient={editingClient}
          isSubmitting={isSubmittingClient}
        />
      )}

      {/* ── Task Delete Confirmation ───────────────────── */}
      <ConfirmDialog
        isOpen={taskToDelete !== null}
        onClose={() => { if (!deletingTask) setTaskToDelete(null); }}
        onConfirm={confirmDeleteTask}
        title="Delete task?"
        message="This permanently removes the task."
        details={taskToDelete ? (
          <div className="mt-2 text-[11px] text-rmpg-300">
            <div><span className="text-rmpg-500">Title:</span> {taskToDelete.title}</div>
            {taskToDelete.client_name && <div><span className="text-rmpg-500">Client:</span> {taskToDelete.client_name}</div>}
          </div>
        ) : undefined}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deletingTask}
      />
    </div>
  );

  // ════════════════════════════════════════════════════════
  // SECTION RENDERERS
  // ════════════════════════════════════════════════════════

  function renderIntelGate() {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 max-w-xs">
          <AlertTriangle className="w-8 h-8 text-rmpg-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-rmpg-400">Access restricted</p>
          <p className="text-xs text-rmpg-600 mt-1">This section requires supervisor, manager, or admin role.</p>
        </div>
      </div>
    );
  }

  function renderDashboard() {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
        <PanelTitleBar title="OVERWATCH DASHBOARD" icon={LayoutDashboard}>
          <RmpgLogo height={16} iconOnly />
          <ExportButton exportUrl="/api/crm/export/csv" exportFilename="crm.csv" />
          <button type="button" onClick={() => fetchDashboard()} className="toolbar-btn"><RefreshCw className="w-3 h-3" /> Refresh</button>
          <button type="button" onClick={() => { setActivityForm({ client_id: '', activity_type: 'note', subject: '', details: '' }); setShowActivityModal(true); }} className="toolbar-btn toolbar-btn-primary print:hidden">
            <Plus className="w-3 h-3" /> Log Activity
          </button>
        </PanelTitleBar>

        {stats && (
          <div className="p-4 space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={Building2} label="Active Clients" value={stats.active_clients} sub={`${stats.total_clients} total`} color="text-brand-400" />
              <StatCard icon={DollarSign} label="Outstanding" value={formatCurrency(stats.outstanding_revenue)} sub={`${stats.overdue_invoices} overdue`} color="text-amber-400" />
              <StatCard icon={TrendingUp} label="Invoiced MTD" value={formatCurrency(stats.total_invoiced_mtd)} sub={`${formatCurrency(stats.total_paid_mtd)} paid`} color="text-green-400" />
              <StatCard icon={CheckSquare} label="Pending Tasks" value={stats.pending_tasks} sub={`${stats.expiring_contracts} contracts expiring`} color="text-rmpg-400" />
            </div>

            {/* Feature 15: Revenue Forecast */}
            {revenueForecast && (
              <div className="panel-inset p-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-xs font-bold text-rmpg-100">Revenue Forecast</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div><div className="text-lg font-bold text-green-400 font-mono">{formatCurrency(revenueForecast.won_revenue)}</div><div className="text-[9px] text-rmpg-400 uppercase">Won</div></div>
                  <div><div className="text-lg font-bold text-brand-300 font-mono">{formatCurrency(revenueForecast.total_expected)}</div><div className="text-[9px] text-rmpg-400 uppercase">Expected</div></div>
                  <div><div className="text-lg font-bold text-rmpg-100 font-mono">{formatCurrency(revenueForecast.total_pipeline)}</div><div className="text-[9px] text-rmpg-400 uppercase">Total Pipeline</div></div>
                  <div><div className="text-lg font-bold text-amber-400 font-mono">{revenueForecast.active_deals}</div><div className="text-[9px] text-rmpg-400 uppercase">Active Deals</div></div>
                </div>
              </div>
            )}

            {/* Feature 12: Pipeline Summary */}
            {pipelineSummary && (
              <div className="panel-inset p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-3.5 h-3.5 text-brand-400" />
                  <span className="text-xs font-bold text-rmpg-100">Sales Pipeline</span>
                </div>
                <div className="flex gap-1">
                  {(pipelineSummary.stages || []).map((s: any) => {
                    const stageColors: Record<string, string> = { new: 'bg-rmpg-600', contacted: 'bg-rmpg-700', qualified: 'bg-rmpg-700', proposal: 'bg-amber-700', negotiation: 'bg-orange-700', won: 'bg-green-700', lost: 'bg-red-700' };
                    return (
                      <div key={s.pipeline_stage} className={`flex-1 ${stageColors[s.pipeline_stage] || 'bg-rmpg-700'} px-2 py-2 text-center hover:brightness-110 transition-all cursor-default`} style={{ borderRadius: '2px' }}>
                        <div className="text-sm font-bold text-rmpg-100 font-mono tabular-nums">{s.count}</div>
                        <div className="text-[8px] text-rmpg-100/70 uppercase font-bold tracking-wider">{formatEnumValue(s.pipeline_stage)}</div>
                        {s.total_value > 0 && <div className="text-[8px] text-rmpg-100/50 font-mono">{formatCurrency(s.total_value)}</div>}
                      </div>
                    );
                  })}
                </div>
                {pipelineSummary.conversions?.length > 0 && (
                  <div className="mt-2 flex items-center gap-1 text-[9px] text-rmpg-400">
                    {pipelineSummary.conversions.map((c: any, i: number) => (
                      <span key={i}>{c.from} → {c.to}: <span className="text-rmpg-100 font-bold">{c.rate}%</span>{i < pipelineSummary.conversions.length - 1 ? ' | ' : ''}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Feature 13: Follow-up Reminders + Feature 14: Source Analytics */}
            <div className="grid grid-cols-2 gap-4">
              {/* Follow-ups */}
              {followUps && (
                <div className="panel-inset p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-rmpg-100">Follow-up Reminders</span>
                  </div>
                  {(followUps.overdue?.length || 0) > 0 && (
                    <div className="mb-2">
                      <div className="text-[9px] text-red-400 font-bold uppercase mb-1">Overdue ({followUps.overdue.length})</div>
                      {followUps.overdue.slice(0, 5).map((l: any) => (
                        <div key={l.id} className="text-[10px] flex gap-2 py-0.5 text-red-300">
                          <span className="min-w-0 flex-1 truncate">{l.business_name}</span>
                          <span className="text-rmpg-500">{l.next_follow_up}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(followUps.today?.length || 0) > 0 && (
                    <div className="mb-2">
                      <div className="text-[9px] text-amber-400 font-bold uppercase mb-1">Today ({followUps.today.length})</div>
                      {followUps.today.slice(0, 5).map((l: any) => (
                        <div key={l.id} className="text-[10px] flex gap-2 py-0.5 text-amber-300">
                          <span className="min-w-0 flex-1 truncate">{l.business_name}</span>
                          <span className="text-rmpg-500">Score: {l.lead_score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(followUps.upcoming?.length || 0) > 0 && (
                    <div>
                      <div className="text-[9px] text-rmpg-400 font-bold uppercase mb-1">Upcoming ({followUps.upcoming.length})</div>
                      {followUps.upcoming.slice(0, 3).map((l: any) => (
                        <div key={l.id} className="text-[10px] flex gap-2 py-0.5 text-rmpg-300">
                          <span className="min-w-0 flex-1 truncate">{l.business_name}</span>
                          <span className="text-rmpg-500">{l.next_follow_up}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!followUps.overdue?.length && !followUps.today?.length && !followUps.upcoming?.length && (
                    <p className="text-xs text-rmpg-400">No follow-ups scheduled</p>
                  )}
                </div>
              )}

              {/* Feature 14: Lead Source Analytics */}
              {sourceAnalytics && (
                <div className="panel-inset p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-3.5 h-3.5 text-rmpg-400" />
                    <span className="text-xs font-bold text-rmpg-100">Lead Sources ({sourceAnalytics.period_days}d)</span>
                  </div>
                  <div className="space-y-1">
                    {(sourceAnalytics.data || []).slice(0, 8).map((s: any) => (
                      <div key={s.source} className="flex items-center gap-2 text-[10px]">
                        <span className="w-24 text-rmpg-300 truncate capitalize">{toDisplayLabel(s.source ?? '')}</span>
                        <div className="flex-1 bg-rmpg-700 h-2 overflow-hidden" style={{ borderRadius: '2px' }}>
                          <div className="h-full bg-brand-500 transition-all duration-300" style={{ width: `${Math.min(100, (s.total_leads / (sourceAnalytics.data[0]?.total_leads || 1)) * 100)}%`, borderRadius: '2px' }} />
                        </div>
                        <span className="text-rmpg-100 w-6 text-right">{s.total_leads}</span>
                        <span className="text-green-400 w-10 text-right">{s.conversion_rate}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Expiring Contracts */}
              <div className="panel-inset p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-bold text-rmpg-100">Expiring Contracts (90 days)</span>
                </div>
                {expiringContracts.length === 0 ? (
                  <p className="text-xs text-rmpg-400">No contracts expiring soon</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
                    {expiringContracts.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between text-xs p-1.5 bg-surface-sunken border border-rmpg-700/30">
                        <div>
                          <span className="text-rmpg-200 font-medium">{c.name}</span>
                          <span className="text-rmpg-400 ml-2">{c.contact_name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-amber-400 font-mono">{formatDate(c.contract_end)}</span>
                          {c.auto_renew && <span className="text-green-400 text-[9px]">AUTO-RENEW</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Activity */}
              <div className="panel-inset p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-xs font-bold text-rmpg-100">Recent Activity</span>
                </div>
                {recentActivity.length === 0 ? (
                  <p className="text-xs text-rmpg-400">No recent activity</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
                    {recentActivity.slice(0, 10).map((a: any) => (
                      <div key={a.id} className="text-xs p-1.5 bg-surface-sunken border border-rmpg-700/30">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-rmpg-200">{a.client_name || 'Unknown'}</span>
                          <span className="text-rmpg-400 font-mono">{formatDateTime(a.created_at)}</span>
                        </div>
                        <div className="text-rmpg-300 mt-0.5">
                          <span className={`inline-block px-1 py-0.5 text-[9px] font-bold border ${
                            a.activity_type === 'call' ? 'text-green-400 border-green-700/50 bg-green-900/20' :
                            a.activity_type === 'email' ? 'text-rmpg-400 border-border-default/50 bg-surface-sunken/20' :
                            'text-rmpg-300 border-rmpg-600 bg-rmpg-800/20'
                          }`}>{toDisplayLabel(a.activity_type)}</span>
                          {a.subject && <span className="ml-1.5">{a.subject}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderClients() {
    return (
      <div className="flex h-full">
        {/* Client List */}
        <div className="w-80 border-r border-rmpg-600 flex flex-col flex-shrink-0">
          <PanelTitleBar title="CLIENTS" icon={Building2}>
            <input id="ff-crmpage-10" ref={clientSearchRef} className="input-dark text-xs flex-1 min-h-[36px]" style={{ maxWidth: 120 }} placeholder="Search… (/)" aria-label="Search..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
            <button
              type="button"
              className="toolbar-btn"
              disabled={filteredClients.length === 0}
              onClick={() => downloadTextFile('crm-accounts.csv', crmAccountsToCsv(filteredClients.map((c) => ({
                account_name: c.name,
                type: c.contract_type ?? '',
                status: c.is_active === false ? 'inactive' : 'active',
              }))))}
            >CSV</button>
            <button type="button" onClick={() => { setEditingClient(null); setShowClientModal(true); }} className="toolbar-btn toolbar-btn-primary print:hidden">
              <Plus className="w-3 h-3" /> New
            </button>
          </PanelTitleBar>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
            {filteredClients.length === 0 && !isLoading && (
              <div className="text-center py-12 text-rmpg-500">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                  <Building2 size={24} className="text-rmpg-600" />
                </div>
                <p className="text-sm font-medium text-rmpg-400">{clientSearch ? 'No clients match your search' : 'No clients yet'}</p>
                <p className="text-xs text-rmpg-600 mt-1">{clientSearch ? 'Try a different search term' : 'Click "New" to add your first client'}</p>
              </div>
            )}
            {filteredClients.map(c => (
              <button type="button"
                key={c.id}
                onClick={() => setSelectedClientId(String(c.id))}
                onContextMenu={(e) => openMenu(e, buildClientMenu(c))}
                className={`w-full text-left px-3 py-2 border-b border-rmpg-700/30 transition-colors ${
                  selectedClientId === String(c.id) ? 'bg-brand-600/15 border-l-2 border-l-brand-400' : 'hover:bg-rmpg-700/20 border-l-2 border-l-transparent'
                }`}
              >
                <div className="text-xs font-medium text-rmpg-200">{c.name}</div>
                <div className="text-[10px] text-rmpg-400 flex items-center gap-2 mt-0.5">
                  {c.contact_name && <span>{c.contact_name}</span>}
                  {c.is_active === false && <span className="text-red-400">INACTIVE</span>}
                  {(c as any).priority_client && <span className="text-amber-400">PRIORITY</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Client Detail */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
          {selectedClient ? (
            <div>
              <div className="panel-title-bar flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-rmpg-100">{selectedClient.name}</span>
                  {(selectedClient as any).priority_client && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 text-amber-400 bg-amber-900/30 border border-amber-700/50">PRIORITY</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => { setEditingClient(selectedClient); setShowClientModal(true); }} className="toolbar-btn"><Edit3 className="w-3 h-3" /> Edit</button>
                  <button type="button" onClick={() => openNewTask(selectedClientId!)} className="toolbar-btn"><Plus className="w-3 h-3" /> Task</button>
                  <button type="button" onClick={() => { setActivityForm({ client_id: selectedClientId!, activity_type: 'note', subject: '', details: '' }); setShowActivityModal(true); }} className="toolbar-btn">
                    <Activity className="w-3 h-3" /> Log
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Contact Info */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Contact</div>
                    <div className="text-xs text-rmpg-200">{selectedClient.contact_name || '—'}</div>
                    {selectedClient.contact_phone && (
                      <div className="flex items-center gap-1 text-[10px] text-rmpg-400 mt-0.5"><Phone className="w-2.5 h-2.5" />{selectedClient.contact_phone}</div>
                    )}
                    {selectedClient.contact_email && (
                      <div className="flex items-center gap-1 text-[10px] text-rmpg-400 mt-0.5"><Mail className="w-2.5 h-2.5" />{selectedClient.contact_email}</div>
                    )}
                  </div>
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Contract</div>
                    <div className="text-xs text-rmpg-200">{(selectedClient as any).contract_type || 'Standard'}</div>
                    <div className="text-[10px] text-rmpg-400 mt-0.5">
                      {selectedClient.contract_start && formatDate(selectedClient.contract_start)} — {selectedClient.contract_end && formatDate(selectedClient.contract_end)}
                    </div>
                    {(selectedClient as any).contract_value && (
                      <div className="text-[10px] text-green-400 mt-0.5">{formatCurrency((selectedClient as any).contract_value)}</div>
                    )}
                  </div>
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Billing</div>
                    <div className="text-xs text-rmpg-200">
                      Outstanding: <span className="text-amber-400">{formatCurrency((selectedClient as any).outstanding_balance || 0)}</span>
                    </div>
                    <div className="text-[10px] text-rmpg-400 mt-0.5">
                      Total: {formatCurrency((selectedClient as any).total_invoiced || 0)} | Paid: {formatCurrency((selectedClient as any).total_paid || 0)}
                    </div>
                  </div>
                </div>

                {/* Address */}
                {selectedClient.address && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Address</div>
                    <div className="text-xs text-rmpg-200">{selectedClient.address}</div>
                  </div>
                )}

                {/* Activity Feed */}
                <div className="panel-inset p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-rmpg-100">Activity Timeline</span>
                    <button type="button" onClick={() => { setActivityForm({ client_id: selectedClientId!, activity_type: 'note', subject: '', details: '' }); setShowActivityModal(true); }} className="toolbar-btn">
                      <Plus className="w-3 h-3" /> Log
                    </button>
                  </div>
                  {clientActivity.length === 0 ? (
                    <p className="text-xs text-rmpg-400">No activity recorded</p>
                  ) : (
                    <div className="relative pl-5 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
                      <div className="absolute left-1.5 top-0 bottom-0 w-px bg-rmpg-700" />
                      {clientActivity.map((a: any) => {
                        const dotColor = a.activity_type === 'call' ? 'bg-green-500' :
                          a.activity_type === 'email' ? 'bg-rmpg-500' :
                          a.activity_type === 'meeting' ? 'bg-purple-500' :
                          a.activity_type === 'invoice' ? 'bg-amber-500' :
                          a.activity_type === 'contract_change' ? 'bg-rmpg-500' : 'bg-rmpg-500';
                        return (
                          <div key={a.id} className="relative mb-2">
                            <div className={`absolute -left-[14px] top-1.5 w-2 h-2 rounded-full ${dotColor}`} />
                            <div className="text-xs p-1.5 bg-surface-sunken border border-rmpg-700/30">
                              <div className="flex items-center justify-between">
                                <span className={`inline-block px-1 py-0.5 text-[9px] font-bold border ${
                                  a.activity_type === 'call' ? 'text-green-400 border-green-700/50 bg-green-900/20' :
                                  a.activity_type === 'email' ? 'text-rmpg-400 border-border-default/50 bg-surface-sunken/20' :
                                  a.activity_type === 'meeting' ? 'text-purple-400 border-purple-700/50 bg-purple-900/20' :
                                  'text-rmpg-300 border-rmpg-600 bg-rmpg-800/20'
                                }`}>{toDisplayLabel(a.activity_type)}</span>
                                <span className="text-rmpg-400 font-mono">{formatDateTime(a.created_at)}</span>
                              </div>
                              {a.subject && <div className="text-rmpg-200 font-medium mt-0.5">{a.subject}</div>}
                              {a.details && <div className="text-rmpg-300 mt-0.5">{a.details}</div>}
                              {a.created_by_name && <div className="text-rmpg-500 mt-0.5">-- {a.created_by_name}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Notes */}
                {selectedClient.notes && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Notes</div>
                    <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selectedClient.notes}</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-rmpg-400 text-sm">
              Select a client to view details
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderProperties() {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
        <PanelTitleBar title="PROPERTIES" icon={MapPin}>
          <input id="ff-crmpage-11" className="input-dark text-xs min-h-[36px]" style={{ maxWidth: 200 }} placeholder="Search properties..." aria-label="Search properties..." value={propertySearch} onChange={e => setPropertySearch(e.target.value)} />
        </PanelTitleBar>
        <div className="p-4">
          {propertiesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading properties" />
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="text-center py-12 text-rmpg-400 text-sm">
              <MapPin className="w-8 h-8 mx-auto mb-3 text-rmpg-600" />
              <p className="font-medium">
                {propertySearch.trim()
                  ? `No properties match "${propertySearch}"`
                  : 'No properties yet'}
              </p>
              <p className="text-xs text-rmpg-600 mt-1">
                {propertySearch.trim() ? 'Try a different search term' : 'Properties linked to clients will appear here'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filteredProperties.map(p => (
                <div key={p.id} className="panel-inset p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-rmpg-200">{p.name}</span>
                    {(p as any).property_type && <span className="text-[9px] px-1.5 py-0.5 bg-rmpg-800/30 text-rmpg-400 border border-rmpg-700/50">{(p as any).property_type}</span>}
                  </div>
                  <div className="text-[10px] text-rmpg-400 flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5" /> {p.address}
                  </div>
                  {(p as any).client_name && (
                    <div className="text-[10px] text-brand-400 mt-0.5 flex items-center gap-1">
                      <Building2 className="w-2.5 h-2.5" /> {(p as any).client_name}
                    </div>
                  )}
                  {(p as any).hazard_notes && (
                    <div className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> {(p as any).hazard_notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderContacts() {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
        <PanelTitleBar title="CONTACTS" icon={Users}>
          <input id="ff-crmpage-12" className="input-dark text-xs min-h-[36px]" style={{ maxWidth: 200 }} placeholder="Search contacts..." aria-label="Search contacts..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
          <select id="ff-crmpage-13" className="input-dark text-xs min-h-[36px]" style={{ maxWidth: 140 }} value={contactRelationship} onChange={e => setContactRelationship(e.target.value)}>
            <option value="">All Relationships</option>
            {RELATIONSHIP_TYPES.map(r => <option key={r} value={r}>{toDisplayLabel(r)}</option>)}
          </select>
          <button type="button" onClick={fetchContacts} className="toolbar-btn"><Search className="w-3 h-3" /> Search</button>
        </PanelTitleBar>
        <div className="p-4">
          {contactsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading contacts" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-12 text-rmpg-400 text-sm">
              <Users className="w-8 h-8 mx-auto mb-3 text-rmpg-600" />
              <p className="font-medium">
                {(contactSearch.trim() || contactRelationship)
                  ? 'No contacts match these filters'
                  : 'No contacts yet'}
              </p>
              <p className="text-xs text-rmpg-600 mt-1">
                {(contactSearch.trim() || contactRelationship)
                  ? 'Clear filters or try a different search'
                  : 'Contacts are linked to clients and properties'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-surface-sunken">
                  <tr className="text-left text-rmpg-400 border-b border-rmpg-600">
                    <th className="p-2 font-medium">Name</th>
                    <th className="p-2 font-medium">Client</th>
                    <th className="p-2 font-medium">Relationship</th>
                    <th className="p-2 font-medium">Phone</th>
                    <th className="p-2 font-medium">Email</th>
                    <th className="p-2 font-medium">Title</th>
                    {canManage && <th className="p-2 font-medium w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c: any) => (
                    <tr key={c.id} onContextMenu={(e) => openMenu(e, buildContactMenu(c))} className="border-b border-rmpg-700/30 hover:bg-surface-raised/50 transition-colors">
                      <td className="p-2 text-rmpg-200">{c.first_name} {c.last_name}</td>
                      <td className="p-2 text-brand-400">{c.client_name}</td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold border ${
                          c.relationship === 'banned' ? 'text-red-400 border-red-700/50 bg-red-900/20' :
                          c.relationship === 'owner' ? 'text-amber-400 border-amber-700/50 bg-amber-900/20' :
                          'text-rmpg-300 border-rmpg-600 bg-rmpg-800/20'
                        }`}>{toDisplayLabel(c.relationship)}</span>
                      </td>
                      <td className="p-2 text-rmpg-300 font-mono">{c.phone || '—'}</td>
                      <td className="p-2 text-rmpg-300">{c.person_email || '—'}</td>
                      <td className="p-2 text-rmpg-400">{c.title || '—'}</td>
                      {canManage && (
                        <td className="p-2">
                          <IconButton onClick={() => deleteContact(c)} className="p-1 text-rmpg-500 hover:text-red-400" aria-label={`Delete contact ${c.first_name} ${c.last_name}`}><Trash2 className="w-3 h-3" /></IconButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderInvoices() {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
        <PanelTitleBar title="INVOICES" icon={FileText}>
          <select id="ff-crmpage-14" className="input-dark text-xs min-h-[36px]" style={{ maxWidth: 140 }} value={invoiceFilter} onChange={e => setInvoiceFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="overdue">Overdue</option>
          </select>
        </PanelTitleBar>
        <div className="p-4">
          {invoicesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading invoices" />
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-12 text-rmpg-400 text-sm">
              <FileText className="w-8 h-8 mx-auto mb-3 text-rmpg-600" />
              <p className="font-medium">
                {invoiceFilter
                  ? `No invoices with status "${toDisplayLabel(invoiceFilter)}"`
                  : 'No invoices yet'}
              </p>
              <p className="text-xs text-rmpg-600 mt-1">
                {invoiceFilter ? 'Clear the status filter to see all invoices' : 'Invoices will appear here once created'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-surface-sunken">
                  <tr className="text-left text-rmpg-400 border-b border-rmpg-600">
                    <th className="p-2 font-medium">Invoice #</th>
                    <th className="p-2 font-medium">Client</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium">Period</th>
                    <th className="p-2 font-medium text-right">Total</th>
                    <th className="p-2 font-medium text-right">Balance</th>
                    <th className="p-2 font-medium">Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((inv: any) => (
                    <tr key={inv.id} className="border-b border-rmpg-700/30 hover:bg-surface-raised/50 transition-colors">
                      <td className="p-2 text-green-400 font-mono">{inv.invoice_number}</td>
                      <td className="p-2 text-rmpg-200">{inv.client_name || '—'}</td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold border ${invoiceStatusColor(inv.status)}`}>
                          {toDisplayLabel(inv.status)}
                        </span>
                      </td>
                      <td className="p-2 text-rmpg-400 font-mono">{formatDate(inv.period_start)} — {formatDate(inv.period_end)}</td>
                      <td className="p-2 text-rmpg-200 text-right font-mono">{formatCurrency(inv.total || 0)}</td>
                      <td className="p-2 text-right font-mono">
                        <span className={(inv.balance_due || 0) > 0 ? 'text-amber-400' : 'text-green-400'}>{formatCurrency(inv.balance_due || 0)}</span>
                      </td>
                      <td className="p-2 text-rmpg-400 font-mono">{formatDate(inv.due_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderTasks() {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
        <PanelTitleBar title="TASKS" icon={CheckSquare}>
          <select id="ff-crmpage-15" className="input-dark text-xs min-h-[36px]" style={{ maxWidth: 160 }} value={taskFilter} onChange={e => setTaskFilter(e.target.value)}>
            <option value="pending,in_progress">Active</option>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {canManage && (
            <button type="button" onClick={() => openNewTask()} className="toolbar-btn toolbar-btn-primary print:hidden">
              <Plus className="w-3 h-3" /> New Task
            </button>
          )}
        </PanelTitleBar>
        <div className="p-4">
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-rmpg-500">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                <CheckSquare className="w-7 h-7 text-rmpg-600" />
              </div>
              {/* Distinguish "no records at all" vs "filter hides everything" so
                  the operator doesn't think they need to create one when they
                  really just have an Active/Completed filter applied. */}
              <p className="text-sm font-medium text-rmpg-400">
                {taskFilter && taskFilter !== '' ? 'No tasks match this filter' : 'No tasks yet'}
              </p>
              <p className="text-[10px] text-rmpg-600 mt-1">
                {taskFilter && taskFilter !== ''
                  ? 'Switch the filter to "All" to widen the view'
                  : canManage ? 'Press N or click "New Task" to create one' : 'No tasks have been created yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map(task => (
                <div key={task.id} onContextMenu={(e) => openMenu(e, buildTaskMenu(task))} className="panel-inset p-3 flex items-start gap-3">
                  {/* Checkbox */}
                  <button type="button"
                    onClick={() => toggleTaskComplete(task)}
                    className={`mt-0.5 w-4 h-4 border flex-shrink-0 flex items-center justify-center ${
                      task.status === 'completed'
                        ? 'bg-green-600 border-green-500 text-rmpg-100'
                        : 'border-rmpg-500 hover:border-brand-400'
                    }`}
                  >
                    {task.status === 'completed' && <Check className="w-2.5 h-2.5" aria-hidden />}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium ${task.status === 'completed' ? 'text-rmpg-400 line-through' : 'text-rmpg-200'}`}>
                        {task.title}
                      </span>
                      <span className={`px-1 py-0.5 text-[8px] font-bold border ${priorityColor(task.priority)}`}>{formatEnumValue(task.priority)}</span>
                      <span className={`px-1 py-0.5 text-[8px] font-bold border ${statusColor(task.status)}`}>{toDisplayLabel(task.status)}</span>
                      <span className="px-1 py-0.5 text-[8px] font-bold border border-rmpg-600 text-rmpg-400 bg-rmpg-800/20">{toDisplayLabel(task.task_type)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
                      {task.client_name && <span className="flex items-center gap-1"><Building2 className="w-2.5 h-2.5" />{task.client_name}</span>}
                      {task.due_date && (
                        <span className={`flex items-center gap-1 ${parseTimestamp(task.due_date) < new Date() && task.status !== 'completed' ? 'text-red-400' : ''}`}>
                          <Calendar className="w-2.5 h-2.5" />{formatDate(task.due_date)}
                        </span>
                      )}
                      {task.assigned_to_name && <span className="flex items-center gap-1"><Users className="w-2.5 h-2.5" />{task.assigned_to_name}</span>}
                    </div>
                    {task.description && <div className="text-[10px] text-rmpg-300 mt-1 line-clamp-2">{task.description}</div>}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <IconButton onClick={() => openEditTask(task)} className="p-1 text-rmpg-400 hover:text-rmpg-200" aria-label={`Edit task ${task.title}`}><Edit3 className="w-3 h-3" /></IconButton>
                    <IconButton onClick={() => deleteTask(task)} className="p-1 text-rmpg-400 hover:text-red-400" aria-label={`Delete task ${task.title}`}><Trash2 className="w-3 h-3" /></IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
}

// ── Stat Card Component ──────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="panel-inset p-3 hover:bg-surface-raised/30 transition-colors group cursor-default">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[10px] text-rmpg-400 uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className={`text-lg font-bold font-mono tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-rmpg-500 mt-0.5">{sub}</div>}
    </div>
  );
}
