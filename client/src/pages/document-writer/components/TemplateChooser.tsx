import { useState } from 'react';
import { FileText, FileCheck, Shield, FilePlus, Package, Mail, File, Bookmark, Trash2 } from 'lucide-react';
import { TEMPLATES } from '../templates';
import { listSavedTemplates, deleteTemplate, type SavedTemplate } from '../docActions';
import type { DocumentTemplate } from '../types';
import PanelTitleBar from '../../../components/PanelTitleBar';

interface Props {
  onSelect: (template: DocumentTemplate, values: Record<string, string>) => void;
}

const CATEGORY_ICONS: Record<TemplateCategory, React.ReactNode> = {
  incident: <FileText className="w-5 h-5" />,
  arrest: <FileCheck className="w-5 h-5" />,
  'use-of-force': <Shield className="w-5 h-5" />,
  supplemental: <FilePlus className="w-5 h-5" />,
  evidence: <Package className="w-5 h-5" />,
  memo: <Mail className="w-5 h-5" />,
  letter: <Mail className="w-5 h-5" />,
  general: <File className="w-5 h-5" />,
  'le-traffic': <Car className="w-5 h-5" />,
  'le-dv': <Heart className="w-5 h-5" />,
  'le-juvenile': <Users className="w-5 h-5" />,
  'le-investigation': <Search className="w-5 h-5" />,
  'le-pursuit': <Shield className="w-5 h-5" />,
  'le-property': <Package className="w-5 h-5" />,
  'le-missing': <Users className="w-5 h-5" />,
  'sec-post': <ClipboardList className="w-5 h-5" />,
  'sec-dar': <ClipboardList className="w-5 h-5" />,
  'sec-client': <Building2 className="w-5 h-5" />,
  'sec-access': <Lock className="w-5 h-5" />,
  'sec-patrol': <Shield className="w-5 h-5" />,
  'hr-employee': <Briefcase className="w-5 h-5" />,
  'hr-discipline': <Briefcase className="w-5 h-5" />,
  'hr-training': <Briefcase className="w-5 h-5" />,
  'hr-leave': <Briefcase className="w-5 h-5" />,
  'legal-court': <Gavel className="w-5 h-5" />,
  'legal-warrant': <ScrollText className="w-5 h-5" />,
  'legal-affidavit': <ScrollText className="w-5 h-5" />,
  'legal-discovery': <Scale className="w-5 h-5" />,
};

/** Wrap a localStorage saved-template into the DocumentTemplate shape the page
 *  expects (no fields — its HTML is inserted verbatim). */
function asTemplate(saved: SavedTemplate): DocumentTemplate {
  return { id: `custom-${saved.name}`, name: saved.name, category: 'general', description: 'Saved custom template', content: saved.html, fields: [] };
}

export default function TemplateChooser({ onSelect }: Props) {
  const [selected, setSelected] = useState<DocumentTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<SavedTemplate[]>(() => listSavedTemplates());

  const handleUse = () => {
    if (!selected) return;
    onSelect(selected, values);
  };

  const handleDeleteCustom = (name: string) => {
    if (!window.confirm(`Delete saved template "${name}"?`)) return;
    deleteTemplate(name);
    setCustom(listSavedTemplates());
  };

  if (selected) {
    return (
      <div className="p-3 md:p-6 max-w-2xl mx-auto">
        <PanelTitleBar title={selected.name.toUpperCase()} icon={FileText} />
        <p className="text-xs text-rmpg-500 mt-2 mb-2">{selected.description}</p>
        {selected.statutes && selected.statutes.length > 0 && (
          <p className="text-[10px] text-[#d4a017] mb-4"><strong>Utah Code:</strong> {selected.statutes.join(' · ')}</p>
        )}

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
                {f.source === 'cad' && <span className="text-[9px] text-[#d4a017]/60 font-mono">CAD</span>}
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
      <p className="text-xs text-rmpg-500 mt-2 mb-4">{TEMPLATES.length} templates available. Filter by category, search, or star your favorites.</p>

      {/* Search + tabs */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates (name, tag, statute, category)..."
            className="w-full bg-[#0a0a0a] border border-[#222] rounded-[2px] pl-8 pr-3 py-2 text-xs text-rmpg-200 placeholder-rmpg-600 focus:border-[#d4a017]/50 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GROUPS.map(g => {
            const count = g.id === 'starred' ? starred.size : TEMPLATES.filter(t => g.match(t.category)).length;
            const active = group === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={`px-3 py-1 text-[11px] rounded-[2px] border transition-colors ${active ? 'bg-[#d4a017]/15 border-[#d4a017]/40 text-[#d4a017]' : 'bg-[#0d0d0d] border-[#222] text-rmpg-400 hover:text-rmpg-200 hover:border-[#333]'}`}
              >
                {g.label} <span className="text-rmpg-600 ml-1">{count}</span>
              </button>
            );
          })}
        </div>
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
    </div>
  );
}
