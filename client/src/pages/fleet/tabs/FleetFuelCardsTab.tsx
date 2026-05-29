import { useState, useEffect } from 'react';
import { CreditCard, Plus, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { parseTimestamp } from '../../../utils/dateUtils';

interface FuelCard {
  id: number;
  card_number: string;
  vehicle_id: number | null;
  vehicle_number: string | null;
  provider: string;
  status: string;
  monthly_limit: number;
  pin_last4: string;
  expiry_date: string;
  notes: string;
  assigned_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-900/50 text-green-400 border border-green-700/50',
  suspended: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  cancelled: 'bg-red-900/50 text-red-400 border border-red-700/50',
  lost: 'bg-red-900/60 text-red-300 border border-red-600/50',
};

export default function FleetFuelCardsTab() {
  const { addToast } = useToast();
  const [cards, setCards] = useState<FuelCard[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ card_number: '', vehicle_id: '', provider: '', monthly_limit: '', pin_last4: '', expiry_date: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [cardsData, vehData] = await Promise.all([
        apiFetch<FuelCard[]>('/fleet/fuel-cards'),
        apiFetch<{ data: any[] }>('/fleet?per_page=200'),
      ]);
      setCards(cardsData);
      setVehicles(vehData.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Escape to close form
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const handleSubmit = async () => {
    if (!form.card_number.trim()) { addToast('Card number is required', 'error'); return; }
    setSubmitting(true);
    try { await apiFetch('/fleet/fuel-cards', {
      method: 'POST',
      body: JSON.stringify({ ...form, vehicle_id: form.vehicle_id ? Number(form.vehicle_id) : null, monthly_limit: form.monthly_limit ? Number(form.monthly_limit) : null }),
    }); addToast('Fuel card added', 'success'); setShowForm(false); setForm({ card_number: '', vehicle_id: '', provider: '', monthly_limit: '', pin_last4: '', expiry_date: '', notes: '' }); load(); } catch { addToast('Failed to add card', 'error'); } finally { setSubmitting(false); }
  };

  const updateCard = async (id: number, data: any) => {
    try { await apiFetch(`/fleet/fuel-cards/${id}`, { method: 'PUT', body: JSON.stringify(data) }); addToast('Card updated', 'success'); load(); } catch { addToast('Failed to update card', 'error'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-white flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> Fuel Cards</h3>
        <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-[9px]"><Plus className="w-3 h-3" /> Add Card</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="panel-inset p-2 text-center"><p className="field-label">Total Cards</p><p className="text-sm font-bold text-white">{cards.length}</p></div>
        <div className="panel-inset p-2 text-center"><p className="field-label">Assigned</p><p className="text-sm font-bold text-green-400">{cards.filter(c => c.vehicle_id).length}</p></div>
        <div className="panel-inset p-2 text-center"><p className="field-label">Unassigned</p><p className="text-sm font-bold text-amber-400">{cards.filter(c => !c.vehicle_id).length}</p></div>
      </div>

      {showForm && (
        <div className="panel-inset p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input value={form.card_number} onChange={e => setForm(f => ({ ...f, card_number: e.target.value }))} className="input-field text-xs" placeholder="Card Number" />
            <input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} className="input-field text-xs" placeholder="Provider" />
            <select value={form.vehicle_id} onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))} className="input-field text-xs">
              <option value="">Unassigned</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_number} ({v.make} {v.model})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" min="0" value={form.monthly_limit} onChange={e => setForm(f => ({ ...f, monthly_limit: e.target.value }))} className="input-field text-xs tabular-nums" placeholder="Monthly Limit $" />
            <input value={form.pin_last4} onChange={e => setForm(f => ({ ...f, pin_last4: e.target.value }))} maxLength={4} className="input-field text-xs font-mono" placeholder="PIN (last 4)" spellCheck={false} autoComplete="off" />
            <input type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} className="input-field text-xs" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} disabled={submitting || !form.card_number.trim()} className="toolbar-btn toolbar-btn-success text-[9px] disabled:opacity-50">{submitting ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} disabled={submitting} className="toolbar-btn text-[9px]">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-rmpg-400 py-4 text-xs"><Loader2 className="w-4 h-4 animate-spin" role="status" aria-label="Loading" /> Loading fuel cards...</div>
      ) : (
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-rmpg-400 border-b border-rmpg-700">
              <th className="text-left py-1 whitespace-nowrap">Card #</th>
              <th className="text-left whitespace-nowrap">Provider</th>
              <th className="text-left whitespace-nowrap">Vehicle</th>
              <th className="text-right whitespace-nowrap">Limit</th>
              <th className="text-center whitespace-nowrap">Status</th>
              <th className="text-right whitespace-nowrap">Expiry</th>
              <th className="text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cards.map(c => (
              <tr key={c.id} className="border-b border-rmpg-800 hover:bg-surface-raised/30 transition-colors">
                <td className="py-1 text-white font-mono">{c.card_number}</td>
                <td className="text-rmpg-300">{c.provider || '-'}</td>
                <td className="text-rmpg-200">{c.vehicle_number || <span className="text-rmpg-500 italic">Unassigned</span>}</td>
                <td className="text-right text-rmpg-300 font-mono">{c.monthly_limit ? `$${c.monthly_limit}` : '-'}</td>
                <td className="text-center"><span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_COLORS[c.status] || ''}`}>{(c.status || '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())}</span></td>
                <td className="text-right text-rmpg-400">{c.expiry_date ? parseTimestamp(c.expiry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}</td>
                <td className="text-right">
                  {c.status === 'active' && (
                    <button type="button" onClick={() => updateCard(c.id, { status: 'suspended' })} className="toolbar-btn text-[9px]">Suspend</button>
                  )}
                  {c.status === 'suspended' && (
                    <button type="button" onClick={() => updateCard(c.id, { status: 'active' })} className="toolbar-btn toolbar-btn-success text-[9px]">Activate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
