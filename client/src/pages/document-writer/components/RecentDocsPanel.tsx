import { X, FileStack, Trash2 } from 'lucide-react';
import { listRecentDocs, removeRecentDoc, type RecentDoc } from '../docTools';

interface Props {
  onClose: () => void;
  /** Load a recent document's content + title back into the editor. */
  onOpen: (doc: RecentDoc) => void;
  /** Trigger a re-render after a delete (parent owns no list state). */
  onChange?: () => void;
}

export default function RecentDocsPanel({ onClose, onOpen, onChange }: Props) {
  const docs = listRecentDocs();
  return (
    <div className="w-[300px] flex-shrink-0 bg-[#0a0a0a] border border-[#222] rounded-[2px] flex flex-col text-rmpg-200 text-xs">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a]">
        <span className="flex items-center gap-1.5 font-semibold text-rmpg-100 uppercase tracking-wider text-[10px]">
          <FileStack className="w-3.5 h-3.5 text-[#d4a017]" /> Recent Documents
        </span>
        <button type="button" onClick={onClose} aria-label="Close recent documents" className="text-rmpg-500 hover:text-rmpg-100">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {docs.length === 0 && (
          <p className="text-[10px] text-rmpg-500 px-1 py-2">No recent documents yet. They appear here as you open and edit documents on this device.</p>
        )}
        {docs.map((d) => (
          <div key={d.id} className="group flex items-center gap-1 p-2 bg-[#0d0d0d] border border-[#222] rounded-[2px] hover:border-[#d4a017]/40">
            <button type="button" onClick={() => onOpen(d)} className="flex-1 text-left min-w-0">
              <div className="text-[11px] text-rmpg-200 truncate">{d.title || 'Untitled'}</div>
              <div className="text-[9px] text-rmpg-600">
                {new Date(d.openedAt).toLocaleString()}{d.documentId ? ' · saved' : ' · draft'}
              </div>
            </button>
            <button type="button" aria-label={`Remove ${d.title} from recent`} title="Remove from recent"
              onClick={() => { removeRecentDoc(d.id); onChange?.(); }}
              className="text-rmpg-600 hover:text-red-400 px-1 opacity-0 group-hover:opacity-100">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
