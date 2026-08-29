import { useMemo, useState } from 'react';
import {
  FileText, FileCheck, Shield, FilePlus, Package, Mail, File, Bookmark, Trash2,
  Search, Car, Heart, Users, ClipboardList, Building2, Lock, Briefcase,
  Gavel, ScrollText, Scale, Star, Star as StarIcon, LayoutList,
} from 'lucide-react';
import { TEMPLATES } from '../templates';
import { listSavedTemplates, deleteTemplate, type SavedTemplate } from '../docActions';
import type { DocumentTemplate, TemplateCategory } from '../types';
import PanelTitleBar from '../../../components/PanelTitleBar';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { toDisplayLabel } from '../../../utils/formatters';
import { coded } from '../../../utils/searchText';

interface Props {
  onSelect: (template: DocumentTemplate, values: Record<string, string>) => void;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  incident: <FileText className="w-4 h-4" />,
  arrest: <FileCheck className="w-4 h-4" />,
  'use-of-force': <Shield className="w-4 h-4" />,
  supplemental: <FilePlus className="w-4 h-4" />,
  evidence: <Package className="w-4 h-4" />,
  memo: <Mail className="w-4 h-4" />,
  letter: <Mail className="w-4 h-4" />,
  general: <File className="w-4 h-4" />,
};

interface Group {
  id: string;
  label: string;
  icon: React.ReactNode;
  match: (cat: string) => boolean;
}

const GROUPS: Group[] = [
  { id: 'all',       label: 'All Templates',    icon: <LayoutList className="w-4 h-4" />,    match: () => true },
  { id: 'starred',   label: 'Starred',          icon: <Star className="w-4 h-4" />,          match: () => false },
  { id: 'le',        label: 'Law Enforcement',  icon: <Shield className="w-4 h-4" />,        match: (c) => c.startsWith('le-') || ['incident','arrest','use-of-force','traffic','warrant','consent','crash','bolo','missing','booking','k9','pursuit','scene','custody','interview','welfare'].includes(c) },
  { id: 'security',  label: 'Security',         icon: <Lock className="w-4 h-4" />,          match: (c) => c.startsWith('sec-') },
  { id: 'legal',     label: 'Legal / Court',    icon: <Gavel className="w-4 h-4" />,         match: (c) => c.startsWith('legal-') },
  { id: 'evidence',  label: 'Evidence',         icon: <Package className="w-4 h-4" />,       match: (c) => c === 'evidence' || c === 'property' },
  { id: 'civil',     label: 'Civil / Process',  icon: <ScrollText className="w-4 h-4" />,   match: (c) => c === 'civil' || c === 'repo' || c === 'compliance' || c === 'parking' },
  { id: 'hr',        label: 'HR',               icon: <Users className="w-4 h-4" />,         match: (c) => c.startsWith('hr-') },
  { id: 'memo',      label: 'Memo / Letter',    icon: <Mail className="w-4 h-4" />,          match: (c) => c === 'memo' || c === 'letter' },
  { id: 'general',   label: 'General',          icon: <File className="w-4 h-4" />,          match: (c) => c === 'general' || c === 'supplemental' },
  { id: 'saved',     label: 'My Saved',         icon: <Bookmark className="w-4 h-4" />,      match: () => false },
];

const STARRED_KEY = 'rmpg_writer_starred_templates';
function loadStarred(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(STARRED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveStarred(set: Set<string>): void {
  try { localStorage.setItem(STARRED_KEY, JSON.stringify([...set])); } catch { /* noop */ }
}

function asTemplate(saved: SavedTemplate): DocumentTemplate {
  return { id: `custom-${saved.name}`, name: saved.name, category: 'general', description: 'Saved custom template', content: saved.html, fields: [] };
}

export default function TemplateChooser({ onSelect }: Props) {
  const [selected, setSelected] = useState<DocumentTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<SavedTemplate[]>(() => listSavedTemplates());
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [starred, setStarred] = useState<Set<string>>(() => loadStarred());
  const [deleteName, setDeleteName] = useState<string | null>(null);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveStarred(next);
      return next;
    });
  };

  const handleDeleteCustom = (name: string) => {
    setDeleteName(name);
  };

  const confirmDeleteCustom = () => {
    if (!deleteName) return;
    deleteTemplate(deleteName);
    setCustom(listSavedTemplates());
    setDeleteName(null);
  };

  // Count of templates per group (memoised; star counts use the live set)
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of GROUPS) {
      if (g.id === 'starred') counts[g.id] = TEMPLATES.filter((t) => starred.has(t.id)).length;
      else if (g.id === 'saved') counts[g.id] = custom.length;
      else if (g.id === 'all') counts[g.id] = TEMPLATES.length;
      else counts[g.id] = TEMPLATES.filter((t) => g.match(t.category)).length;
    }
    return counts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custom, starred]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (activeGroup === 'saved') return [];
    let pool = TEMPLATES;
    if (activeGroup === 'starred') pool = pool.filter((t) => starred.has(t.id));
    else if (activeGroup !== 'all') {
      const g = GROUPS.find((x) => x.id === activeGroup);
      if (g) pool = pool.filter((t) => g.match(t.category));
    }
    if (!needle) return pool;
    return pool.filter((t) =>
      t.name.toLowerCase().includes(needle) ||
      t.description.toLowerCase().includes(needle) ||
      coded(t.category, (v) => toDisplayLabel(v ?? '')).includes(needle) ||
      t.tags?.some((tag) => tag.toLowerCase().includes(needle)) ||
      t.statutes?.some((s) => s.toLowerCase().includes(needle))
    );
  }, [query, activeGroup, starred]);

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
                  className="w-full md:flex-1 bg-surface-sunken border border-border-default rounded-[2px] px-2.5 py-1.5 text-xs text-rmpg-200 placeholder-rmpg-600 focus:border-accent-silver-500/50 focus:outline-none min-h-[44px] md:min-h-0"
                />
                {f.source === 'cad' && <span className="text-[9px] text-accent-silver-400/60 font-mono">CAD</span>}
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <button type="button" onClick={() => onSelect(selected, values)}
            className="px-4 py-2 text-xs font-medium bg-accent-silver-500/10 border border-accent-silver-500/30 text-accent-silver-300 rounded-[2px] hover:bg-accent-silver-500/20 min-h-[44px] sm:min-h-0">
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
    <>
    <div className="flex h-full min-h-0">
      {/* ── Left sidebar — category nav ─────────────────────────────── */}
      <div className="w-44 flex-shrink-0 border-r border-border-default bg-surface-base flex flex-col overflow-y-auto py-2">
        <div className="px-3 pb-2">
          <PanelTitleBar title="NEW DOCUMENT" icon={FileText} />
        </div>

        {/* Search box */}
        <div className="px-2 pb-2">
          <div className="flex items-center gap-1.5 bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1">
            <Search className="w-3 h-3 text-rmpg-500 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search…"
              aria-label="Search document templates"
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (e.target.value) setActiveGroup('all'); }}
              className="bg-transparent text-[10px] text-rmpg-200 placeholder-rmpg-600 focus:outline-none w-full min-w-0"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-rmpg-500 hover:text-rmpg-200">
                ×
              </button>
            )}
          </div>
        </div>

        <nav className="flex flex-col gap-px px-1">
          {GROUPS.map((g) => {
            const count = groupCounts[g.id] ?? 0;
            if (g.id === 'saved' && custom.length === 0) return null;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => { setActiveGroup(g.id); setQuery(''); }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-[2px] text-left transition-colors ${
                  activeGroup === g.id
                    ? 'bg-accent-silver-500/15 text-accent-silver-300'
                    : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-surface-raised'
                }`}
              >
                <span className={activeGroup === g.id ? 'text-accent-silver-300' : 'text-rmpg-500'}>{g.icon}</span>
                <span className="text-[10px] font-medium flex-1 truncate">{g.label}</span>
                {count > 0 && (
                  <span className={`text-[9px] tabular-nums ${activeGroup === g.id ? 'text-accent-silver-400/70' : 'text-rmpg-600'}`}>{count}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Right panel — template grid ─────────────────────────────── */}
      <div className="flex-1 overflow-auto p-3">
        {query && (
          <p className="text-[10px] text-rmpg-500 mb-3">
            Showing {filtered.length} result{filtered.length !== 1 ? 's' : ''} for "<span className="text-rmpg-300">{query}</span>"
          </p>
        )}

        {activeGroup === 'saved' ? (
          <>
            <p className="text-[11px] text-rmpg-400 font-medium uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-accent-silver-400" /> My Saved Templates
            </p>
            {custom.length === 0 ? (
              <div className="p-6 text-center text-rmpg-600 text-xs border border-dashed border-border-default rounded-[2px]">
                No saved templates yet. Save a document as a template from the toolbar.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {custom.map((t) => (
                  <div key={t.name} className="relative flex flex-col items-center gap-2 p-3 bg-surface-base border border-border-default rounded-[2px] hover:border-accent-silver-500/40 transition-colors text-center group">
                    <button type="button" onClick={() => setSelected(asTemplate(t))} className="flex flex-col items-center gap-2 w-full">
                      <Bookmark className="w-5 h-5 text-rmpg-500 group-hover:text-accent-silver-300 transition-colors" />
                      <span className="text-[10px] font-medium text-rmpg-300 group-hover:text-rmpg-100 break-words leading-tight">{t.name}</span>
                      <span className="text-[9px] text-rmpg-600">Saved {new Date(t.savedAt).toLocaleDateString('en-US', { timeZone: 'America/Denver' })}</span> // new-date-ok
                    </button>
                    <button type="button" aria-label={`Delete template ${t.name}`} title="Delete saved template"
                      onClick={() => handleDeleteCustom(t.name)}
                      className="absolute top-1 right-1 p-1 text-rmpg-600 hover:text-red-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-rmpg-600 text-xs border border-dashed border-border-default rounded-[2px]">
            {activeGroup === 'starred' ? 'No starred templates. Hover a template and click ★ to star it.' : 'No templates match this filter.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {filtered.map((t) => {
              const isStarred = starred.has(t.id);
              return (
                <div key={t.id} className="relative flex flex-col items-center gap-2 p-3 bg-surface-base border border-border-default rounded-[2px] hover:border-accent-silver-500/40 transition-colors text-center group">
                  <button type="button" onClick={() => setSelected(t)}
                    className="flex flex-col items-center gap-2 w-full text-rmpg-500 group-hover:text-accent-silver-300 transition-colors">
                    {CATEGORY_ICONS[t.category as TemplateCategory] || <File className="w-4 h-4" />}
                    <span className="text-[10px] font-medium text-rmpg-300 group-hover:text-rmpg-100 break-words leading-tight">{t.name}</span>
                    <span className="text-[9px] text-rmpg-600 uppercase tracking-wider leading-tight">{toDisplayLabel(t.category)}</span>
                  </button>
                  <button type="button"
                    aria-label={isStarred ? `Unstar template ${t.name}` : `Star template ${t.name}`}
                    title={isStarred ? 'Unstar' : 'Star'}
                    onClick={() => toggleStar(t.id)}
                    className={`absolute top-1 right-1 p-1 transition-colors ${isStarred ? 'text-accent-silver-300' : 'text-rmpg-600 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 hover:text-accent-silver-300'}`}
                  >
                    <StarIcon className="w-3 h-3" fill={isStarred ? 'currentColor' : 'none'} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    <ConfirmDialog
      isOpen={deleteName != null}
      onClose={() => setDeleteName(null)}
      onConfirm={confirmDeleteCustom}
      title="Delete saved template"
      message={`Delete saved template "${deleteName ?? ''}"? This cannot be undone.`}
      confirmLabel="Delete"
      confirmVariant="danger"
    />
    </>
  );
}
