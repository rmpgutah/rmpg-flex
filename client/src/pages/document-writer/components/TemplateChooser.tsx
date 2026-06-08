import { useState } from 'react';
import { FileText, FileCheck, Shield, FilePlus, Package, Mail, File } from 'lucide-react';
import { TEMPLATES } from '../templates';
import type { DocumentTemplate } from '../types';
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

export default function TemplateChooser({ onSelect }: Props) {
  const [selected, setSelected] = useState<DocumentTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const handleUse = () => {
    if (!selected) return;
    onSelect(selected, values);
  };

  if (selected) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <PanelTitleBar title={selected.name.toUpperCase()} icon={FileText} />
        <p className="text-xs text-rmpg-500 mt-2 mb-4">{selected.description}</p>

        {selected.fields.length > 0 && (
          <div className="space-y-3 mb-6">
            <p className="text-[11px] text-rmpg-400 font-medium uppercase tracking-wide">Fill in fields (or leave blank to fill later):</p>
            {selected.fields.map(f => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="text-[11px] text-rmpg-300 w-36 text-right flex-shrink-0">{f.label}:</label>
                <input
                  type="text"
                  value={values[f.key] || ''}
                  onChange={(e) => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.source === 'cad' ? `Auto-fill from CAD (${f.cadPath})` : 'Enter value...'}
                  className="flex-1 bg-[#0a0a0a] border border-[#222] rounded-[2px] px-2.5 py-1.5 text-xs text-rmpg-200 placeholder-rmpg-600 focus:border-[#d4a017]/50 focus:outline-none"
                />
                {f.source === 'cad' && (
                  <span className="text-[9px] text-[#d4a017]/60 font-mono">CAD</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button type="button" onClick={handleUse}
            className="px-4 py-2 text-xs font-medium bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20">
            Create Document
          </button>
          <button type="button" onClick={() => { setSelected(null); setValues({}); }}
            className="px-4 py-2 text-xs text-rmpg-400 hover:text-rmpg-200">
            ← Back to templates
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
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
    </div>
  );
}
