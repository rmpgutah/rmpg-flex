import { useMemo } from 'react';
import { Layers, Lock, Unlock, Trash2, Eye, EyeOff, ArrowUp, ArrowDown } from 'lucide-react';
import { Annotation } from '../types';

// Sidebar listing every annotation in the document with click-to-select,
// per-row lock toggle, layer toggle, and z-order controls. Particularly
// useful on long documents with many redactions / Bates-stamped pages.

interface Props {
  annotations: Annotation[];
  activeIds: Set<string>;
  layerVisibility: Record<string, boolean>;
  onSelect: (id: string, additive: boolean) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onBringForward: (id: string) => void;
  onSendBackward: (id: string) => void;
  onJumpToPage: (page: number) => void;
  onToggleLayer: (layer: string) => void;
}

const TYPE_LABELS: Record<Annotation['type'], string> = {
  text: 'Text', highlight: 'Highlight', redact: 'Redaction',
  rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line',
  pen: 'Free-hand', signature: 'Signature', image: 'Image',
  stamp: 'Stamp', link: 'Link', sticky: 'Sticky note',
};

function summarize(a: Annotation): string {
  if (a.type === 'text') return a.text.slice(0, 32);
  if (a.type === 'sticky') return a.text.slice(0, 32);
  if (a.type === 'stamp') return String(a.label);
  if (a.type === 'link') return a.url.slice(0, 32);
  return '';
}

export default function AnnotationsPanel(p: Props) {
  // Group by page.
  const byPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of p.annotations) {
      const list = m.get(a.page) ?? []; list.push(a); m.set(a.page, list);
    }
    return m;
  }, [p.annotations]);

  // Distinct layer names used across the document.
  const layers = useMemo(() => {
    const s = new Set<string>();
    for (const a of p.annotations) if (a.layer) s.add(a.layer);
    return [...s].sort();
  }, [p.annotations]);

  const pages = [...byPage.keys()].sort((a, b) => a - b);

  return (
    <div className="bg-[#0d0d0d] border border-[#222] rounded-[2px] w-[260px] flex-shrink-0 overflow-y-auto p-2 space-y-2">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-[#d4a017] font-semibold px-1">
        <Layers className="w-3 h-3" /> Annotations ({p.annotations.length})
      </div>

      {layers.length > 0 && (
        <div className="border-b border-[#222] pb-2">
          <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1 px-1">Layer visibility</div>
          {layers.map(l => {
            const visible = p.layerVisibility[l] !== false;
            return (
              <button key={l} type="button" onClick={() => p.onToggleLayer(l)}
                className="w-full text-left px-1.5 py-0.5 text-[10px] rounded-sm hover:bg-rmpg-700/40 flex items-center gap-1.5">
                {visible ? <Eye className="w-3 h-3 text-[#d4a017]" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                <span className={visible ? 'text-rmpg-200' : 'text-rmpg-500'}>{l}</span>
              </button>
            );
          })}
        </div>
      )}

      {pages.map(pageNum => (
        <div key={pageNum}>
          <button type="button" onClick={() => p.onJumpToPage(pageNum)}
            className="text-[9px] uppercase tracking-wider text-rmpg-400 hover:text-white mb-1 px-1 block w-full text-left">
            Page {pageNum} ({byPage.get(pageNum)!.length})
          </button>
          <div className="space-y-0.5">
            {byPage.get(pageNum)!.map(a => {
              const selected = p.activeIds.has(a.id);
              return (
                <div key={a.id}
                  className={`group px-1.5 py-1 rounded-sm border ${selected ? 'bg-[#d4a017]/15 border-[#d4a017]/40' : 'border-transparent hover:bg-rmpg-700/30'}`}
                >
                  <button type="button" onClick={(e) => p.onSelect(a.id, e.shiftKey)} className="w-full text-left">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] text-rmpg-200 truncate">
                        <span className="text-[#d4a017]">{TYPE_LABELS[a.type] ?? a.type}</span>
                        {summarize(a) && <span className="text-rmpg-400"> · {summarize(a)}</span>}
                      </span>
                    </div>
                  </button>
                  <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                    <button type="button" onClick={() => p.onToggleLock(a.id)} title={a.locked ? 'Unlock' : 'Lock'}
                      className="p-0.5 text-rmpg-400 hover:text-white">
                      {a.locked ? <Lock className="w-3 h-3 text-[#d4a017]" /> : <Unlock className="w-3 h-3" />}
                    </button>
                    <button type="button" onClick={() => p.onSendBackward(a.id)} title="Send backward"
                      className="p-0.5 text-rmpg-400 hover:text-white"><ArrowDown className="w-3 h-3" /></button>
                    <button type="button" onClick={() => p.onBringForward(a.id)} title="Bring forward"
                      className="p-0.5 text-rmpg-400 hover:text-white"><ArrowUp className="w-3 h-3" /></button>
                    <button type="button" onClick={() => p.onDelete(a.id)} title="Delete"
                      className="p-0.5 text-rmpg-400 hover:text-red-400 ml-auto"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {p.annotations.length === 0 && (
        <div className="text-[10px] text-rmpg-500 italic px-1 py-4 text-center">
          No annotations yet. Switch to a tool and click on a page to add one.
        </div>
      )}
    </div>
  );
}
