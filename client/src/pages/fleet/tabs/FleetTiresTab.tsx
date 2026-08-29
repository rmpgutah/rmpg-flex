import { useState, useEffect } from 'react';
import { Circle, Plus } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import ConfirmDialog from '../../../components/ConfirmDialog';

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
  const EMPTY = { position: 'front_left', brand: '', model: '', size: '', install_date: '', tread_depth: '' };
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Tire | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any[]>(`/fleet/${vehicleId}/tires`);
      // Normalize DB column names (tire_position / installed_date) to the
      // UI shape — the raw rows never matched the diagram's `position`
      // lookup, so logged tires rendered as "No tire logged".
      setTires((Array.isArray(data) ? data : []).map((t) => ({
        ...t,
        position: t.position ?? t.tire_position,
        install_date: t.install_date ?? t.installed_date,
      })));
    } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to load tires', 'error'); } finally { setLoading(false); }
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
    if (submitting) return;
    setSubmitting(true);
    // Map UI field names to the handler's columns (tire_position / installed_date).
    const payload = {
      tire_position: form.position,
      brand: form.brand || null,
      model: form.model || null,
      size: form.size || null,
      installed_date: form.install_date || null,
      tread_depth: form.tread_depth ? Number(form.tread_depth) : null,
    };
    try {
      if (editingId != null) {
        await apiFetch(`/fleet/tires/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Tire updated', 'success');
      } else {
        await apiFetch(`/fleet/${vehicleId}/tires`, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Tire added', 'success');
      }
      setShowForm(false); setForm(EMPTY); setEditingId(null); load();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to save tire', 'error'); } finally { setSubmitting(false); }
  };

  const startEdit = (t: Tire) => {
    setForm({
      position: t.position || 'front_left',
      brand: t.brand || '',
      model: t.model || '',
      size: t.size || '',
      install_date: (t.install_date || '').slice(0, 10),
      tread_depth: t.tread_depth != null ? String(t.tread_depth) : '',
    });
    setEditingId(t.id);
    setShowForm(true);
  };

  const handleDelete = async (t: Tire) => {
    try { await apiFetch(`/fleet/tires/${t.id}`, { method: 'DELETE' }); addToast('Tire deleted', 'success'); load(); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Failed to delete tire', 'error'); }
  };

  // Set document title
  useEffect(() => { document.title = 'Fleet - Tires \u2014 RMPG Flex'; }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-rmpg-100">Tire Tracking</h3>
        <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-[9px]"><Plus className="w-3 h-3" /> Add Tire</button>
      </div>

      {showForm && (
        <div className="panel-inset p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <select id="ff-fleettirestab-0" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} className="input-field text-xs">
              {POSITIONS.map(p => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}
            </select>
            <input id="ff-fleettirestab-1" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="input-field text-xs" placeholder="Brand" />
            <input id="ff-fleettirestab-2" value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} className="input-field text-xs" placeholder="Size" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input id="ff-fleettirestab-3" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className="input-field text-xs" placeholder="Model" />
            <input id="ff-fleettirestab-4" type="date" value={form.install_date} onChange={e => setForm(f => ({ ...f, install_date: e.target.value }))} className="input-field text-xs" />
            <input id="ff-fleettirestab-5" type="number" step="0.1" value={form.tread_depth} onChange={e => setForm(f => ({ ...f, tread_depth: e.target.value }))} className="input-field text-xs" placeholder="Tread (32nds)" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} disabled={!form.position || submitting} className="toolbar-btn toolbar-btn-success text-[9px] disabled:opacity-50">{submitting ? 'Saving...' : 'Save'}</button>
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
                  <p className="text-[10px] text-rmpg-100 font-mono">{tire.brand} {tire.size}</p>
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
        <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-rmpg-400 border-b border-rmpg-700">
              <th className="text-left py-1">Position</th>
              <th className="text-left">Brand/Model</th>
              <th className="text-left">Size</th>
              <th className="text-right">Tread</th>
              <th className="text-right">Installed</th>
              <th className="text-right">Last Measured</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tires.map(t => (
              <tr key={t.id} className="border-b border-rmpg-800 text-rmpg-200">
                <td className="py-1 text-rmpg-100">{POSITION_LABELS[t.position] || t.position}</td>
                <td>{t.brand} {t.model}</td>
                <td>{t.size}</td>
                <td className={`text-right font-mono font-bold ${treadColor(t.tread_depth)}`}>{t.tread_depth ? `${t.tread_depth}/32"` : '-'}</td>
                <td className="text-right">{(t.install_date || '-').slice(0, 10)}</td>
                <td className="text-right">{t.last_measured || '-'}</td>
                <td className="text-right">
                  <button type="button" onClick={() => startEdit(t)} className="toolbar-btn text-[9px] mr-1">Edit</button>
                  <button type="button" onClick={() => setPendingDelete(t)} className="toolbar-btn text-[9px] text-red-400">Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <ConfirmDialog
        isOpen={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const t = pendingDelete;
          setPendingDelete(null);
          if (t) void handleDelete(t);
        }}
        title="Delete tire"
        message={pendingDelete ? `Delete ${POSITION_LABELS[pendingDelete.position] || pendingDelete.position} tire (${pendingDelete.brand || 'unknown'})?` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}
