// ============================================================
// RMPG Flex — Admin → Inspection Templates tab (Fleet.io PR 6b)
// ------------------------------------------------------------
// Operator-facing CRUD over the inspection_templates table that landed
// in PR 6 (#1498). Surfaces:
//   - List of templates (name + version + vehicle_type + active flag)
//   - Create modal: name + description + vehicle_type + items list
//   - Edit modal: same form pre-filled; saves via PUT which forks a
//     new version when the template is in-use (backend handles this).
//   - Deactivate button per row.
//
// The items list is the heart of the form — drag-reorder is deferred
// (Phase 2); for now you can move items up/down with explicit buttons.
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { Plus, Trash2, ChevronUp, ChevronDown, Edit3, Power } from 'lucide-react';

interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  active: number;
  version: number;
  parent_template_id: number | null;
  vehicle_type_code: string | null;
  created_at: string;
}

interface TemplateItem {
  key: string;
  label: string;
  type: 'yes_no' | 'pass_fail' | 'text' | 'photo' | 'number';
  required: boolean;
  fail_creates_issue: boolean;
  photo_required_on_fail: boolean;
  help?: string;
}

const ITEM_TYPES: { value: TemplateItem['type']; label: string }[] = [
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'pass_fail', label: 'Pass / Fail' },
  { value: 'text', label: 'Text note' },
  { value: 'photo', label: 'Photo upload' },
  { value: 'number', label: 'Number' },
];

const EMPTY_TEMPLATE = {
  name: '',
  description: '',
  vehicle_type_code: '',
  items: [
    {
      key: 'tires', label: 'Tires',
      type: 'yes_no' as const,
      required: true,
      fail_creates_issue: true,
      photo_required_on_fail: true,
    },
  ] as TemplateItem[],
};

export default function AdminInspectionTemplatesTab() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<{ mode: 'create' } | { mode: 'edit'; id: number } | null>(null);

  const fetchRows = useCallback(() => {
    setErr(null); setLoading(true);
    const params = includeInactive ? '?include_inactive=1' : '';
    apiFetch<{ data: TemplateRow[] }>(`/inspection-templates${params}`)
      .then((r) => { setRows(r?.data ?? []); setLoading(false); })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); });
  }, [includeInactive]);

  useEffect(() => {
    let cancelled = false;
    setErr(null); setLoading(true);
    const params = includeInactive ? '?include_inactive=1' : '';
    apiFetch<{ data: TemplateRow[] }>(`/inspection-templates${params}`)
      .then((r) => { if (!cancelled) { setRows(r?.data ?? []); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [includeInactive]);

  const deactivate = (id: number) => {
    if (!confirm(`Deactivate template ${id}?`)) return;
    apiFetch<{ success: boolean }>(`/inspection-templates/${id}/deactivate`, { method: 'POST' })
      .then(() => fetchRows())
      .catch((e) => alert(`Failed to deactivate: ${e instanceof Error ? e.message : 'unknown'}`));
  };

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading inspection templates…</div>;

  return (
    <div className="p-4 space-y-3">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-base font-semibold text-rmpg-100">Inspection Templates</h2>
          <p className="text-xs text-rmpg-400 max-w-prose">
            Versioned schemas for the QR pre-trip walkthrough. Editing a template
            that's been used by any inspection forks a new version (the prior
            stays untouched so historical inspections still resolve their schema).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-rmpg-300 flex items-center gap-1">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="accent-brand-400"
            />
            Show inactive
          </label>
          <button
            type="button"
            onClick={() => setEditing({ mode: 'create' })}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110"
          >
            <Plus className="w-3 h-3" /> New Template
          </button>
        </div>
      </header>

      {err ? <div className="px-3 py-2 rounded-sm border border-red-500/40 text-red-300 text-xs">{err}</div> : null}

      {rows.length === 0 ? (
        <div className="text-xs text-rmpg-400 py-4">No templates yet. Click "New Template" to create the first one.</div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Name</th>
              <th className="text-left px-3 py-1.5 font-semibold">Vehicle type</th>
              <th className="text-right px-3 py-1.5 font-semibold">Version</th>
              <th className="text-left px-3 py-1.5 font-semibold">Active</th>
              <th className="text-left px-3 py-1.5 font-semibold">Created</th>
              <th className="text-right px-3 py-1.5 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-rmpg-800/40">
                <td className="px-3 py-1 text-rmpg-100">
                  {r.name}
                  {r.description ? <span className="text-rmpg-400"> · {r.description}</span> : null}
                </td>
                <td className="px-3 py-1 text-rmpg-300 font-mono">{r.vehicle_type_code ?? '—'}</td>
                <td className="px-3 py-1 text-right text-rmpg-300 font-mono">v{r.version}</td>
                <td className="px-3 py-1">
                  {r.active === 1 ? <span className="text-emerald-300">active</span> : <span className="text-rmpg-500">inactive</span>}
                </td>
                <td className="px-3 py-1 text-rmpg-300 font-mono">{(r.created_at ?? '').slice(0, 10)}</td>
                <td className="px-3 py-1 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setEditing({ mode: 'edit', id: r.id })}
                    className="text-[9px] px-1.5 py-0.5 mx-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 text-rmpg-100"
                  >
                    <Edit3 className="w-3 h-3 inline" /> Edit
                  </button>
                  {r.active === 1 ? (
                    <button
                      type="button"
                      onClick={() => deactivate(r.id)}
                      className="text-[9px] px-1.5 py-0.5 mx-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 text-amber-300"
                    >
                      <Power className="w-3 h-3 inline" /> Deactivate
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing ? (
        <TemplateModal
          mode={editing.mode}
          templateId={editing.mode === 'edit' ? editing.id : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchRows(); }}
        />
      ) : null}
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────

interface TemplateModalProps {
  mode: 'create' | 'edit';
  templateId: number | null;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateModal({ mode, templateId, onClose, onSaved }: TemplateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [items, setItems] = useState<TemplateItem[]>(EMPTY_TEMPLATE.items);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'edit' && templateId != null) {
      apiFetch<{ data: { name: string; description: string | null; vehicle_type_code: string | null; schema: { items: TemplateItem[] } } }>(`/inspection-templates/${templateId}`)
        .then((r) => {
          setName(r.data.name);
          setDescription(r.data.description ?? '');
          setVehicleType(r.data.vehicle_type_code ?? '');
          setItems(Array.isArray(r.data.schema?.items) ? r.data.schema.items : []);
        })
        .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'));
    } else {
      setName(EMPTY_TEMPLATE.name);
      setDescription(EMPTY_TEMPLATE.description);
      setVehicleType(EMPTY_TEMPLATE.vehicle_type_code);
      setItems(EMPTY_TEMPLATE.items);
    }
  }, [mode, templateId]);

  const setItem = (i: number, patch: Partial<TemplateItem>) =>
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const addItem = () =>
    setItems((prev) => [...prev, {
      key: `item_${prev.length + 1}`,
      label: `Item ${prev.length + 1}`,
      type: 'yes_no',
      required: false,
      fail_creates_issue: false,
      photo_required_on_fail: false,
    }]);
  const removeItem = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  const moveItem = (i: number, dir: -1 | 1) => {
    setItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    setErr(null);
    // Client-side validation that matches the server's parseTemplateSchema
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (items.length === 0) { setErr('At least one item is required.'); return; }
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!/^[a-z][a-z0-9_]*$/.test(it.key)) {
        setErr(`Item ${i + 1}: key '${it.key}' must match /^[a-z][a-z0-9_]*$/`);
        return;
      }
      if (seen.has(it.key)) { setErr(`Item ${i + 1}: duplicate key '${it.key}'`); return; }
      seen.add(it.key);
      if (!it.label.trim()) { setErr(`Item ${i + 1}: label required`); return; }
    }
    setSaving(true);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      vehicle_type_code: vehicleType.trim() || null,
      schema_json: { items },
    };
    try {
      if (mode === 'edit' && templateId != null) {
        await apiFetch(`/inspection-templates/${templateId}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/inspection-templates', { method: 'POST', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tmpl-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay/60"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="bg-surface-raised border border-rmpg-700 rounded-sm w-[640px] max-w-full mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
          <h2 id="tmpl-modal-title" className="text-sm font-semibold text-rmpg-100">
            {mode === 'edit' ? 'Edit Template' : 'New Template'}
          </h2>
          <button type="button" onClick={onClose} disabled={saving} className="text-xs text-rmpg-400 hover:text-rmpg-100">
            ✕
          </button>
        </header>
        <div className="p-4 space-y-3">
          {err ? <div className="px-3 py-2 rounded-sm border border-red-500/40 text-red-300 text-xs">{err}</div> : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *">
              <input
                type="text"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={name} onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Vehicle type code">
              <input
                type="text"
                placeholder="PATROL / UNMARKED / etc."
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              type="text"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={description} onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wide mb-1 flex items-center justify-between">
              <span>Items ({items.length})</span>
              <button
                type="button"
                onClick={addItem}
                className="text-[10px] px-2 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 text-rmpg-100 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="border border-rmpg-700 rounded-sm p-2 bg-surface-base">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[9px] text-rmpg-500 uppercase tracking-wide">Item {i + 1}</div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveItem(i, -1)}
                        disabled={i === 0}
                        className="px-1 py-0.5 text-[9px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-30 text-rmpg-100"
                        aria-label="Move up"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(i, 1)}
                        disabled={i === items.length - 1}
                        className="px-1 py-0.5 text-[9px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-30 text-rmpg-100"
                        aria-label="Move down"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="px-1 py-0.5 text-[9px] border border-rmpg-700 rounded-sm hover:bg-red-900/40 text-red-300"
                        aria-label="Remove item"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <Field label="Key (snake_case)">
                      <input
                        type="text"
                        className="w-full px-1.5 py-0.5 text-[11px] bg-surface-raised border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                        value={it.key} onChange={(e) => setItem(i, { key: e.target.value })}
                        pattern="[a-z][a-z0-9_]*"
                      />
                    </Field>
                    <Field label="Label">
                      <input
                        type="text"
                        className="w-full px-1.5 py-0.5 text-[11px] bg-surface-raised border border-rmpg-700 rounded-sm text-rmpg-100"
                        value={it.label} onChange={(e) => setItem(i, { label: e.target.value })}
                      />
                    </Field>
                    <Field label="Type">
                      <select
                        className="w-full px-1.5 py-0.5 text-[11px] bg-surface-raised border border-rmpg-700 rounded-sm text-rmpg-100"
                        value={it.type} onChange={(e) => setItem(i, { type: e.target.value as TemplateItem['type'] })}
                      >
                        {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-rmpg-300">
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={it.required}
                        onChange={(e) => setItem(i, { required: e.target.checked })}
                        className="accent-brand-400"
                      />
                      Required
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={it.fail_creates_issue}
                        onChange={(e) => setItem(i, { fail_creates_issue: e.target.checked })}
                        className="accent-brand-400"
                      />
                      Fail auto-creates maintenance issue
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={it.photo_required_on_fail}
                        onChange={(e) => setItem(i, { photo_required_on_fail: e.target.checked })}
                        className="accent-brand-400"
                      />
                      Photo required on fail
                    </label>
                  </div>
                </div>
              ))}
              {items.length === 0 ? (
                <div className="text-[10px] text-rmpg-500 italic">No items yet. Click "Add item" above.</div>
              ) : null}
            </div>
          </div>
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-2 py-1 text-[11px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800 text-rmpg-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'Saving…' : (mode === 'edit' ? 'Save (forks if in use)' : 'Create')}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-rmpg-500 uppercase tracking-wide mb-0.5">{label}</div>
      {children}
    </div>
  );
}
