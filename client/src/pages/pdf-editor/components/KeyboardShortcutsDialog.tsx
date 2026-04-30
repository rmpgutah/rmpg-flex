import { Keyboard, X } from 'lucide-react';

interface Props { open: boolean; onClose: () => void; }

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/⌘ + Z', 'Undo'],
  ['Ctrl/⌘ + Shift + Z, Ctrl/⌘ + Y', 'Redo'],
  ['Ctrl/⌘ + S', 'Save copy'],
  ['Ctrl/⌘ + F', 'Find in document'],
  ['Ctrl/⌘ + C', 'Copy selected annotations'],
  ['Ctrl/⌘ + V', 'Paste annotations'],
  ['Ctrl/⌘ + D', 'Duplicate selected annotation'],
  ['Ctrl/⌘ + A', 'Select all annotations on current page'],
  ['Delete / Backspace', 'Delete selected'],
  ['Esc', 'Deselect / cancel current tool'],
  ['+ / =', 'Zoom in'],
  ['-', 'Zoom out'],
  ['0', 'Reset zoom'],
  ['1', 'Fit page'],
  ['2', 'Fit width'],
  ['Page Up / Page Down', 'Navigate pages'],
  ['Home / End', 'First / last page'],
  ['V', 'Select tool'],
  ['H', 'Pan tool'],
  ['T', 'Text annotation'],
  ['Y', 'Highlight'],
  ['R', 'Rectangle'],
  ['E', 'Ellipse'],
  ['L', 'Line'],
  ['A', 'Arrow'],
  ['P', 'Free-hand pen'],
  ['N', 'Sticky note'],
  ['?', 'Show this dialog'],
];

export default function KeyboardShortcutsDialog({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141414] border border-[#222] rounded-[2px] p-4 max-w-[600px] w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white inline-flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-[#d4a017]" /> Keyboard shortcuts
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px]">
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-rmpg-700/30 rounded-sm">
              <kbd className="bg-[#0a0a0a] border border-[#222] text-rmpg-200 px-1.5 py-0.5 rounded-sm font-mono text-[10px]">{key}</kbd>
              <span className="text-rmpg-400 text-right">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
