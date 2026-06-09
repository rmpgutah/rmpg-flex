import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FileText, FileCheck, Shield, FilePlus, Package, Mail, File, Bookmark, Trash2,
  Search, Car, Heart, Users, ClipboardList, Building2, Lock, Briefcase,
  Gavel, ScrollText, Scale, Star,
} from 'lucide-react';
import { TEMPLATES } from '../templates';
import { listSavedTemplates, deleteTemplate, type SavedTemplate } from '../docActions';
import type { DocumentTemplate, TemplateCategory } from '../types';
import PanelTitleBar from '../../../components/PanelTitleBar';

interface Props {
  onSelect: (template: DocumentTemplate, values: Record<string, string>) => void;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  incident: <FileText className="w-5 h-5" />,
  arrest: <FileCheck className="w-5 h-5" />,
  'use-of-force': <Shield className="w-5 h-5" />,
  supplemental: <FilePlus className="w-5 h-5" />,
  evidence: <Package className="w-5 h-5" />,
  memo: <Mail className="w-5 h-5" />,
  letter: <Mail className="w-5 h-5" />,
  general: <File className="w-5 h-5" />,
};

// Filter chips. `match(cat)` decides if a template's category belongs to the
// chip's set — kept lambda-based so a chip can span multiple raw categories
// (e.g. "Law Enforcement" covers every le-* and the old single-word LE labels).
const GROUPS: { id: string; label: string; match: (cat: string) => boolean }[] = [
  { id: 'all',          label: 'All',              match: () => true },
  { id: 'starred',      label: '★ Starred',        match: () => false }, // count uses starred set directly
  { id: 'le',           label: 'Law Enforcement',  match: (c) => c.startsWith('le-') || ['incident','arrest','use-of-force','traffic','warrant','consent','crash','bolo','missing','booking','k9','pursuit','scene','custody','interview','welfare'].includes(c) },
  { id: 'security',     label: 'Security',         match: (c) => c.startsWith('sec-') },
  { id: 'hr',           label: 'HR',               match: (c) => c.startsWith('hr-') },
  { id: 'legal',        label: 'Legal / Court',    match: (c) => c.startsWith('legal-') },
  { id: 'evidence',     label: 'Evidence',         match: (c) => c === 'evidence' || c === 'property' },
  { id: 'civil',        label: 'Civil',            match: (c) => c === 'civil' || c === 'repo' || c === 'compliance' || c === 'parking' },
  { id: 'memo',         label: 'Memo / Letter',    match: (c) => c === 'memo' || c === 'letter' },
  { id: 'general',      label: 'General',          match: (c) => c === 'general' || c === 'supplemental' },
];

const STARRED_KEY = 'rmpg_writer_starred_templates';
function loadStarred(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(STARRED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveStarred(set: Set<string>): void {
  try { localStorage.setItem(STARRED_KEY, JSON.stringify([...set])); } catch { /* noop */ }
}

/** Wrap a localStorage saved-template into the DocumentTemplate shape the page
 *  expects (no fields — its HTML is inserted verbatim). */
function asTemplate(saved: SavedTemplate): DocumentTemplate {
  return { id: `custom-${saved.name}`, name: saved.name, category: 'general', description: 'Saved custom template', content: saved.html, fields: [] };
}

export default function TemplateChooser({ onSelect }: Props) {
  const [selected, setSelected] = useState<DocumentTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<SavedTemplate[]>(() => listSavedTemplates());
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [starred, setStarred] = useState<Set<string>>(() => loadStarred());

  const handleUse = () => {
    if (!selected) return;
    onSelect(selected, values);
  };

  const handleDeleteCustom = (name: string) => {
    if (!window.confirm(`Delete saved template "${name}"?`)) return;
    deleteTemplate(name);
    setCustom(listSavedTemplates());
  };

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveStarred(next);
      return next;
    });
  };

  // Filtered template grid: chip → text query → starred override. Memoized so
  // typing in the search box doesn't re-walk all 200+ templates per keystroke.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let pool = TEMPLATES;
    if (group === 'starred') {
      pool = pool.filter((t) => starred.has(t.id));
    } else if (group !== 'all') {
      const g = GROUPS.find((x) => x.id === group);
      if (g) pool = pool.filter((t) => g.match(t.category));
    }
    if (!needle) return pool;
    return pool.filter((t) => {
      if (t.name.toLowerCase().includes(needle)) return true;
      if (t.description.toLowerCase().includes(needle)) return true;
      if (t.category.toLowerCase().includes(needle)) return true;
      if (t.tags?.some((tag) => tag.toLowerCase().includes(needle))) return true;
      if (t.statutes?.some((s) => s.toLowerCase().includes(needle))) return true;
      return false;
    });
  }, [query, group, starred]);

  if (selected) {
    return (
      <div className="p-3 md:p-6 max-w-2xl mx-auto">
        <PanelTitleBar title={selected.name.toUpperCase()} icon={FileText} />
        <p className="text-xs text-rmpg-500 mt-2 mb-4">{selected.description}</p>

        {selected.fields.length > 0 && (
          <div className="space-y-3 mb-6">
            <p className="text-[11px] text-rmpg-400 font-medium uppercase tracking-wide">Fill in fields (or leave blank to fill later):</p>
            {selected.fields.map(f => (
              <div key={f.key} className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
                <label className="text-[11px] text-rmpg-300 md:w-36 md:text-right flex-shrink-0">{f.label}:</label>
                <input
                  type="text"
                  value={values[f.key] || ''}
                  onChange={(e) => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.source === 'cad' ? `Auto-fill from CAD (${f.cadPath})` : 'Enter value...'}
                  className="w-full md:flex-1 bg-[#0a0a0a] border border-[#222] rounded-[2px] px-2.5 py-1.5 text-xs text-rmpg-200 placeholder-rmpg-600 focus:border-[#d4a017]/50 focus:outline-none min-h-[44px] md:min-h-0"
                />
                {f.source === 'cad' && (
                  <span className="text-[9px] text-[#d4a017]/60 font-mono">CAD</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <button type="button" onClick={handleUse}
            className="px-4 py-2 text-xs font-medium bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20 min-h-[44px] sm:min-h-0">
            Create Document
          </button>
          <button type="button" onClick={() => { setSelected(null); setValues({}); }}
            className="px-4 py-2 text-xs text-rmpg-400 hover:text-rmpg-200 min-h-[44px] sm:min-h-0">
            ← Back to templates
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-6">
      <PanelTitleBar title="NEW DOCUMENT" icon={FileText} />
      <p className="text-xs text-rmpg-500 mt-2 mb-6">Choose a template or start with a blank document.</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {TEMPLATES.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelected(t)}
            className="flex flex-col items-center gap-2 p-4 bg-[#0d0d0d] border border-[#222] rounded-[2px] hover:border-[#d4a017]/40 hover:bg-[#141414] transition-colors text-center group"
          >
            <div className="text-rmpg-500 group-hover:text-[#d4a017] transition-colors">
              {CATEGORY_ICONS[t.category] || <File className="w-5 h-5" />}
            </div>
            <span className="text-[11px] font-medium text-rmpg-300 group-hover:text-rmpg-100">{t.name}</span>
            <span className="text-[9px] text-rmpg-600 leading-tight">{t.description}</span>
          </button>
        ))}
      </div>

      {custom.length > 0 && (
        <>
          <p className="text-[11px] text-rmpg-400 font-medium uppercase tracking-wide mt-6 mb-2 flex items-center gap-1.5">
            <Bookmark className="w-3.5 h-3.5 text-[#d4a017]" /> My Saved Templates
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {custom.map((t) => (
              <div key={t.name} className="relative flex flex-col items-center gap-2 p-4 bg-[#0d0d0d] border border-[#222] rounded-[2px] hover:border-[#d4a017]/40 hover:bg-[#141414] transition-colors text-center group">
                <button type="button" onClick={() => setSelected(asTemplate(t))} className="flex flex-col items-center gap-2 w-full">
                  <Bookmark className="w-5 h-5 text-rmpg-500 group-hover:text-[#d4a017] transition-colors" />
                  <span className="text-[11px] font-medium text-rmpg-300 group-hover:text-rmpg-100 break-words">{t.name}</span>
                  <span className="text-[9px] text-rmpg-600 leading-tight">Saved {new Date(t.savedAt).toLocaleDateString()}</span>
                </button>
                <button type="button" aria-label={`Delete template ${t.name}`} title="Delete saved template"
                  onClick={() => handleDeleteCustom(t.name)}
                  className="absolute top-1 right-1 p-1 text-rmpg-600 hover:text-red-400 opacity-0 group-hover:opacity-100">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Stock templates grid — filtered by search query + selected group chip. */}
      <p className="text-[11px] text-rmpg-400 font-medium uppercase tracking-wide mt-6 mb-2">
        Templates ({filtered.length})
      </p>
      {filtered.length === 0 ? (
        <div className="p-6 text-center text-rmpg-600 text-xs border border-dashed border-[#222] rounded-[2px]">
          No templates match this filter.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((t) => {
            const isStarred = starred.has(t.id);
            return (
              <div
                key={t.id}
                className="relative flex flex-col items-center gap-2 p-4 bg-[#0d0d0d] border border-[#222] rounded-[2px] hover:border-[#d4a017]/40 hover:bg-[#141414] transition-colors text-center group"
              >
                <button
                  type="button"
                  onClick={() => setSelected(t)}
                  className="flex flex-col items-center gap-2 w-full text-rmpg-500 group-hover:text-[#d4a017] transition-colors"
                >
                  {CATEGORY_ICONS[t.category as TemplateCategory] || <File className="w-5 h-5" />}
                  <span className="text-[11px] font-medium text-rmpg-300 group-hover:text-rmpg-100 break-words">{t.name}</span>
                  <span className="text-[9px] text-rmpg-600 uppercase tracking-wider">{t.category}</span>
                </button>
                <button
                  type="button"
                  aria-label={isStarred ? `Unstar template ${t.name}` : `Star template ${t.name}`}
                  title={isStarred ? 'Unstar' : 'Star'}
                  onClick={() => toggleStar(t.id)}
                  className={`absolute top-1 right-1 p-1 transition-colors ${isStarred ? 'text-[#d4a017]' : 'text-rmpg-600 opacity-0 group-hover:opacity-100 hover:text-[#d4a017]'}`}
                >
                  <Star className="w-3 h-3" fill={isStarred ? '#d4a017' : 'none'} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
