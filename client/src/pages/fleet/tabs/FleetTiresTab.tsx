import React, { useState, useEffect } from 'react';
import { Circle, Plus } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';

interface Tire {
  id: number;
  vehicle_id: number;
  position: string;
  brand: string;
  model: string;
  size: string;
  install_date: string;
  tread_depth: number;
  last_measured: string;
  notes: string;
}

const POSITIONS = ['front_left', 'front_right', 'rear_left', 'rear_right', 'spare'];
const POSITION_LABELS: Record<string, string> = {
  front_left: 'Front Left', front_right: 'Front Right',
  rear_left: 'Rear Left', rear_right: 'Rear Right', spare: 'Spare',
};

function treadColor(depth: number | null): string {
  if (!depth) return 'text-rmpg-400';
  if (depth >= 6) return 'text-green-400';
  if (depth >= 4) return 'text-amber-400';
  return 'text-red-400';
}

export default function FleetTiresTab({ vehicleId }: { vehicleId: number | string }) {
  const { addToast } = useToast();
  const [tires, setTires] = useState<Tire[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ position: 'front_left', brand: '', model: '', size: '', install_date: '', tread_depth: '' });

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Tire[]>(`/fleet/${vehicleId}/tires`);
      setTires(data);
    } catch { addToast('Failed to load tires', 'error'); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [vehicleId]);

  // Escape to close form
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const handleSubmit = async () => {
    if (!form.position) { addToast('Position is required', 'error'); return; }
    try { await apiFetch(`/fleet/${vehicleId}/tires`, { method: 'POST', body: JSON.stringify({ ...form, tread_depth: form.tread_depth ? Number(form.tread_depth) : null }) }); addToast('Tire added', 'success'); setShowForm(false); load(); } catch { addToast('Failed to add tire', 'error'); }
  };

  const updateTread = async (tireId: number, depth: string) => {
    try { await apiFetch(`/fleet/tires/${tireId}`, { method: 'PUT', body: JSON.stringify({ tread_depth: Number(depth) }) }); addToast('Tread updated', 'success'); load(); } catch { addToast('Failed to update tread depth', 'error'); }
  };

  // Set document title
  useEffect(() => { document.title = 'Fleet - Tires \u2014 RMPG Flex'; }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-white">Tire Tracking</h3>
        <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-[9px]"><Plus className="w-3 h-3" /> Add Tire</button>
      </div>

      {showForm && (
        <div className="panel-inset p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <select value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} className="input-field text-xs">
              {POSITIONS.map(p => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}
            </select>
            <input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="input-field text-xs" placeholder="Brand" />
            <input value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} className="input-field text-xs" placeholder="Size" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className="input-field text-xs" placeholder="Model" />
            <input type="date" value={form.install_date} onChange={e => setForm(f => ({ ...f, install_date: e.target.value }))} className="input-field text-xs" />
            <input type="number" step="0.1" value={form.tread_depth} onChange={e => setForm(f => ({ ...f, tread_depth: e.target.value }))} className="input-field text-xs" placeholder="Tread (32nds)" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} disabled={!form.position} className="toolbar-btn toolbar-btn-success text-[9px] disabled:opacity-50">Save</button>
            <button type="button" onClick={() => setShowForm(false)} className="toolbar-btn text-[9px]">Cancel</button>
          </div>
        </div>
      )}

      {/* Visual tire diagram */}
      <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
        {['front_left', 'front_right', 'rear_left', 'rear_right'].map(pos => {
          const tire = tires.find(t => t.position === pos);
          return (
            <div key={pos} className="panel-inset p-2 text-center">
              <Circle className={`w-8 h-8 mx-auto ${tire ? treadColor(tire.tread_depth) : 'text-rmpg-600'}`} />
              <p className="text-[10px] text-rmpg-300 mt-1">{POSITION_LABELS[pos]}</p>
              {tire ? (
                <>
                  <p className="text-[10px] text-white font-mono">{tire.brand} {tire.size}</p>
                  <p className={`text-[10px] font-bold ${treadColor(tire.tread_depth)}`}>
                    {tire.tread_depth ? `${tire.tread_depth}/32"` : 'N/A'}
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-rmpg-500">No tire logged</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Spare */}
      {tires.filter(t => t.position === 'spare').map(tire => (
        <div key={tire.id} className="panel-inset p-2 text-center max-w-xs mx-auto">
          <p className="text-[10px] text-rmpg-300">Spare: {tire.brand} {tire.size} - Tread: {tire.tread_depth ? `${tire.tread_depth}/32"` : 'N/A'}</p>
        </div>
      ))}

      {/* Table view */}
      {tires.length > 0 && (
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-rmpg-400 border-b border-rmpg-700">
              <th className="text-left py-1">Position</th>
              <th className="text-left">Brand/Model</th>
              <th className="text-left">Size</th>
              <th className="text-right">Tread</th>
              <th className="text-right">Installed</th>
              <th className="text-right">Last Measured</th>
            </tr>
          </thead>
          <tbody>
            {tires.map(t => (
              <tr key={t.id} className="border-b border-rmpg-800 text-rmpg-200">
                <td className="py-1 text-white">{POSITION_LABELS[t.position] || t.position}</td>
                <td>{t.brand} {t.model}</td>
                <td>{t.size}</td>
                <td className={`text-right font-mono font-bold ${treadColor(t.tread_depth)}`}>{t.tread_depth ? `${t.tread_depth}/32"` : '-'}</td>
                <td className="text-right">{t.install_date || '-'}</td>
                <td className="text-right">{t.last_measured || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
