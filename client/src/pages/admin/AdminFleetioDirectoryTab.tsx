// ============================================================
// RMPG Flex — Admin → Fleet.io Vendors & Parts tab
// ------------------------------------------------------------
// Manages the two resource types added to the Fleet.io sync engine
// alongside vehicles/fuel/work-orders/inspections:
//   - Vendors (ref_vendors)  — GET/POST/PUT/DELETE /api/ref-data/vendors
//   - Parts   (fleet_parts)  — GET/POST/PUT/DELETE /api/fleet/parts
// Each write already emits a Fleet.io outbound event (events.ts); the
// "Seed" buttons here push EXISTING unlinked rows via
// POST /api/fleetio/seed-vendors and /seed-parts, mirroring the vehicle
// seed flow on the Fleet.io Health tab.
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Pencil, Upload, Store, Package, X, Check } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface VendorRow {
  id: number;
  name: string;
  kind: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  active: number;
}

interface PartRow {
  id: number;
  part_number: string | null;
  name: string;
  category: string | null;
  description: string | null;
  unit_cost: number | null;
  quantity_on_hand: number | null;
  reorder_point: number | null;
  supplier: string | null;
  location: string | null;
}

type VendorForm = Partial<VendorRow>;
type PartForm = Partial<PartRow>;

function SeedButton({ label, onSeed }: { label: string; onSeed: () => Promise<{ ok: boolean; created?: number; skipped?: number; errors?: number; error?: string }> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setResult(null);
    onSeed()
      .then((r) => {
        setBusy(false);
        if (!r.ok) { setResult(`failed: ${r.error ?? 'unknown'}`); return; }
        setResult(`created ${r.created ?? 0} · skipped ${r.skipped ?? 0} · errors ${r.errors ?? 0}`);
      })
      .catch((e) => { setBusy(false); setResult(`failed: ${e instanceof Error ? e.message : 'unknown'}`); });
  };
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-brand-700 hover:bg-brand-600 text-white disabled:opacity-50"
        aria-label={label}
      >
        <Upload className="w-3 h-3" /> {busy ? 'Seeding…' : label}
      </button>
      {result && (
        <span className={`text-[10px] ${result.startsWith('failed') ? 'text-red-400' : 'text-emerald-400'}`}>{result}</span>
      )}
    </div>
  );
}

export default function AdminFleetioDirectoryTab() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [parts, setParts] = useState<PartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingVendor, setEditingVendor] = useState<VendorForm | null>(null);
  const [editingPart, setEditingPart] = useState<PartForm | null>(null);

  const loadVendors = useCallback(() => {
    apiFetch<{ rows: VendorRow[] }>('/ref-data/vendors')
      .then((r) => setVendors(Array.isArray(r?.rows) ? r.rows : []))
      .catch(() => setVendors([]));
  }, []);

  const loadParts = useCallback(() => {
    apiFetch<PartRow[]>('/fleet/parts')
      .then((r) => setParts(Array.isArray(r) ? r : []))
      .catch(() => setParts([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadVendors(), loadParts()]).finally(() => setLoading(false));
  }, [loadVendors, loadParts]);

  const saveVendor = () => {
    if (!editingVendor) return;
    const isNew = editingVendor.id == null;
    const req = isNew
      ? apiFetch(`/ref-data/vendors`, { method: 'POST', body: JSON.stringify(editingVendor) })
      : apiFetch(`/ref-data/vendors/${editingVendor.id}`, { method: 'PUT', body: JSON.stringify(editingVendor) });
    req.then(() => { setEditingVendor(null); loadVendors(); }).catch(() => {});
  };

  const deleteVendor = (id: number) => {
    if (!confirm('Deactivate this vendor?')) return;
    apiFetch(`/ref-data/vendors/${id}`, { method: 'DELETE' }).then(() => loadVendors()).catch(() => {});
  };

  const savePart = () => {
    if (!editingPart) return;
    const isNew = editingPart.id == null;
    const req = isNew
      ? apiFetch(`/fleet/parts`, { method: 'POST', body: JSON.stringify(editingPart) })
      : apiFetch(`/fleet/parts/${editingPart.id}`, { method: 'PUT', body: JSON.stringify(editingPart) });
    req.then(() => { setEditingPart(null); loadParts(); }).catch(() => {});
  };

  const deletePart = (id: number) => {
    if (!confirm('Delete this part? This cannot be undone.')) return;
    apiFetch(`/fleet/parts/${id}`, { method: 'DELETE' }).then(() => loadParts()).catch(() => {});
  };

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading…</div>;

  return (
    <div className="p-3 space-y-4">
      {/* ── Vendors ── */}
      <div className="panel-beveled p-3 bg-surface-base">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Store className="w-3 h-3" /> Vendor Directory ({vendors.length})
          </h4>
          <div className="flex items-center gap-2">
            <SeedButton label="Seed to Fleet.io" onSeed={() => apiFetch('/fleetio/seed-vendors', { method: 'POST', body: JSON.stringify({}) })} />
            <button
              onClick={() => setEditingVendor({ kind: 'vendor' })}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-surface-sunken hover:bg-rmpg-700 text-rmpg-100"
            >
              <Plus className="w-3 h-3" /> New Vendor
            </button>
          </div>
        </div>
        {editingVendor && (
          <div className="grid grid-cols-4 gap-1.5 mb-2 p-2 bg-surface-sunken rounded">
            <input className="input-dark col-span-2" placeholder="Name" value={editingVendor.name ?? ''} onChange={(e) => setEditingVendor({ ...editingVendor, name: e.target.value })} />
            <select className="input-dark" value={editingVendor.kind ?? 'vendor'} onChange={(e) => setEditingVendor({ ...editingVendor, kind: e.target.value })}>
              {['fuel', 'shop', 'parts', 'insurance', 'vendor'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input className="input-dark" placeholder="Phone" value={editingVendor.phone ?? ''} onChange={(e) => setEditingVendor({ ...editingVendor, phone: e.target.value })} />
            <input className="input-dark col-span-2" placeholder="Address" value={editingVendor.address ?? ''} onChange={(e) => setEditingVendor({ ...editingVendor, address: e.target.value })} />
            <input className="input-dark" placeholder="City" value={editingVendor.city ?? ''} onChange={(e) => setEditingVendor({ ...editingVendor, city: e.target.value })} />
            <input className="input-dark" placeholder="State" value={editingVendor.state ?? ''} onChange={(e) => setEditingVendor({ ...editingVendor, state: e.target.value })} />
            <input className="input-dark col-span-2" placeholder="Email" value={editingVendor.email ?? ''} onChange={(e) => setEditingVendor({ ...editingVendor, email: e.target.value })} />
            <div className="flex items-center gap-1">
              <button onClick={saveVendor} className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-green-700 hover:bg-green-600 text-white"><Check className="w-3 h-3" /> Save</button>
              <button onClick={() => setEditingVendor(null)} className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-surface-base hover:bg-rmpg-700"><X className="w-3 h-3" /></button>
            </div>
          </div>
        )}
        <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
          {vendors.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 p-2">No vendors on file.</div>
          ) : vendors.map((v) => (
            <div key={v.id} className="flex items-center justify-between px-2 py-1 bg-surface-sunken rounded text-[10px]">
              <span className="font-mono text-rmpg-100 font-bold flex-1">{v.name}</span>
              <span className="text-rmpg-500 uppercase w-16">{v.kind}</span>
              <span className="text-rmpg-400 flex-1">{[v.city, v.state].filter(Boolean).join(', ') || '—'}</span>
              <span className={`w-14 text-center ${v.active ? 'text-emerald-400' : 'text-rmpg-600'}`}>{v.active ? 'active' : 'inactive'}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditingVendor(v)} aria-label={`Edit ${v.name}`} className="p-1 hover:text-brand-400"><Pencil className="w-3 h-3" /></button>
                <button onClick={() => deleteVendor(v.id)} aria-label={`Deactivate ${v.name}`} className="p-1 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Parts ── */}
      <div className="panel-beveled p-3 bg-surface-base">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Package className="w-3 h-3" /> Parts Inventory ({parts.length})
          </h4>
          <div className="flex items-center gap-2">
            <SeedButton label="Seed to Fleet.io" onSeed={() => apiFetch('/fleetio/seed-parts', { method: 'POST', body: JSON.stringify({}) })} />
            <button
              onClick={() => setEditingPart({ quantity_on_hand: 0, reorder_point: 0 })}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-surface-sunken hover:bg-rmpg-700 text-rmpg-100"
            >
              <Plus className="w-3 h-3" /> New Part
            </button>
          </div>
        </div>
        {editingPart && (
          <div className="grid grid-cols-4 gap-1.5 mb-2 p-2 bg-surface-sunken rounded">
            <input className="input-dark col-span-2" placeholder="Name" value={editingPart.name ?? ''} onChange={(e) => setEditingPart({ ...editingPart, name: e.target.value })} />
            <input className="input-dark" placeholder="Part #" value={editingPart.part_number ?? ''} onChange={(e) => setEditingPart({ ...editingPart, part_number: e.target.value })} />
            <input className="input-dark" placeholder="Category" value={editingPart.category ?? ''} onChange={(e) => setEditingPart({ ...editingPart, category: e.target.value })} />
            <input className="input-dark" type="number" step="0.01" placeholder="Unit cost" value={editingPart.unit_cost ?? ''} onChange={(e) => setEditingPart({ ...editingPart, unit_cost: e.target.value === '' ? null : Number(e.target.value) })} />
            <input className="input-dark" type="number" placeholder="Qty on hand" value={editingPart.quantity_on_hand ?? ''} onChange={(e) => setEditingPart({ ...editingPart, quantity_on_hand: e.target.value === '' ? null : Number(e.target.value) })} />
            <input className="input-dark" type="number" placeholder="Reorder pt" value={editingPart.reorder_point ?? ''} onChange={(e) => setEditingPart({ ...editingPart, reorder_point: e.target.value === '' ? null : Number(e.target.value) })} />
            <input className="input-dark" placeholder="Supplier" value={editingPart.supplier ?? ''} onChange={(e) => setEditingPart({ ...editingPart, supplier: e.target.value })} />
            <input className="input-dark col-span-2" placeholder="Location" value={editingPart.location ?? ''} onChange={(e) => setEditingPart({ ...editingPart, location: e.target.value })} />
            <div className="flex items-center gap-1">
              <button onClick={savePart} className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-green-700 hover:bg-green-600 text-white"><Check className="w-3 h-3" /> Save</button>
              <button onClick={() => setEditingPart(null)} className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-surface-base hover:bg-rmpg-700"><X className="w-3 h-3" /></button>
            </div>
          </div>
        )}
        <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
          {parts.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 p-2">No parts on file.</div>
          ) : parts.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-2 py-1 bg-surface-sunken rounded text-[10px]">
              <span className="font-mono text-rmpg-100 font-bold flex-1">{p.name}</span>
              <span className="text-rmpg-500 w-20">{p.part_number ?? '—'}</span>
              <span className={`w-20 text-center font-mono ${(p.quantity_on_hand ?? 0) <= (p.reorder_point ?? 0) ? 'text-amber-400' : 'text-rmpg-300'}`}>
                {p.quantity_on_hand ?? 0} on hand
              </span>
              <span className="text-rmpg-400 w-16 text-right">{p.unit_cost != null ? `$${Number(p.unit_cost).toFixed(2)}` : '—'}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditingPart(p)} aria-label={`Edit ${p.name}`} className="p-1 hover:text-brand-400"><Pencil className="w-3 h-3" /></button>
                <button onClick={() => deletePart(p.id)} aria-label={`Delete ${p.name}`} className="p-1 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
