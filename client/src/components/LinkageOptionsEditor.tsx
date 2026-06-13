import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import { Plus } from 'lucide-react';

interface Row { id: number; category: string; value: string; label: string; sort_order: number; is_active: number; is_default: number; }
const CATEGORIES = [
  { key: 'person_role', label: 'Person Roles' },
  { key: 'vehicle_role', label: 'Vehicle Roles' },
  { key: 'caller_relationship', label: 'Caller Relationships' },
  { key: 'business_role', label: 'Business Roles' },
];

export default function LinkageOptionsEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [cat, setCat] = useState('person_role');
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch<Row[]>('/admin/link-options').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (id: number, body: Partial<Row>) => {
    try {
      await apiFetch(`/admin/link-options/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setError('');
      load();
    } catch (err) {
      console.error('patch link-option failed', err);
      setError('Failed to update option');
    }
  };
  const remove = async (id: number) => {
    try {
      await apiFetch(`/admin/link-options/${id}`, { method: 'DELETE' });
      setError('');
      load();
    } catch (err) {
      console.error('remove link-option failed', err);
      setError('Failed to remove option');
    }
  };
  const add = async () => {
    if (!newValue.trim() || !newLabel.trim()) return;
    const slug = newValue.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug) { setError('Enter a valid value'); return; }
    try {
      await apiFetch('/admin/link-options', { method: 'POST', body: JSON.stringify({ category: cat, value: slug, label: newLabel.trim() }) });
      setError('');
      setNewValue(''); setNewLabel(''); load();
    } catch (err) {
      console.error('add link-option failed', err);
      setError('Failed to add option');
    }
  };

  const catRows = rows.filter((r) => r.category === cat).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-1 flex-wrap">
        {CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => setCat(c.key)} className={`px-2 py-1 text-[10px] uppercase font-bold border rounded-sm ${cat === c.key ? 'bg-brand-900/40 text-brand-300 border-brand-600/40' : 'text-rmpg-400 border-rmpg-600'}`}>{c.label}</button>
        ))}
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      <table className="w-full text-xs">
        <thead><tr className="text-brand-gold-500 text-[9px] uppercase"><th className="text-left py-[3px]">Label</th><th className="text-left">Value</th><th>Sort</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {catRows.map((r) => (
            <tr key={r.id} className="border-t border-rmpg-700">
              <td className="py-[2px]"><input className="input-dark text-xs w-full" defaultValue={r.label} onBlur={(e) => e.target.value !== r.label && patch(r.id, { label: e.target.value })} /></td>
              <td className="text-rmpg-500 font-mono text-[10px]">{r.value}{r.is_default ? '' : ' *'}</td>
              <td className="text-center"><input type="number" className="input-dark text-xs w-14" defaultValue={r.sort_order} onBlur={(e) => Number(e.target.value) !== r.sort_order && patch(r.id, { sort_order: Number(e.target.value) })} /></td>
              <td className="text-center"><input type="checkbox" checked={!!r.is_active} onChange={(e) => patch(r.id, { is_active: e.target.checked ? 1 : 0 })} /></td>
              <td className="text-center"><button onClick={() => remove(r.id)} className="text-red-500 hover:text-red-300" title={r.is_default ? 'Hide' : 'Delete'} aria-label={r.is_default ? 'Hide option' : 'Delete option'}>&times;</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-end gap-2 pt-2 border-t border-rmpg-700">
        <div><label className="text-[9px] text-brand-gold-500">New label</label><input className="input-dark text-xs" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Co-Signer" /></div>
        <div><label className="text-[9px] text-brand-gold-500">Value (slug)</label><input className="input-dark text-xs" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="co_signer" /></div>
        <button onClick={add} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40"><Plus className="w-3 h-3" /> Add</button>
      </div>
      <p className="text-[9px] text-rmpg-500">* = custom (hard-deletable). Seeded defaults are hidden (uncheck Active), not deleted.</p>
    </div>
  );
}
