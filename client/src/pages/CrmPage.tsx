import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Clock,
  DollarSign,
  TrendingUp,
  Calendar,
  ChevronRight,
  Edit3,
  Trash2,
  Phone,
  Mail,
  ExternalLink,
  RefreshCw,
  Filter,
  X,
  Save,
  AlertCircle,
  BarChart3,
  Activity,
  Target,
  FileSignature,
} from 'lucide-react';
import LeadsTab from '../components/crm/LeadsTab';
import ProposalsTab from '../components/crm/ProposalsTab';
import ReportsTab from '../components/crm/ReportsTab';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useToast } from '../components/ToastProvider';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import ClientFormModal from '../components/ClientFormModal';
import type {
  Client,
  Property,
  Invoice,
  CrmTask,
  CrmActivity,
  CrmDashboardStats,
} from '../types';

type CrmSection = 'dashboard' | 'clients' | 'properties' | 'contacts' | 'invoices' | 'tasks' | 'leads' | 'proposals' | 'reports';

const SIDEBAR_ITEMS: { id: CrmSection; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads', label: 'Leads', icon: Target },
  { id: 'clients', label: 'Clients', icon: Building2 },
  { id: 'properties', label: 'Properties', icon: MapPin },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'proposals', label: 'Proposals', icon: FileSignature },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
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
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function toDisplayLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Priority badge colors ──────────────────────────────
function priorityColor(p: string): string {
  switch (p) {
    case 'urgent': return 'text-red-400 bg-red-900/30 border-red-700/50';
    case 'high': return 'text-amber-400 bg-amber-900/30 border-amber-700/50';
    case 'normal': return 'text-blue-400 bg-blue-900/30 border-blue-700/50';
    case 'low': return 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50';
    default: return 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50';
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'pending': return 'text-amber-400 bg-amber-900/30 border-amber-700/50';
    case 'in_progress': return 'text-blue-400 bg-blue-900/30 border-blue-700/50';
    case 'completed': return 'text-green-400 bg-green-900/30 border-green-700/50';
    case 'cancelled': return 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50';
    default: return 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50';
  }
}

function invoiceStatusColor(s: string): string {
  switch (s) {
    case 'paid': return 'text-green-400 bg-green-900/30 border-green-700/50';
    case 'sent': return 'text-blue-400 bg-blue-900/30 border-blue-700/50';
    case 'overdue': return 'text-red-400 bg-red-900/30 border-red-700/50';
    case 'partial': return 'text-amber-400 bg-amber-900/30 border-amber-700/50';
    case 'draft': return 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50';
    case 'void': case 'cancelled': return 'text-rmpg-500 bg-rmpg-900/30 border-rmpg-700/50';
    default: return 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50';
  }
}

// ════════════════════════════════════════════════════════
// CRM PAGE
// ════════════════════════════════════════════════════════
export default function CrmPage() {
  const { addToast } = useToast();
  const [activeSection, setActiveSection] = useState<CrmSection>(() => {
    const saved = localStorage.getItem('crm_active_section');
    return (saved as CrmSection) || 'dashboard';
  });
  const [isLoading, setIsLoading] = useState(true);

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
  const [propertySearch, setPropertySearch] = useState('');

  // Contacts
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');

  // Invoices
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceFilter, setInvoiceFilter] = useState('');

  // Tasks
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [taskFilter, setTaskFilter] = useState('pending,in_progress');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<CrmTask | null>(null);
  const [taskForm, setTaskForm] = useState<Partial<CrmTask>>({});

  // Officers for assignment
  const [officers, setOfficers] = useState<{ id: string; full_name: string }[]>([]);

  // Activity log modal
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activityForm, setActivityForm] = useState<{ client_id: string; activity_type: string; subject: string; details: string }>({
    client_id: '', activity_type: 'note', subject: '', details: '',
  });

  // Persist active section
  useEffect(() => { try { localStorage.setItem('crm_active_section', activeSection); } catch { /* ignore */ } }, [activeSection]);

  // ── Data Fetching ──────────────────────────────────────
  const fetchDashboard = useCallback(async () => {
    try {
      const [statsRes, activityRes, expiringRes] = await Promise.all([
        apiFetch<CrmDashboardStats>('/crm/dashboard'),
        apiFetch<CrmActivity[]>('/crm/recent-activity?limit=20'),
        apiFetch<any[]>('/crm/expiring-contracts?days=90'),
      ]);
      setStats(statsRes);
      setRecentActivity(Array.isArray(activityRes) ? activityRes : []);
      setExpiringContracts(Array.isArray(expiringRes) ? expiringRes : []);
    } catch (err: any) {
      console.error('CRM dashboard fetch error:', err);
    }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const res = await apiFetch<any[]>('/admin/clients');
      setClients(Array.isArray(res) ? res : []);
    } catch { setClients([]); }
  }, []);

  const fetchProperties = useCallback(async () => {
    try {
      const res = await apiFetch<any[]>('/records/properties');
      setProperties(Array.isArray(res) ? res : []);
    } catch { setProperties([]); }
  }, []);

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (contactSearch) params.set('search', contactSearch);
      if (contactRelationship) params.set('relationship', contactRelationship);
      const res = await apiFetch<any[]>(`/crm/contacts?${params}`);
      setContacts(Array.isArray(res) ? res : []);
    } catch { setContacts([]); }
  }, [contactSearch, contactRelationship]);

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await apiFetch<any[]>('/invoices');
      setInvoices(Array.isArray(res) ? res : []);
    } catch { setInvoices([]); }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (taskFilter) params.set('status', taskFilter);
      const res = await apiFetch<CrmTask[]>(`/crm/tasks?${params}`);
      setTasks(Array.isArray(res) ? res : []);
    } catch { setTasks([]); }
  }, [taskFilter]);

  const fetchClientActivity = useCallback(async (clientId: string) => {
    try {
      const res = await apiFetch<CrmActivity[]>(`/crm/activity/${clientId}`);
      setClientActivity(Array.isArray(res) ? res : []);
    } catch { setClientActivity([]); }
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

  // Fetch section data on tab change
  useEffect(() => {
    if (activeSection === 'properties') fetchProperties();
    if (activeSection === 'contacts') fetchContacts();
    if (activeSection === 'invoices') fetchInvoices();
    if (activeSection === 'tasks') fetchTasks();
    if (activeSection === 'dashboard') fetchDashboard();
  }, [activeSection, fetchProperties, fetchContacts, fetchInvoices, fetchTasks, fetchDashboard]);

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
    } catch (err: any) {
      addToast(err?.message || 'Failed to save task', 'error');
    }
  };

  const deleteTask = async (id: string | number) => {
    try {
      await apiFetch(`/crm/tasks/${id}`, { method: 'DELETE' });
      addToast('Task deleted', 'success');
      fetchTasks();
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete task', 'error');
    }
  };

  const toggleTaskComplete = async (task: CrmTask) => {
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    try {
      await apiFetch(`/crm/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
      fetchTasks();
    } catch (err: any) {
      addToast(err?.message || 'Failed to update task', 'error');
    }
  };

  // ── Activity Handlers ──────────────────────────────────
  const logActivity = async () => {
    if (!activityForm.client_id || !activityForm.activity_type) return;
    try {
      await apiFetch('/crm/activity', { method: 'POST', body: JSON.stringify(activityForm) });
      addToast('Activity logged', 'success');
      setShowActivityModal(false);
      setActivityForm({ client_id: '', activity_type: 'note', subject: '', details: '' });
      if (selectedClientId) fetchClientActivity(selectedClientId);
      fetchDashboard();
    } catch (err: any) {
      addToast(err?.message || 'Failed to log activity', 'error');
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

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* ── Sidebar ────────────────────────────────────── */}
      <div className="w-48 border-r border-rmpg-600 bg-surface-sunken flex flex-col flex-shrink-0">
        <div className="px-3 py-2 border-b border-rmpg-600">
          <div className="flex items-center gap-2">
            <RmpgLogo height={14} iconOnly />
            <span className="text-xs font-bold text-brand-400 tracking-wider">OVERWATCH</span>
          </div>
        </div>
        <nav className="flex-1 py-1">
          {SIDEBAR_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-400 border-l-2 border-brand-400'
                    : 'text-rmpg-300 hover:bg-rmpg-700/30 hover:text-rmpg-200 border-l-2 border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                {item.label}
                {item.id === 'tasks' && tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length > 0 && (
                  <span className="ml-auto text-[9px] font-mono px-1 py-0.5 bg-amber-900/30 text-amber-400 border border-amber-700/50">
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
        {activeSection === 'dashboard' && renderDashboard()}
        {activeSection === 'leads' && <LeadsTab />}
        {activeSection === 'clients' && renderClients()}
        {activeSection === 'properties' && renderProperties()}
        {activeSection === 'contacts' && renderContacts()}
        {activeSection === 'proposals' && <ProposalsTab />}
        {activeSection === 'invoices' && renderInvoices()}
        {activeSection === 'tasks' && renderTasks()}
        {activeSection === 'reports' && <ReportsTab />}
      </div>

      {/* ── Task Modal ────────────────────────────────── */}
      {showTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowTaskModal(false)}>
          <div className="bg-surface-raised border border-rmpg-600 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="panel-title-bar flex items-center justify-between">
              <span className="text-xs font-bold text-white">{editingTask ? 'Edit Task' : 'New Task'}</span>
              <button onClick={() => setShowTaskModal(false)} className="text-rmpg-400 hover:text-rmpg-200"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Title</label>
                <input className="input-dark w-full" value={taskForm.title || ''} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Type</label>
                  <select className="input-dark w-full" value={taskForm.task_type || 'follow_up'} onChange={e => setTaskForm(p => ({ ...p, task_type: e.target.value as any }))}>
                    {TASK_TYPES.map(t => <option key={t} value={t}>{toDisplayLabel(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Priority</label>
                  <select className="input-dark w-full" value={taskForm.priority || 'normal'} onChange={e => setTaskForm(p => ({ ...p, priority: e.target.value as any }))}>
                    {TASK_PRIORITIES.map(p => <option key={p} value={p}>{toDisplayLabel(p)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Due Date</label>
                  <input type="date" className="input-dark w-full" value={taskForm.due_date || ''} onChange={e => setTaskForm(p => ({ ...p, due_date: e.target.value }))} />
                </div>
                <div>
                  <label className="field-label">Assign To</label>
                  <select className="input-dark w-full" value={taskForm.assigned_to || ''} onChange={e => setTaskForm(p => ({ ...p, assigned_to: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">Client</label>
                <select className="input-dark w-full" value={String(taskForm.client_id || '')} onChange={e => setTaskForm(p => ({ ...p, client_id: e.target.value ? Number(e.target.value) as any : undefined }))}>
                  <option value="">No client</option>
                  {clients.filter(c => c.is_active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Description</label>
                <textarea className="input-dark w-full" rows={3} value={taskForm.description || ''} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))} />
              </div>
              {editingTask && (
                <div>
                  <label className="field-label">Status</label>
                  <select className="input-dark w-full" value={taskForm.status || 'pending'} onChange={e => setTaskForm(p => ({ ...p, status: e.target.value as any }))}>
                    {TASK_STATUSES.map(s => <option key={s} value={s}>{toDisplayLabel(s)}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
              <button onClick={() => setShowTaskModal(false)} className="toolbar-btn">Cancel</button>
              <button onClick={saveTask} className="toolbar-btn toolbar-btn-primary" disabled={!taskForm.title?.trim()}>
                <Save className="w-3 h-3" /> {editingTask ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Activity Log Modal ────────────────────────── */}
      {showActivityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowActivityModal(false)}>
          <div className="bg-surface-raised border border-rmpg-600 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="panel-title-bar flex items-center justify-between">
              <span className="text-xs font-bold text-white">Log Activity</span>
              <button onClick={() => setShowActivityModal(false)} className="text-rmpg-400 hover:text-rmpg-200"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Client</label>
                <select className="input-dark w-full" value={activityForm.client_id} onChange={e => setActivityForm(p => ({ ...p, client_id: e.target.value }))}>
                  <option value="">Select client...</option>
                  {clients.filter(c => c.is_active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Type</label>
                <select className="input-dark w-full" value={activityForm.activity_type} onChange={e => setActivityForm(p => ({ ...p, activity_type: e.target.value }))}>
                  {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{toDisplayLabel(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Subject</label>
                <input className="input-dark w-full" value={activityForm.subject} onChange={e => setActivityForm(p => ({ ...p, subject: e.target.value }))} />
              </div>
              <div>
                <label className="field-label">Details</label>
                <textarea className="input-dark w-full" rows={3} value={activityForm.details} onChange={e => setActivityForm(p => ({ ...p, details: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
              <button onClick={() => setShowActivityModal(false)} className="toolbar-btn">Cancel</button>
              <button onClick={logActivity} className="toolbar-btn toolbar-btn-primary" disabled={!activityForm.client_id}>
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
            } catch (err: any) {
              addToast(err?.message || 'Failed to save client', 'error');
            }
          }}
          editingClient={editingClient}
          isSubmitting={false}
        />
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════
  // SECTION RENDERERS
  // ════════════════════════════════════════════════════════

  function renderDashboard() {
    return (
      <div className="flex-1 overflow-y-auto">
        <PanelTitleBar title="OVERWATCH DASHBOARD" icon={LayoutDashboard}>
          <RmpgLogo height={16} iconOnly />
          <button onClick={() => fetchDashboard()} className="toolbar-btn"><RefreshCw className="w-3 h-3" /> Refresh</button>
          <button onClick={() => { setActivityForm({ client_id: '', activity_type: 'note', subject: '', details: '' }); setShowActivityModal(true); }} className="toolbar-btn toolbar-btn-primary">
            <Plus className="w-3 h-3" /> Log Activity
          </button>
        </PanelTitleBar>

        {stats && (
          <div className="p-4 space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard icon={Building2} label="Active Clients" value={stats.active_clients} sub={`${stats.total_clients} total`} color="text-brand-400" />
              <StatCard icon={DollarSign} label="Outstanding" value={formatCurrency(stats.outstanding_revenue)} sub={`${stats.overdue_invoices} overdue`} color="text-amber-400" />
              <StatCard icon={TrendingUp} label="Invoiced MTD" value={formatCurrency(stats.total_invoiced_mtd)} sub={`${formatCurrency(stats.total_paid_mtd)} paid`} color="text-green-400" />
              <StatCard icon={CheckSquare} label="Pending Tasks" value={stats.pending_tasks} sub={`${stats.expiring_contracts} contracts expiring`} color="text-blue-400" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Expiring Contracts */}
              <div className="panel-inset p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-bold text-white">Expiring Contracts (90 days)</span>
                </div>
                {expiringContracts.length === 0 ? (
                  <p className="text-xs text-rmpg-400">No contracts expiring soon</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
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
                  <Activity className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-bold text-white">Recent Activity</span>
                </div>
                {recentActivity.length === 0 ? (
                  <p className="text-xs text-rmpg-400">No recent activity</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {recentActivity.slice(0, 10).map((a: any) => (
                      <div key={a.id} className="text-xs p-1.5 bg-surface-sunken border border-rmpg-700/30">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-rmpg-200">{a.client_name || 'Unknown'}</span>
                          <span className="text-rmpg-400 font-mono">{formatDateTime(a.created_at)}</span>
                        </div>
                        <div className="text-rmpg-300 mt-0.5">
                          <span className={`inline-block px-1 py-0.5 text-[9px] font-bold border ${
                            a.activity_type === 'call' ? 'text-green-400 border-green-700/50 bg-green-900/20' :
                            a.activity_type === 'email' ? 'text-blue-400 border-blue-700/50 bg-blue-900/20' :
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
            <input className="input-dark text-xs flex-1" style={{ maxWidth: 120 }} placeholder="Search..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
            <button onClick={() => { setEditingClient(null); setShowClientModal(true); }} className="toolbar-btn toolbar-btn-primary">
              <Plus className="w-3 h-3" /> New
            </button>
          </PanelTitleBar>
          <div className="flex-1 overflow-y-auto">
            {filteredClients.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedClientId(String(c.id))}
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
        <div className="flex-1 overflow-y-auto">
          {selectedClient ? (
            <div>
              <div className="panel-title-bar flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-white">{selectedClient.name}</span>
                  {(selectedClient as any).priority_client && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 text-amber-400 bg-amber-900/30 border border-amber-700/50">PRIORITY</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setEditingClient(selectedClient); setShowClientModal(true); }} className="toolbar-btn"><Edit3 className="w-3 h-3" /> Edit</button>
                  <button onClick={() => openNewTask(selectedClientId!)} className="toolbar-btn"><Plus className="w-3 h-3" /> Task</button>
                  <button onClick={() => { setActivityForm({ client_id: selectedClientId!, activity_type: 'note', subject: '', details: '' }); setShowActivityModal(true); }} className="toolbar-btn">
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
                    <span className="text-xs font-bold text-white">Activity Timeline</span>
                    <button onClick={() => { setActivityForm({ client_id: selectedClientId!, activity_type: 'note', subject: '', details: '' }); setShowActivityModal(true); }} className="toolbar-btn">
                      <Plus className="w-3 h-3" /> Log
                    </button>
                  </div>
                  {clientActivity.length === 0 ? (
                    <p className="text-xs text-rmpg-400">No activity recorded</p>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {clientActivity.map((a: any) => (
                        <div key={a.id} className="text-xs p-1.5 bg-surface-sunken border border-rmpg-700/30">
                          <div className="flex items-center justify-between">
                            <span className={`inline-block px-1 py-0.5 text-[9px] font-bold border ${
                              a.activity_type === 'call' ? 'text-green-400 border-green-700/50 bg-green-900/20' :
                              a.activity_type === 'email' ? 'text-blue-400 border-blue-700/50 bg-blue-900/20' :
                              a.activity_type === 'meeting' ? 'text-purple-400 border-purple-700/50 bg-purple-900/20' :
                              'text-rmpg-300 border-rmpg-600 bg-rmpg-800/20'
                            }`}>{toDisplayLabel(a.activity_type)}</span>
                            <span className="text-rmpg-400 font-mono">{formatDateTime(a.created_at)}</span>
                          </div>
                          {a.subject && <div className="text-rmpg-200 font-medium mt-0.5">{a.subject}</div>}
                          {a.details && <div className="text-rmpg-300 mt-0.5">{a.details}</div>}
                          {a.created_by_name && <div className="text-rmpg-500 mt-0.5">— {a.created_by_name}</div>}
                        </div>
                      ))}
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
      <div className="flex-1 overflow-y-auto">
        <PanelTitleBar title="PROPERTIES" icon={MapPin}>
          <input className="input-dark text-xs" style={{ maxWidth: 200 }} placeholder="Search properties..." value={propertySearch} onChange={e => setPropertySearch(e.target.value)} />
        </PanelTitleBar>
        <div className="p-4">
          {filteredProperties.length === 0 ? (
            <div className="text-center py-12 text-rmpg-400 text-sm">No properties found</div>
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
      <div className="flex-1 overflow-y-auto">
        <PanelTitleBar title="CONTACTS" icon={Users}>
          <input className="input-dark text-xs" style={{ maxWidth: 200 }} placeholder="Search contacts..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
          <select className="input-dark text-xs" style={{ maxWidth: 140 }} value={contactRelationship} onChange={e => setContactRelationship(e.target.value)}>
            <option value="">All Relationships</option>
            {RELATIONSHIP_TYPES.map(r => <option key={r} value={r}>{toDisplayLabel(r)}</option>)}
          </select>
          <button onClick={fetchContacts} className="toolbar-btn"><Search className="w-3 h-3" /> Search</button>
        </PanelTitleBar>
        <div className="p-4">
          {contacts.length === 0 ? (
            <div className="text-center py-12 text-rmpg-400 text-sm">No contacts found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-rmpg-400 border-b border-rmpg-600">
                    <th className="p-2 font-medium">Name</th>
                    <th className="p-2 font-medium">Client</th>
                    <th className="p-2 font-medium">Relationship</th>
                    <th className="p-2 font-medium">Phone</th>
                    <th className="p-2 font-medium">Email</th>
                    <th className="p-2 font-medium">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c: any) => (
                    <tr key={c.id} className="border-b border-rmpg-700/30 hover:bg-rmpg-700/10">
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
      <div className="flex-1 overflow-y-auto">
        <PanelTitleBar title="INVOICES" icon={FileText}>
          <select className="input-dark text-xs" style={{ maxWidth: 140 }} value={invoiceFilter} onChange={e => setInvoiceFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="overdue">Overdue</option>
          </select>
        </PanelTitleBar>
        <div className="p-4">
          {filteredInvoices.length === 0 ? (
            <div className="text-center py-12 text-rmpg-400 text-sm">No invoices found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
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
                    <tr key={inv.id} className="border-b border-rmpg-700/30 hover:bg-rmpg-700/10">
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
      <div className="flex-1 overflow-y-auto">
        <PanelTitleBar title="TASKS" icon={CheckSquare}>
          <select className="input-dark text-xs" style={{ maxWidth: 160 }} value={taskFilter} onChange={e => setTaskFilter(e.target.value)}>
            <option value="pending,in_progress">Active</option>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={() => openNewTask()} className="toolbar-btn toolbar-btn-primary">
            <Plus className="w-3 h-3" /> New Task
          </button>
        </PanelTitleBar>
        <div className="p-4">
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-rmpg-400 text-sm">No tasks found</div>
          ) : (
            <div className="space-y-2">
              {tasks.map(task => (
                <div key={task.id} className="panel-inset p-3 flex items-start gap-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleTaskComplete(task)}
                    className={`mt-0.5 w-4 h-4 border flex-shrink-0 flex items-center justify-center ${
                      task.status === 'completed'
                        ? 'bg-green-600 border-green-500 text-white'
                        : 'border-rmpg-500 hover:border-brand-400'
                    }`}
                  >
                    {task.status === 'completed' && <span className="text-[10px]">✓</span>}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium ${task.status === 'completed' ? 'text-rmpg-400 line-through' : 'text-rmpg-200'}`}>
                        {task.title}
                      </span>
                      <span className={`px-1 py-0.5 text-[8px] font-bold border ${priorityColor(task.priority)}`}>{task.priority.toUpperCase()}</span>
                      <span className={`px-1 py-0.5 text-[8px] font-bold border ${statusColor(task.status)}`}>{toDisplayLabel(task.status)}</span>
                      <span className="px-1 py-0.5 text-[8px] font-bold border border-rmpg-600 text-rmpg-400 bg-rmpg-800/20">{toDisplayLabel(task.task_type)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
                      {task.client_name && <span className="flex items-center gap-1"><Building2 className="w-2.5 h-2.5" />{task.client_name}</span>}
                      {task.due_date && (
                        <span className={`flex items-center gap-1 ${new Date(task.due_date) < new Date() && task.status !== 'completed' ? 'text-red-400' : ''}`}>
                          <Calendar className="w-2.5 h-2.5" />{formatDate(task.due_date)}
                        </span>
                      )}
                      {task.assigned_to_name && <span className="flex items-center gap-1"><Users className="w-2.5 h-2.5" />{task.assigned_to_name}</span>}
                    </div>
                    {task.description && <div className="text-[10px] text-rmpg-300 mt-1 line-clamp-2">{task.description}</div>}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEditTask(task)} className="p-1 text-rmpg-400 hover:text-rmpg-200"><Edit3 className="w-3 h-3" /></button>
                    <button onClick={() => deleteTask(task.id)} className="p-1 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
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
    <div className="panel-inset p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[10px] text-rmpg-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-rmpg-400 mt-0.5">{sub}</div>}
    </div>
  );
}
