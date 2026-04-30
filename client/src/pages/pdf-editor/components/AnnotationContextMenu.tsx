import { useEffect, useRef } from 'react';
import { Copy, Lock, Unlock, Trash2, ArrowUp, ArrowDown, Layers as LayerIcon, MousePointer2 } from 'lucide-react';
import { Annotation } from '../types';

// Right-click context menu for annotations. Lives at a fixed (clientX, clientY)
// and dismisses on outside-click or Escape. Wired by PageCanvas via the
// onContextMenu handler on each AnnotationView wrapper.

interface Props {
  open: boolean;
  x: number;
  y: number;
  annotation: Annotation | null;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onAssignLayer: (layer: string) => void;
}

const QUICK_LAYERS = ['Markup', 'Redaction', 'Sign-off', 'Review'];

export default function AnnotationContextMenu(p: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!p.open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) p.onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p.open || !p.annotation) return null;

  const ann = p.annotation;
  const itemCls = 'w-full text-left px-2 py-1 text-[11px] hover:bg-rmpg-700/40 inline-flex items-center gap-1.5';

  return (
    <div ref={ref} className="fixed z-50 bg-[#141414] border border-[#222] rounded-[2px] shadow-lg py-1 min-w-[180px]"
      style={{ left: p.x, top: p.y }}>
      <div className="px-2 py-0.5 text-[9px] uppercase tracking-wider text-rmpg-500">
        <MousePointer2 className="w-3 h-3 inline mr-1" /> {ann.type}
      </div>
      <div className="border-t border-[#222] my-0.5" />
      <button type="button" onClick={() => { p.onDuplicate(); p.onClose(); }} className={itemCls}>
        <Copy className="w-3 h-3" /> Duplicate <span className="ml-auto text-[9px] text-rmpg-500">Ctrl+D</span>
      </button>
      <button type="button" onClick={() => { p.onToggleLock(); p.onClose(); }} className={itemCls}>
        {ann.locked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
        {ann.locked ? 'Unlock' : 'Lock'}
      </button>
      <button type="button" onClick={() => { p.onBringForward(); p.onClose(); }} className={itemCls}>
        <ArrowUp className="w-3 h-3" /> Bring forward
      </button>
      <button type="button" onClick={() => { p.onSendBackward(); p.onClose(); }} className={itemCls}>
        <ArrowDown className="w-3 h-3" /> Send backward
      </button>
      <div className="border-t border-[#222] my-0.5" />
      <div className="px-2 py-0.5 text-[9px] uppercase tracking-wider text-rmpg-500 inline-flex items-center gap-1">
        <LayerIcon className="w-3 h-3" /> Assign layer
      </div>
      {QUICK_LAYERS.map(l => (
        <button key={l} type="button" onClick={() => { p.onAssignLayer(l); p.onClose(); }}
          className={`${itemCls} pl-6`}>
          {ann.layer === l && <span className="text-[#d4a017]">●</span>} {l}
        </button>
      ))}
      <button type="button" onClick={() => { p.onAssignLayer(''); p.onClose(); }} className={`${itemCls} pl-6 text-rmpg-500`}>
        — none —
      </button>
      <div className="border-t border-[#222] my-0.5" />
      <button type="button" onClick={() => { p.onDelete(); p.onClose(); }} className={`${itemCls} text-red-300 hover:bg-red-900/30`}>
        <Trash2 className="w-3 h-3" /> Delete <span className="ml-auto text-[9px] text-rmpg-500">Del</span>
      </button>
    </div>
  );
}
