import React, { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import FormModal from './FormModal';
import AddressAutocomplete from './AddressAutocomplete';

export interface ClientFormData {
  name: string;
  client_code: string;
  industry: string;
  website: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  billing_email: string;
  billing_address: string;
  tax_id: string;
  payment_method: string;
  billing_cycle: string;
  billing_day: string;
  contract_start: string;
  contract_end: string;
  contract_type: string;
  contract_value: string;
  payment_terms: string;
  auto_renew: boolean;
  sla_response_minutes: string;
  discount_percent: string;
  late_fee_percent: string;
  account_manager: string;
  priority_client: boolean;
  client_since: string;
  notes: string;
}

interface ClientFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ClientFormData) => void;
  isSubmitting: boolean;
  editingClient?: {
    id: string;
    name: string;
    client_code?: string;
    industry?: string;
    website?: string;
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    address: string;
    billing_email?: string;
    billing_address?: string;
    tax_id?: string;
    payment_method?: string;
    billing_cycle?: string;
    billing_day?: number;
    contract_start?: string;
    contract_end?: string;
    contract_type?: string;
    contract_value?: number;
    payment_terms?: string;
    auto_renew?: boolean;
    sla_response_minutes?: number;
    discount_percent?: number;
    late_fee_percent?: number;
    account_manager?: string;
    priority_client?: number | boolean;
    client_since?: string;
    notes?: string;
  } | null;
}

const EMPTY_FORM: ClientFormData = {
  name: '',
  client_code: '',
  industry: '',
  website: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  address: '',
  billing_email: '',
  billing_address: '',
  tax_id: '',
  payment_method: '',
  billing_cycle: '',
  billing_day: '',
  contract_start: '',
  contract_end: '',
  contract_type: '',
  contract_value: '',
  payment_terms: '',
  auto_renew: false,
  sla_response_minutes: '',
  discount_percent: '',
  late_fee_percent: '',
  account_manager: '',
  priority_client: false,
  client_since: '',
  notes: '',
};

const CONTRACT_TYPES = [
  '', 'Fixed Price', 'Hourly', 'Monthly Retainer', 'Per Event', 'Annual', 'Multi-Year',
];

const PAYMENT_TERMS = [
  '', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on Receipt', 'Prepaid',
];

const PAYMENT_METHODS = [
  '', 'check', 'ach', 'credit_card', 'wire',
];

const BILLING_CYCLES = [
  '', 'monthly', 'quarterly', 'annually',
];

const INDUSTRIES = [
  '', 'Commercial Real Estate', 'Residential / HOA', 'Healthcare / Medical',
  'Retail', 'Hospitality', 'Construction', 'Education', 'Government',
  'Industrial / Manufacturing', 'Technology', 'Financial Services', 'Other',
];

export default function ClientFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingClient,
}: ClientFormModalProps) {
  const [form, setForm] = useState<ClientFormData>(EMPTY_FORM);
  const [activeSection, setActiveSection] = useState<'general' | 'billing' | 'contract' | 'account'>('general');

  useEffect(() => {
    if (isOpen) {
      setActiveSection('general');
      if (editingClient) {
        setForm({
          name: editingClient.name || '',
          client_code: editingClient.client_code || '',
          industry: editingClient.industry || '',
          website: editingClient.website || '',
          contact_name: editingClient.contact_name || '',
          contact_email: editingClient.contact_email || '',
          contact_phone: editingClient.contact_phone || '',
          address: editingClient.address || '',
          billing_email: editingClient.billing_email || '',
          billing_address: editingClient.billing_address || '',
          tax_id: editingClient.tax_id || '',
          payment_method: editingClient.payment_method || '',
          billing_cycle: editingClient.billing_cycle || '',
          billing_day: editingClient.billing_day ? String(editingClient.billing_day) : '',
          contract_start: editingClient.contract_start || '',
          contract_end: editingClient.contract_end || '',
          contract_type: editingClient.contract_type || '',
          contract_value: editingClient.contract_value ? String(editingClient.contract_value) : '',
          payment_terms: editingClient.payment_terms || '',
          auto_renew: !!editingClient.auto_renew,
          sla_response_minutes: editingClient.sla_response_minutes ? String(editingClient.sla_response_minutes) : '',
          discount_percent: editingClient.discount_percent ? String(editingClient.discount_percent) : '',
          late_fee_percent: editingClient.late_fee_percent ? String(editingClient.late_fee_percent) : '',
          account_manager: editingClient.account_manager || '',
          priority_client: !!editingClient.priority_client,
          client_since: editingClient.client_since || '',
          notes: editingClient.notes || '',
        });
      } else {
        setForm(EMPTY_FORM);
      }
    }
  }, [isOpen, editingClient]);

  const set = (field: keyof ClientFormData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const isEdit = !!editingClient;

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={isEdit ? 'Edit Client' : 'Add Client'}
      icon={Building2}
      submitLabel={isEdit ? 'Update Client' : 'Create Client'}
      isSubmitting={isSubmitting}
      maxWidth="max-w-3xl"
    >
      {/* Section Tabs */}
      <div className="flex gap-1 -mt-2 mb-3 border-b border-rmpg-700 pb-2">
        {[
          { id: 'general' as const, label: 'General' },
          { id: 'billing' as const, label: 'Contact & Billing' },
          { id: 'contract' as const, label: 'Contract' },
          { id: 'account' as const, label: 'Account Details' },
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              activeSection === s.id
                ? 'text-red-400 bg-red-900/20 border border-red-700/40'
                : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/40 border border-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── General Tab ── */}
      {activeSection === 'general' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            {/* Client Name */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">
                Client Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                className="input-dark text-xs w-full"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
                placeholder="e.g. Gateway Development Corp"
              />
            </div>

            {/* Client Code */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">
                Client Code
              </label>
              <input
                type="text"
                className="input-dark text-xs w-full"
                value={form.client_code}
                onChange={(e) => set('client_code', e.target.value)}
                placeholder="e.g. CLT001"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Industry */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">
                Industry
              </label>
              <select
                className="input-dark text-xs w-full"
                value={form.industry}
                onChange={(e) => set('industry', e.target.value)}
              >
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>{i || '-- Select --'}</option>
                ))}
              </select>
            </div>

            {/* Website */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">
                Website
              </label>
              <input
                type="text"
                className="input-dark text-xs w-full"
                value={form.website}
                onChange={(e) => set('website', e.target.value)}
                placeholder="e.g. https://www.example.com"
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">
              Address
            </label>
            <AddressAutocomplete
              className="input-dark text-xs w-full"
              value={form.address}
              onChange={(val) => set('address', val)}
              placeholder="145 S State St, SLC, UT 84111"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">
              Notes
            </label>
            <textarea
              className="input-dark text-xs w-full"
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Additional notes about this client..."
            />
          </div>
        </>
      )}

      {/* ── Contact & Billing Tab ── */}
      {activeSection === 'billing' && (
        <>
          {/* Primary Contact */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Contact Name</label>
              <input type="text" className="input-dark text-xs w-full" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} placeholder="Jennifer Wong" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Contact Email</label>
              <input type="email" className="input-dark text-xs w-full" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="jwong@gateway.com" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Contact Phone</label>
              <input type="text" className="input-dark text-xs w-full" value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} placeholder="(801) 555-3001" />
            </div>
          </div>

          {/* Billing Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Billing Email</label>
              <input type="email" className="input-dark text-xs w-full" value={form.billing_email} onChange={(e) => set('billing_email', e.target.value)} placeholder="billing@gateway.com" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Billing Address</label>
              <AddressAutocomplete
                className="input-dark text-xs w-full"
                value={form.billing_address}
                onChange={(val) => set('billing_address', val)}
                placeholder="Same as above or different"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Payment Method */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Payment Method</label>
              <select className="select-dark text-xs w-full" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m ? m.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) : '-- Select --'}</option>
                ))}
              </select>
            </div>

            {/* Billing Cycle */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Billing Cycle</label>
              <select className="select-dark text-xs w-full" value={form.billing_cycle} onChange={(e) => set('billing_cycle', e.target.value)}>
                {BILLING_CYCLES.map((c) => (
                  <option key={c} value={c}>{c ? c.charAt(0).toUpperCase() + c.slice(1) : '-- Select --'}</option>
                ))}
              </select>
            </div>

            {/* Billing Day */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Billing Day</label>
              <input type="number" min="1" max="31" className="input-dark text-xs w-full" value={form.billing_day} onChange={(e) => set('billing_day', e.target.value)} placeholder="e.g. 1" />
            </div>
          </div>

          {/* Tax ID */}
          <div>
            <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Tax ID / EIN</label>
            <input type="text" className="input-dark text-xs w-full" value={form.tax_id} onChange={(e) => set('tax_id', e.target.value)} placeholder="e.g. 12-3456789" />
          </div>
        </>
      )}

      {/* ── Contract Tab ── */}
      {activeSection === 'contract' && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Contract Type</label>
              <select className="select-dark text-xs w-full" value={form.contract_type} onChange={(e) => set('contract_type', e.target.value)}>
                {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t || '-- Select --'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Contract Start</label>
              <input type="date" className="input-dark text-xs w-full" value={form.contract_start} onChange={(e) => set('contract_start', e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Contract End</label>
              <input type="date" className="input-dark text-xs w-full" value={form.contract_end} onChange={(e) => set('contract_end', e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Contract Value ($)</label>
              <input type="number" min="0" step="0.01" className="input-dark text-xs w-full" value={form.contract_value} onChange={(e) => set('contract_value', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Payment Terms</label>
              <select className="select-dark text-xs w-full" value={form.payment_terms} onChange={(e) => set('payment_terms', e.target.value)}>
                {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t || '-- Select --'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">SLA Response (min)</label>
              <input type="number" min="1" className="input-dark text-xs w-full" value={form.sla_response_minutes} onChange={(e) => set('sla_response_minutes', e.target.value)} placeholder="e.g. 15" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 p-2 bg-rmpg-800/50 border border-rmpg-600 cursor-pointer hover:border-rmpg-400 transition-colors w-full">
                <input
                  type="checkbox"
                  checked={form.auto_renew}
                  onChange={(e) => set('auto_renew', e.target.checked)}
                  className="w-4 h-4 accent-red-500"
                />
                <span className="text-xs text-rmpg-200">Auto-Renew</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Discount Percent */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Discount (%)</label>
              <input type="number" min="0" max="100" step="0.1" className="input-dark text-xs w-full" value={form.discount_percent} onChange={(e) => set('discount_percent', e.target.value)} placeholder="0" />
            </div>

            {/* Late Fee Percent */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Late Fee (%)</label>
              <input type="number" min="0" max="100" step="0.1" className="input-dark text-xs w-full" value={form.late_fee_percent} onChange={(e) => set('late_fee_percent', e.target.value)} placeholder="0" />
            </div>
          </div>
        </>
      )}

      {/* ── Account Details Tab ── */}
      {activeSection === 'account' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            {/* Account Manager */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Account Manager</label>
              <input type="text" className="input-dark text-xs w-full" value={form.account_manager} onChange={(e) => set('account_manager', e.target.value)} placeholder="e.g. James Thompson" />
            </div>

            {/* Client Since */}
            <div>
              <label className="block text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Client Since</label>
              <input type="date" className="input-dark text-xs w-full" value={form.client_since} onChange={(e) => set('client_since', e.target.value)} />
            </div>
          </div>

          {/* Priority Client Toggle */}
          <div>
            <label className="flex items-center gap-2 p-2 bg-rmpg-800/50 border border-rmpg-600 cursor-pointer hover:border-rmpg-400 transition-colors w-fit">
              <input
                type="checkbox"
                checked={form.priority_client}
                onChange={(e) => set('priority_client', e.target.checked)}
                className="w-4 h-4 accent-red-500"
              />
              <span className="text-xs text-rmpg-200">Priority Client</span>
            </label>
            <p className="text-[9px] text-rmpg-500 mt-1">Priority clients receive expedited response and dedicated account management</p>
          </div>
        </>
      )}
    </FormModal>
  );
}
