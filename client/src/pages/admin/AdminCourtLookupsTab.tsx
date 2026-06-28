import { useEffect, useState, useCallback } from 'react';
import { Gavel, Plus, Pencil, Trash2, Save, X, Eye, EyeOff, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

// AdminCourtLookupsTab — manages every editable dropdown in the Court Tracker.
//
// Each `category` (e.g. court, judge, prosecutor, event_type, outcome,
// plea, bond_status, witness_type, officer_role) is a list of values that
// admins can add / rename / reorder / disable / delete. New categories
// can be added here too — the Court Tracker UI uses whatever rows exist
// for the matching category, so a brand-new dropdown surface is just an
// INSERT here.

interface Lookup {
  id: number;
  category: string;
  value: string;
  display_label: string | null;
  meta: string | null;
  display_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface CategoryRow { category: string; count: number; }

interface Props {
  LoadingSpinner?: React.FC;
  error?: string | null;
  setError?: (e: string | null) => void;
}

const inputCls = 'w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';

export default function AdminCourtLookupsTab({ setError: setOuterError }: Props) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [items, setItems] = useState<Lookup[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Lookup> | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await apiFetch<CategoryRow[]>('/api/court/lookups/categories');
      setCategories(cats);
      if (!activeCategory && cats.length > 0) setActiveCategory(cats[0].category);
    } catch (err) { setOuterError?.(err instanceof Error ? err.message : 'Failed to load categories'); }
  }, [activeCategory, setOuterError]);

  const loadItems = useCallback(async (cat: string) => {
    if (!cat) return;
    try {
      setLoading(true);
      const params = new URLSearchParams({ category: cat });
      if (showInactive) params.set('includeInactive', 'true');
      const data = await apiFetch<Lookup[]>(`/api/court/lookups?${params}`);
      setItems(data);
    } catch (err) {
      setOuterError?.(err instanceof Error ? err.message : 'Failed to load lookups');
    } finally { setLoading(false); }
  }, [showInactive, setOuterError]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { if (activeCategory) loadItems(activeCategory); }, [activeCategory, loadItems]);

  const startNew = () => {
    setEditing(0); // 0 = new draft
    setDraft({ category: activeCategory, value: '', display_label: '', display_order: 100, is_active: 1 });
  };

  const saveDraft = async () => {
    if (!draft || !draft.value) return;
    try {
      if (editing === 0) {
        await apiFetch('/api/court/lookups', {
          method: 'POST',
          body: JSON.stringify(draft),
        });
      } else if (editing) {
        await apiFetch(`/api/court/lookups/${editing}`, {
          method: 'PUT',
          body: JSON.stringify(draft),
        });
      }
      setEditing(null); setDraft(null);
      await loadItems(activeCategory);
      await loadCategories();
    } catch (err) {
      setOuterError?.(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this lookup entry? Existing court events that reference it will keep their value as free text.')) return;
    try {
      await apiFetch(`/api/court/lookups/${id}`, { method: 'DELETE' });
      await loadItems(activeCategory);
      await loadCategories();
    } catch (err) {
      setOuterError?.(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const toggleActive = async (it: Lookup) => {
    try {
      await apiFetch(`/api/court/lookups/${it.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !it.is_active }),
      });
      await loadItems(activeCategory);
    } catch (err) {
      setOuterError?.(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const addCategory = () => {
    const name = newCategoryName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!name) return;
    // Don't actually create until first item is added — adding a row with
    // a new category creates the category implicitly.
    setActiveCategory(name);
    setItems([]);
    setNewCategoryName('');
    setCreatingNew(false);
    setDraft({ category: name, value: '', display_label: '', display_order: 100, is_active: 1 });
    setEditing(0);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Gavel className="w-4 h-4 text-[#d4a017]" />
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Court Tracker — Lookups</h3>
        <button type="button" onClick={() => { loadCategories(); loadItems(activeCategory); }}
          className="ml-auto p-1 text-rmpg-400 hover:text-white" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-[10px] text-rmpg-500">
        Every dropdown in the Court Tracker (courts, judges, prosecutors, event types, outcomes, pleas, bond statuses, witness types, officer roles, charge codes) reads from this table. Add/edit/disable values here and they appear immediately in the event editor. Disabling preserves history; deleting removes the row but doesn't alter past events that referenced it as text.
      </p>

      {/* Category tabs */}
      <div className="flex flex-wrap items-center gap-1 bg-[#0d0d0d] border border-[#222] rounded-sm p-1.5">
        {categories.map(c => (
          <button key={c.category} type="button" onClick={() => setActiveCategory(c.category)}
            className={`px-2 py-0.5 text-[10px] rounded-sm ${
              activeCategory === c.category ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-300 hover:bg-rmpg-700/40'
            }`}>
            {c.category} <span className="text-rmpg-500">({c.count})</span>
          </button>
        ))}
        <div className="flex-1" />
        {creatingNew ? (
          <div className="flex items-center gap-1">
            <input type="text" value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              placeholder="new_category_name"
              className="bg-[#0a0a0a] border border-[#222] text-[10px] text-white px-1.5 py-0.5 rounded-sm focus:outline-none focus:border-[#d4a017]" />
            <button type="button" onClick={addCategory} className="text-[10px] text-[#d4a017] px-1">add</button>
            <button type="button" onClick={() => { setCreatingNew(false); setNewCategoryName(''); }} className="text-[10px] text-rmpg-500 px-1">×</button>
          </div>
        ) : (
          <button type="button" onClick={() => setCreatingNew(true)}
            className="px-2 py-0.5 text-[10px] text-rmpg-400 hover:text-white inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> New category
          </button>
        )}
      </div>

      {/* Items */}
      <div className="bg-[#0d0d0d] border border-[#222] rounded-sm">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#222]">
          <span className="text-[10px] uppercase tracking-wider text-rmpg-500">
            {activeCategory ? `${activeCategory} · ${items.length} entries` : 'Select a category'}
          </span>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1 text-[10px] text-rmpg-400">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
            <button type="button" onClick={startNew} disabled={!activeCategory}
              className="btn-secondary text-[10px] inline-flex items-center gap-1 disabled:opacity-50">
              <Plus className="w-3 h-3" /> Add value
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-4 text-center text-[10px] text-rmpg-500">
            <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading…
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="bg-[#0a0a0a] text-rmpg-500 uppercase tracking-wider text-[9px]">
              <tr>
                <th className="text-left px-2 py-1 w-12">Order</th>
                <th className="text-left px-2 py-1 w-40">Value</th>
                <th className="text-left px-2 py-1">Display label</th>
                <th className="text-left px-2 py-1">Meta</th>
                <th className="text-left px-2 py-1 w-20">Active</th>
                <th className="text-right px-2 py-1 w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {editing === 0 && draft && (
                <tr className="bg-[#d4a017]/10 border-b border-[#222]">
                  <td className="px-2 py-1">
                    <input type="number" value={draft.display_order ?? 100}
                      onChange={e => setDraft({ ...draft, display_order: parseInt(e.target.value, 10) || 100 })}
                      className={inputCls} />
                  </td>
                  <td className="px-2 py-1">
                    <input type="text" value={draft.value ?? ''}
                      onChange={e => setDraft({ ...draft, value: e.target.value })}
                      placeholder="snake_case_value"
                      className={inputCls} autoFocus />
                  </td>
                  <td className="px-2 py-1">
                    <input type="text" value={draft.display_label ?? ''}
                      onChange={e => setDraft({ ...draft, display_label: e.target.value })}
                      placeholder="Human Readable Label"
                      className={inputCls} />
                  </td>
                  <td className="px-2 py-1">
                    <input type="text" value={draft.meta ?? ''}
                      onChange={e => setDraft({ ...draft, meta: e.target.value })}
                      placeholder="optional JSON / notes"
                      className={inputCls} />
                  </td>
                  <td className="px-2 py-1">
                    <input type="checkbox" checked={!!draft.is_active}
                      onChange={e => setDraft({ ...draft, is_active: e.target.checked ? 1 : 0 })} />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button type="button" onClick={saveDraft} className="text-[#d4a017] mr-2" title="Save"><Save className="w-3.5 h-3.5 inline" /></button>
                    <button type="button" onClick={() => { setEditing(null); setDraft(null); }} className="text-rmpg-500" title="Cancel"><X className="w-3.5 h-3.5 inline" /></button>
                  </td>
                </tr>
              )}
              {items.map(it => editing === it.id && draft ? (
                <tr key={it.id} className="bg-[#d4a017]/10 border-b border-[#222]">
                  <td className="px-2 py-1">
                    <input type="number" value={draft.display_order ?? it.display_order}
                      onChange={e => setDraft({ ...draft, display_order: parseInt(e.target.value, 10) || 100 })}
                      className={inputCls} />
                  </td>
                  <td className="px-2 py-1">
                    <input type="text" value={draft.value ?? it.value}
                      onChange={e => setDraft({ ...draft, value: e.target.value })}
                      className={inputCls} />
                  </td>
                  <td className="px-2 py-1">
                    <input type="text" value={draft.display_label ?? it.display_label ?? ''}
                      onChange={e => setDraft({ ...draft, display_label: e.target.value })}
                      className={inputCls} />
                  </td>
                  <td className="px-2 py-1">
                    <input type="text" value={draft.meta ?? it.meta ?? ''}
                      onChange={e => setDraft({ ...draft, meta: e.target.value })}
                      className={inputCls} />
                  </td>
                  <td className="px-2 py-1">
                    <input type="checkbox" checked={!!(draft.is_active ?? it.is_active)}
                      onChange={e => setDraft({ ...draft, is_active: e.target.checked ? 1 : 0 })} />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button type="button" onClick={saveDraft} className="text-[#d4a017] mr-2" title="Save"><Save className="w-3.5 h-3.5 inline" /></button>
                    <button type="button" onClick={() => { setEditing(null); setDraft(null); }} className="text-rmpg-500" title="Cancel"><X className="w-3.5 h-3.5 inline" /></button>
                  </td>
                </tr>
              ) : (
                <tr key={it.id} className={`border-b border-[#1a1a1a] hover:bg-[#101010] ${!it.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-2 py-1 font-mono text-rmpg-400">{it.display_order}</td>
                  <td className="px-2 py-1 font-mono text-rmpg-300">{it.value}</td>
                  <td className="px-2 py-1 text-rmpg-200">{it.display_label || <span className="text-rmpg-600 italic">(uses value)</span>}</td>
                  <td className="px-2 py-1 text-rmpg-500 text-[10px]">{it.meta || ''}</td>
                  <td className="px-2 py-1">
                    <button type="button" onClick={() => toggleActive(it)}
                      className={it.is_active ? 'text-green-400' : 'text-rmpg-500'} title={it.is_active ? 'Disable' : 'Enable'}>
                      {it.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button type="button"
                      onClick={() => { setEditing(it.id); setDraft({ ...it }); }}
                      className="text-rmpg-400 hover:text-[#d4a017] mr-2" title="Edit"><Pencil className="w-3.5 h-3.5 inline" /></button>
                    <button type="button" onClick={() => remove(it.id)}
                      className="text-rmpg-400 hover:text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5 inline" /></button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && editing !== 0 && (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-[10px] text-rmpg-500 italic">
                  {activeCategory ? 'No entries in this category yet. Click "Add value".' : 'Pick a category above to manage its entries.'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
