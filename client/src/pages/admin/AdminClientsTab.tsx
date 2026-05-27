import React, { useState, useEffect, useRef } from 'react';
import RichTextArea from '../../components/RichTextArea';
import {
  Plus,
  Edit,
  Trash2,
  XCircle,
  Loader2,
  MapPin,
  FileText,
  Building2,
  Archive,
  RotateCcw,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';
import { toDisplayLabel, formatPhoneInput } from '../../utils/formatters';
import type { Client } from '../../types';
import AdminInvoiceTab from './AdminInvoiceTab';
import { ClientPersonLinks } from '../../components/ClientPersonLinksSection';
import { formatAddressDisplay } from '../../utils/statusLabels';

// ============================================================
// Props
// ============================================================

interface AdminClientsTabProps {
  clients: (Client & { property_count?: number })[];
  setClients: React.Dispatch<React.SetStateAction<(Client & { property_count?: number })[]>>;
  loadingClients: boolean;
  error: string | null;
  setError: (error: string | null) => void;

  // Selected client detail
  selectedClient: (Client & { property_count?: number }) | null;
  setSelectedClient: (client: (Client & { property_count?: number }) | null) => void;

  // Modal handlers
  openAddClient: () => void;
  openEditClient: (client: Client & { property_count?: number }) => void;
  openDeleteClient: (client: Client) => void;

  // Archive handlers
  handleArchiveClient: (clientId: string) => void;
  handleUnarchiveClient: (clientId: string) => void;

  // Mapper function
  mapClientRowToClient: (row: any) => Client & { property_count?: number };

  // Ref to signal parent that an inline edit save is pending (suppresses LiveSync refresh)
  editPendingRef?: React.MutableRefObject<boolean>;

  // Loading spinner component
  LoadingSpinner: React.FC;
}

// ============================================================
// Component
// ============================================================

export default function AdminClientsTab({
  clients,
  setClients,
  loadingClients,
  error,
  setError,
  selectedClient,
  setSelectedClient,
  openAddClient,
  openEditClient,
  openDeleteClient,
  handleArchiveClient,
  handleUnarchiveClient,
  mapClientRowToClient,
  editPendingRef,
  LoadingSpinner,
}: AdminClientsTabProps) {
  const [clientDetailTab, setClientDetailTab] = useState<'profile' | 'billing' | 'properties' | 'incidents' | 'calls' | 'notes' | 'invoices'>('profile');
  const [clientIncidents, setClientIncidents] = useState<any[]>([]);
  const [clientCalls, setClientCalls] = useState<any[]>([]);
  const [clientBilling, setClientBilling] = useState<any>(null);
  const [clientProperties, setClientProperties] = useState<any[]>([]);
  const [loadingClientDetail, setLoadingClientDetail] = useState(false);

  // Inline editing for client detail -- auto-saves changes on blur
  const [clientEdit, setClientEdit] = useState<Record<string, any>>({});
  const [clientSaving, setClientSaving] = useState(false);
  const clientSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientEditRef = useRef(clientEdit);
  const selectedClientRef = useRef(selectedClient);
  useEffect(() => { clientEditRef.current = clientEdit; }, [clientEdit]);
  useEffect(() => { selectedClientRef.current = selectedClient; }, [selectedClient]);

  // Populate inline edit data when client is selected
  useEffect(() => {
    if (selectedClient) {
      setClientEdit({
        name: selectedClient.name || '',
        client_code: selectedClient.client_code || '',
        industry: selectedClient.industry || '',
        website: selectedClient.website || '',
        contact_name: selectedClient.contact_name || '',
        contact_email: selectedClient.contact_email || '',
        contact_phone: selectedClient.contact_phone || '',
        address: selectedClient.address || '',
        billing_email: selectedClient.billing_email || '',
        billing_address: selectedClient.billing_address || '',
        tax_id: selectedClient.tax_id || '',
        payment_method: selectedClient.payment_method || '',
        billing_cycle: selectedClient.billing_cycle || '',
        contract_type: selectedClient.contract_type || '',
        contract_value: selectedClient.contract_value != null ? String(selectedClient.contract_value) : '',
        discount_percent: selectedClient.discount_percent != null ? String(selectedClient.discount_percent) : '',
        late_fee_percent: selectedClient.late_fee_percent != null ? String(selectedClient.late_fee_percent) : '',
        payment_terms: selectedClient.payment_terms || '',
        contract_start: selectedClient.contract_start || '',
        contract_end: selectedClient.contract_end || '',
        auto_renew: !!selectedClient.auto_renew,
        sla_response_minutes: selectedClient.sla_response_minutes != null ? String(selectedClient.sla_response_minutes) : '',
        account_manager: selectedClient.account_manager || '',
        client_since: selectedClient.client_since || '',
        notes: selectedClient.notes || '',
        rate_per_hour: selectedClient.rate_per_hour != null ? String(selectedClient.rate_per_hour) : '',
        rate_per_incident: selectedClient.rate_per_incident != null ? String(selectedClient.rate_per_incident) : '',
        rate_per_cfs: selectedClient.rate_per_cfs != null ? String(selectedClient.rate_per_cfs) : '',
      });
    }
  }, [selectedClient?.id]);

  const saveClientInline = async () => {
    const sc = selectedClientRef.current;
    const ce = clientEditRef.current;
    if (!sc) return;
    setClientSaving(true);
    try {
      const body: Record<string, unknown> = {};
      const fields = ['name', 'client_code', 'industry', 'website', 'contact_name', 'contact_email',
        'contact_phone', 'address', 'billing_email', 'billing_address', 'tax_id',
        'payment_method', 'billing_cycle', 'contract_type', 'payment_terms',
        'contract_start', 'contract_end', 'account_manager', 'client_since', 'notes'];
      for (const f of fields) {
        if (ce[f] !== undefined) body[f] = ce[f] || null;
      }
      // Numeric fields: use !== '' to allow saving 0
      if (ce.contract_value !== undefined && ce.contract_value !== '') body.contract_value = parseFloat(ce.contract_value) || 0;
      else if (ce.contract_value === '') body.contract_value = null;
      if (ce.discount_percent !== undefined && ce.discount_percent !== '') body.discount_percent = parseFloat(ce.discount_percent) || 0;
      else if (ce.discount_percent === '') body.discount_percent = null;
      if (ce.late_fee_percent !== undefined && ce.late_fee_percent !== '') body.late_fee_percent = parseFloat(ce.late_fee_percent) || 0;
      else if (ce.late_fee_percent === '') body.late_fee_percent = null;
      if (ce.sla_response_minutes !== undefined && ce.sla_response_minutes !== '') body.sla_response_minutes = parseInt(ce.sla_response_minutes, 10) || 0;
      else if (ce.sla_response_minutes === '') body.sla_response_minutes = null;
      if (ce.billing_day !== undefined && ce.billing_day !== '') body.billing_day = parseInt(ce.billing_day, 10) || 0;
      else if (ce.billing_day === '') body.billing_day = null;
      // Rate fields (BUG 2 fix)
      if (ce.rate_per_hour !== undefined && ce.rate_per_hour !== '') body.rate_per_hour = parseFloat(ce.rate_per_hour) || 0;
      else if (ce.rate_per_hour === '') body.rate_per_hour = null;
      if (ce.rate_per_incident !== undefined && ce.rate_per_incident !== '') body.rate_per_incident = parseFloat(ce.rate_per_incident) || 0;
      else if (ce.rate_per_incident === '') body.rate_per_incident = null;
      if (ce.rate_per_cfs !== undefined && ce.rate_per_cfs !== '') body.rate_per_cfs = parseFloat(ce.rate_per_cfs) || 0;
      else if (ce.rate_per_cfs === '') body.rate_per_cfs = null;
      body.auto_renew = ce.auto_renew || false;
      body.priority_client = ce.priority_client || false;

      const updated = await apiFetch(`/admin/clients/${sc.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const mapped = mapClientRowToClient(updated as any);
      setClients((prev) => prev.map((c) => c.id === sc.id ? mapped : c));
      setSelectedClient(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save client');
    } finally {
      setClientSaving(false);
      if (editPendingRef) editPendingRef.current = false;
    }
  };

  const setClientField = (field: string, value: string | boolean) => {
    setClientEdit((prev) => ({ ...prev, [field]: value }));
    if (editPendingRef) editPendingRef.current = true;
    if (clientSaveTimerRef.current) clearTimeout(clientSaveTimerRef.current);
    clientSaveTimerRef.current = setTimeout(() => {
      saveClientInline();
    }, 1500);
  };

  // Flush client save on unmount or tab switch
  useEffect(() => {
    return () => {
      if (clientSaveTimerRef.current) {
        clearTimeout(clientSaveTimerRef.current);
        // Flush pending save instead of discarding
        saveClientInline();
      }
    };
  }, []);

  // Fetch client detail when a client is selected
  useEffect(() => {
    let cancelled = false;
    if (selectedClient) {
      setLoadingClientDetail(true);
      Promise.all([
        apiFetch<any>(`/admin/clients/${selectedClient.id}`).catch(() => null),
        apiFetch<any[]>(`/admin/clients/${selectedClient.id}/incidents`).catch(() => []),
        apiFetch<any[]>(`/admin/clients/${selectedClient.id}/calls`).catch(() => []),
        apiFetch<any>(`/admin/clients/${selectedClient.id}/billing`).catch(() => null),
      ]).then(([detail, incidents, calls, billing]) => {
        if (cancelled) return;
        setClientProperties(asArray<any>(detail?.properties));
        setClientIncidents(asArray<any>(incidents));
        setClientCalls(asArray<any>(calls));
        setClientBilling(billing);
      }).finally(() => { if (!cancelled) setLoadingClientDetail(false); });
    } else {
      setClientProperties([]);
      setClientIncidents([]);
      setClientCalls([]);
      setClientBilling(null);
    }
    return () => { cancelled = true; };
  }, [selectedClient?.id]);

  // Set document title
  useEffect(() => { document.title = 'Admin - Clients \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Client List */}
      <div className={`${selectedClient ? 'w-[35%]' : 'w-full'} border-r border-rmpg-600 flex flex-col overflow-hidden transition-all duration-200`}>
        <div className="px-4 py-3 flex items-center justify-between border-b border-rmpg-600 flex-shrink-0 bg-surface-sunken">
          <span className="text-xs text-rmpg-300 font-bold uppercase tracking-wider tabular-nums">{clients.length} Clients</span>
          <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={openAddClient} aria-label="Add new client">
            <Plus className="w-3.5 h-3.5" /> Add Client
          </button>
        </div>

        {loadingClients ? (
          <LoadingSpinner />
        ) : (
          <div className="flex-1 overflow-auto scrollbar-dark">
            {clients.map((client, idx) => (
              <div
                key={client.id}
                onClick={() => { setSelectedClient(selectedClient?.id === client.id ? null : client); setClientDetailTab('profile'); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedClient(selectedClient?.id === client.id ? null : client); setClientDetailTab('profile'); } }}
                aria-label={`Select ${client.name}`}
                className={`px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-all duration-150 ${
                  selectedClient?.id === client.id
                    ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                    : `hover:bg-rmpg-700/30 border-l-2 border-l-transparent ${idx % 2 !== 0 ? 'bg-rmpg-800/10' : ''}`
                }`}
              >
                <div className="flex items-center gap-3">
                  <Building2 className="w-5 h-5 text-brand-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{client.name}</div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400">
                      <span>{client.contact_name}</span>
                      {client.property_count != null && <span>{client.property_count} properties</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold ${
                      client.is_active ? 'text-green-400' : 'text-rmpg-500'
                    }`}>
                      {client.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); openEditClient(client); }}
                        className="p-1 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors rounded-sm"
                        title="Edit client"
                        aria-label={`Edit ${client.name}`}
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                      {!(client as any).archived_at ? (
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); handleArchiveClient(client.id); }}
                          className="p-1 hover:bg-rmpg-700 text-rmpg-500 hover:text-amber-400 transition-colors rounded-sm"
                          title="Archive client"
                          aria-label={`Archive ${client.name}`}
                        >
                          <Archive className="w-3 h-3" />
                        </button>
                      ) : (
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); handleUnarchiveClient(client.id); }}
                          className="p-1 hover:bg-rmpg-700 text-rmpg-500 hover:text-green-400 transition-colors rounded-sm"
                          title="Unarchive client"
                          aria-label={`Unarchive ${client.name}`}
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      )}
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); openDeleteClient(client); }}
                        className="p-1 hover:bg-rmpg-700 text-rmpg-500 hover:text-red-400 transition-colors rounded-sm"
                        title="Delete client"
                        aria-label={`Delete ${client.name}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {clients.length === 0 && !loadingClients && (
              <div className="flex flex-col items-center justify-center text-center text-rmpg-400 py-16 gap-2">
                <Building2 className="w-8 h-8 text-rmpg-600" />
                <span className="text-xs">No clients found</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Client Detail Panel */}
      {selectedClient && (
        <div className="w-[65%] flex flex-col overflow-hidden">
          {/* Detail Header */}
          <div className="p-4 border-b border-rmpg-600 bg-surface-sunken flex-shrink-0">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-brand-400" />
                  {selectedClient.name}
                </h2>
                <div className="flex items-center gap-3 mt-1 text-xs text-rmpg-300">
                  <span>{selectedClient.address}</span>
                  <span className={selectedClient.is_active ? 'text-green-400' : 'text-rmpg-500'}>
                    {selectedClient.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => openEditClient(selectedClient)} className="toolbar-btn">
                  <Edit className="w-3.5 h-3.5" /> Edit
                </button>
                <button type="button" onClick={() => setSelectedClient(null)} className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-white transition-colors rounded-sm" aria-label="Close client details">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Detail Tabs */}
          <div className="flex gap-0.5 px-4 pt-2 border-b border-rmpg-600 flex-shrink-0 overflow-x-auto scrollbar-dark" role="tablist" aria-label="Client detail sections">
            {([
              { id: 'profile' as const, label: 'Profile' },
              { id: 'billing' as const, label: 'Billing' },
              { id: 'properties' as const, label: `Properties (${clientProperties.length})` },
              { id: 'incidents' as const, label: `Incidents (${clientIncidents.length})` },
              { id: 'calls' as const, label: `CFS Log (${clientCalls.length})` },
              { id: 'notes' as const, label: 'Notes' },
              { id: 'invoices' as const, label: 'Invoices' },
            ]).map((tab) => (
              <button type="button"
                key={tab.id}
                role="tab"
                aria-selected={clientDetailTab === tab.id}
                onClick={() => setClientDetailTab(tab.id)}
                className={`px-3 py-1.5 text-[10px] font-medium transition-all duration-150 whitespace-nowrap relative ${
                  clientDetailTab === tab.id
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
            {loadingClientDetail && (
              <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-xs text-rmpg-400">Loading...</span></div>
            )}

            {/* Profile Tab -- inline editable */}
            {clientDetailTab === 'profile' && (
              <>
                {clientSaving && <div className="text-[9px] text-brand-400 flex items-center gap-1 mb-1"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Saving...</div>}
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Contact Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Contact Name</label>
                      <input className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.contact_name || ''} onChange={(e) => setClientField('contact_name', e.target.value)} placeholder="Contact name" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Email</label>
                      <input className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.contact_email || ''} onChange={(e) => setClientField('contact_email', e.target.value)} placeholder="Email" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Phone</label>
                      <input className="input-dark text-xs w-full min-h-[36px]" type="tel" value={clientEdit.contact_phone || ''} onChange={(e) => setClientField('contact_phone', formatPhoneInput(e.target.value))} placeholder="(801) 555-1234" />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Address</label>
                      <input className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.address || ''} onChange={(e) => setClientField('address', e.target.value)} placeholder="Address" />
                    </div>
                  </div>
                </div>

                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Contract Details</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Type</label>
                      <select className="select-dark text-xs w-full" value={clientEdit.contract_type || ''} onChange={(e) => setClientField('contract_type', e.target.value)}>
                        <option value="">-- Select --</option>
                        <option value="Fixed Price">Fixed Price</option>
                        <option value="Hourly">Hourly</option>
                        <option value="Monthly Retainer">Monthly Retainer</option>
                        <option value="Per Event">Per Event</option>
                        <option value="Annual">Annual</option>
                        <option value="Multi-Year">Multi-Year</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Value ($)</label>
                      <input type="number" min="0" step="0.01" className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.contract_value || ''} onChange={(e) => setClientField('contract_value', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Payment Terms</label>
                      <select className="select-dark text-xs w-full" value={clientEdit.payment_terms || ''} onChange={(e) => setClientField('payment_terms', e.target.value)}>
                        <option value="">-- Select --</option>
                        <option value="Net 15">Net 15</option>
                        <option value="Net 30">Net 30</option>
                        <option value="Net 45">Net 45</option>
                        <option value="Net 60">Net 60</option>
                        <option value="Due on Receipt">Due on Receipt</option>
                        <option value="Prepaid">Prepaid</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Start Date</label>
                      <input type="date" className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.contract_start || ''} onChange={(e) => setClientField('contract_start', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">End Date</label>
                      <input type="date" className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.contract_end || ''} onChange={(e) => setClientField('contract_end', e.target.value)} />
                    </div>
                    <div className="flex items-end gap-3">
                      <label className="flex items-center gap-2 p-1.5 bg-rmpg-800/50 border border-rmpg-600 cursor-pointer hover:border-rmpg-400 transition-colors">
                        <input type="checkbox" checked={!!clientEdit.auto_renew} onChange={(e) => setClientField('auto_renew', e.target.checked)} className="w-3.5 h-3.5 accent-red-500" />
                        <span className="text-[10px] text-rmpg-200">Auto-Renew</span>
                      </label>
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">SLA Response (min)</label>
                      <input type="number" min="1" className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.sla_response_minutes || ''} onChange={(e) => setClientField('sla_response_minutes', e.target.value)} placeholder="e.g. 15" />
                    </div>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="panel-beveled p-3 text-center bg-surface-base">
                    <div className="text-2xl font-bold text-brand-400">{clientProperties.length}</div>
                    <div className="text-[10px] text-rmpg-400 uppercase mt-1">Properties</div>
                  </div>
                  <div className="panel-beveled p-3 text-center bg-surface-base">
                    <div className="text-2xl font-bold text-amber-400">{clientIncidents.length}</div>
                    <div className="text-[10px] text-rmpg-400 uppercase mt-1">Incidents</div>
                  </div>
                  <div className="panel-beveled p-3 text-center bg-surface-base">
                    <div className="text-2xl font-bold text-gray-400">{clientCalls.length}</div>
                    <div className="text-[10px] text-rmpg-400 uppercase mt-1">CFS Calls</div>
                  </div>
                </div>

                {/* Linked Persons */}
                {selectedClient && (
                  <ClientPersonLinks
                    clientId={String(selectedClient.id)}
                    clientName={selectedClient.name}
                  />
                )}
              </>
            )}

            {/* Billing Tab -- inline editable */}
            {clientDetailTab === 'billing' && (
              <>
                {clientSaving && <div className="text-[9px] text-brand-400 flex items-center gap-1 mb-1"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Saving...</div>}
                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Billing Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Billing Email</label>
                      <input className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.billing_email || ''} onChange={(e) => setClientField('billing_email', e.target.value)} placeholder="billing@example.com" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Billing Address</label>
                      <input className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.billing_address || ''} onChange={(e) => setClientField('billing_address', e.target.value)} placeholder="Billing address" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Payment Terms</label>
                      <select className="select-dark text-xs w-full" value={clientEdit.payment_terms || ''} onChange={(e) => setClientField('payment_terms', e.target.value)}>
                        <option value="">-- Select --</option>
                        <option value="Net 15">Net 15</option>
                        <option value="Net 30">Net 30</option>
                        <option value="Net 45">Net 45</option>
                        <option value="Net 60">Net 60</option>
                        <option value="Due on Receipt">Due on Receipt</option>
                        <option value="Prepaid">Prepaid</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Billing Cycle</label>
                      <select className="select-dark text-xs w-full" value={clientEdit.billing_cycle || ''} onChange={(e) => setClientField('billing_cycle', e.target.value)}>
                        <option value="">-- Select --</option>
                        <option value="weekly">Weekly</option>
                        <option value="bi-weekly">Bi-Weekly</option>
                        <option value="semi-monthly">Semi-Monthly</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annually">Annually</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Contract Value ($)</label>
                      <input type="number" min="0" step="0.01" className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.contract_value || ''} onChange={(e) => setClientField('contract_value', e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                </div>

                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Activity Summary</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div><span className="text-rmpg-400">Total Incidents:</span> <span className="text-rmpg-200 font-bold ml-1">{clientBilling?.incident_count ?? 0}</span></div>
                    <div><span className="text-rmpg-400">Total CFS:</span> <span className="text-rmpg-200 font-bold ml-1">{clientBilling?.call_count ?? 0}</span></div>
                    <div><span className="text-rmpg-400">Properties:</span> <span className="text-rmpg-200 font-bold ml-1">{clientBilling?.property_count ?? 0}</span></div>
                  </div>
                </div>

                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Billing Rates</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Rate per Hour ($)</label>
                      <input type="number" min="0" step="0.01" className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.rate_per_hour || ''} onChange={(e) => setClientField('rate_per_hour', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Rate per Incident ($)</label>
                      <input type="number" min="0" step="0.01" className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.rate_per_incident || ''} onChange={(e) => setClientField('rate_per_incident', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-rmpg-500 uppercase mb-0.5">Rate per CFS ($)</label>
                      <input type="number" min="0" step="0.01" className="input-dark text-xs w-full min-h-[36px]" value={clientEdit.rate_per_cfs || ''} onChange={(e) => setClientField('rate_per_cfs', e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                  <p className="text-[9px] text-rmpg-500 mt-2">These rates are used when auto-generating invoice line items.</p>
                </div>

                <div className="panel-beveled p-3 bg-surface-base">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Invoice Summary</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs mb-3">
                    <div><span className="text-rmpg-400">Total Invoiced:</span> <span className="text-white font-bold ml-1">${(clientBilling?.total_invoiced || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
                    <div><span className="text-rmpg-400">Total Paid:</span> <span className="text-green-400 font-bold ml-1">${(clientBilling?.total_paid || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
                    <div><span className="text-rmpg-400">Outstanding:</span> <span className="text-amber-400 font-bold ml-1">${(clientBilling?.outstanding_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
                  </div>
                  <button type="button" onClick={() => setClientDetailTab('invoices')} className="toolbar-btn text-brand-400 hover:text-brand-300">
                    <FileText className="w-3.5 h-3.5" /> <span className="text-[10px]">View Invoices</span>
                  </button>
                </div>
              </>
            )}

            {/* Properties Tab */}
            {clientDetailTab === 'properties' && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Properties ({clientProperties.length})</h3>
                {clientProperties.length > 0 ? (
                  <div className="space-y-2">
                    {clientProperties.map((prop: any) => (
                      <div key={prop.id} className="flex items-center gap-3 px-3 py-2 bg-surface-raised border border-rmpg-700">
                        <MapPin className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="text-xs text-white font-medium">{prop.name}</div>
                          <div className="text-[10px] text-rmpg-400">{prop.address}</div>
                        </div>
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold ${prop.is_active !== 0 ? 'text-green-400' : 'text-rmpg-500'}`}>
                          {prop.is_active !== 0 ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-rmpg-500">No properties linked to this client</p>
                )}
              </div>
            )}

            {/* Incidents Tab */}
            {clientDetailTab === 'incidents' && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Incident History ({clientIncidents.length})</h3>
                {clientIncidents.length > 0 ? (
                  <table className="table-dark">
                    <thead>
                      <tr>
                        <th>IR #</th>
                        <th>Type</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Location</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientIncidents.map((inc: any) => (
                        <tr key={inc.id}>
                          <td className="font-bold text-white text-xs font-mono">{inc.incident_number}</td>
                          <td className="text-xs text-brand-400">{(inc.incident_type || '').replace(/_/g, ' ')}</td>
                          <td className="text-xs font-mono font-bold text-rmpg-300">{inc.priority}</td>
                          <td className="text-xs text-rmpg-300">{toDisplayLabel(inc.status)}</td>
                          <td className="text-xs text-rmpg-300 max-w-[150px] truncate">{inc.location_address}</td>
                          <td className="text-[10px] text-rmpg-400">{inc.created_at ? new Date(inc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-rmpg-500">No incidents recorded at this client's properties</p>
                )}
              </div>
            )}

            {/* CFS Log Tab */}
            {clientDetailTab === 'calls' && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">Dispatch Call Log ({clientCalls.length})</h3>
                {clientCalls.length > 0 ? (
                  <table className="table-dark">
                    <thead>
                      <tr>
                        <th>Call #</th>
                        <th>Type</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Location</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientCalls.map((call: any) => (
                        <tr key={call.id}>
                          <td className="font-bold text-green-400 text-xs font-mono">{call.call_number}</td>
                          <td className="text-xs text-rmpg-200">{(call.call_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</td>
                          <td className="text-xs font-mono font-bold text-rmpg-300">{call.priority}</td>
                          <td className="text-xs text-rmpg-300">{toDisplayLabel(call.status)}</td>
                          <td className="text-xs text-rmpg-300 max-w-[150px] truncate">{formatAddressDisplay(call.location)}</td>
                          <td className="text-[10px] text-rmpg-400">{call.created_at ? new Date(call.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-rmpg-500">No dispatch calls recorded at this client's properties</p>
                )}
              </div>
            )}

            {/* Notes Tab -- inline editable */}
            {clientDetailTab === 'notes' && (
              <div className="panel-beveled p-3 bg-surface-base">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Notes</h3>
                  {clientSaving && <div className="text-[9px] text-brand-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Saving...</div>}
                </div>
                <RichTextArea
                  className="input-dark text-xs w-full leading-relaxed resize-y min-h-[36px]"
                  style={{ minHeight: '180px' }}
                  value={clientEdit.notes || ''}
                  onChange={(e) => setClientField('notes', e.target.value)}
                  placeholder="Add client notes here..."
                />
                <p className="text-[9px] text-rmpg-500 mt-1.5">Changes auto-save after you stop typing.</p>
              </div>
            )}

            {/* Invoices Tab */}
            {clientDetailTab === 'invoices' && selectedClient && (
              <AdminInvoiceTab
                clientId={String(selectedClient.id)}
                clientName={selectedClient.name}
                client={selectedClient}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
