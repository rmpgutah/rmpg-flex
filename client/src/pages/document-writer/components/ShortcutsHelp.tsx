import { X, Keyboard } from 'lucide-react';

interface Props {
  onClose: () => void;
}

interface Shortcut { keys: string; desc: string }
interface Group { title: string; items: Shortcut[] }

// Mirrors the bindings handled in DocumentWriterPage's keydown effect plus the
// stock TipTap/StarterKit shortcuts so officers have one reference. Mac users
// substitute ⌘ for Ctrl.
const GROUPS: Group[] = [
  {
    title: 'File & document',
    items: [
      { keys: 'Ctrl + S', desc: 'Save to Documents' },
      { keys: 'Ctrl + Shift + S', desc: 'Save draft now (local)' },
      { keys: 'Ctrl + P', desc: 'Print / export PDF' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: 'Ctrl + Z', desc: 'Undo' },
      { keys: 'Ctrl + Y', desc: 'Redo' },
      { keys: 'Ctrl + A', desc: 'Select all' },
      { keys: 'Ctrl + F', desc: 'Find' },
      { keys: 'Ctrl + H', desc: 'Find & replace' },
      { keys: 'Ctrl + Shift + V', desc: 'Paste without formatting' },
    ],
  },
  {
    title: 'Formatting',
    items: [
      { keys: 'Ctrl + B', desc: 'Bold' },
      { keys: 'Ctrl + I', desc: 'Italic' },
      { keys: 'Ctrl + U', desc: 'Underline' },
      { keys: 'Ctrl + K', desc: 'Insert link' },
      { keys: 'Ctrl + 1 / 2 / 3', desc: 'Heading 1 / 2 / 3' },
      { keys: 'Ctrl + Shift + 7', desc: 'Numbered list' },
      { keys: 'Ctrl + Shift + 8', desc: 'Bullet list' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: 'Ctrl + =', desc: 'Zoom in' },
      { keys: 'Ctrl + -', desc: 'Zoom out' },
      { keys: 'Ctrl + 0', desc: 'Reset zoom (100%)' },
      { keys: 'Esc', desc: 'Exit focus / reading / full screen' },
      { keys: '?', desc: 'Toggle this shortcut sheet' },
    ],
  },
];

function Key({ combo }: { combo: string }) {
  return (
    <span className="flex items-center gap-0.5">
      {combo.split(' + ').map((k, i, arr) => (
        <span key={k} className="flex items-center gap-0.5">
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-[#141414] border border-[#2e2e2e] text-rmpg-200 rounded-[2px] min-w-[18px] text-center">{k}</kbd>
          {i < arr.length - 1 && <span className="text-rmpg-600 text-[9px]">+</span>}
        </span>
      ))}
    </span>
  );
}

export default function ShortcutsHelp({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] overflow-auto bg-[#0a0a0a] border border-[#222] rounded-[2px] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a1a1a] sticky top-0 bg-[#0a0a0a]">
          <span className="flex items-center gap-2 font-semibold text-rmpg-100 uppercase tracking-wider text-[11px]">
            <Keyboard className="w-3.5 h-3.5 text-[#d4a017]" /> Keyboard Shortcuts
          </span>
          <button type="button" onClick={onClose} aria-label="Close shortcuts" className="text-rmpg-500 hover:text-rmpg-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 p-4">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4 className="text-[9px] uppercase tracking-wider text-[#d4a017] mb-1.5">{g.title}</h4>
              <div className="space-y-1">
                {g.items.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-rmpg-300">{s.desc}</span>
                    <Key combo={s.keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-[#1a1a1a] text-[9px] text-rmpg-600">
          On macOS, use ⌘ in place of Ctrl. Press <kbd className="px-1 py-0.5 bg-[#141414] border border-[#2e2e2e] rounded-[2px]">?</kbd> any time to reopen this sheet.
        </div>
      </div>
    </div>
  );
}
