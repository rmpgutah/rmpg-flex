import { useState } from 'react';
import type { CommitKind } from './PdfReviewModal';

interface Props {
  allowedActions: CommitKind[];
  onSelect: (action: CommitKind) => void;
}

const LABELS: Record<CommitKind, string> = {
  download: 'Download to my computer',
  print:    'Print',
  attach:   'Attach to record',
  email:    'Email',
};

export function CommitDropdown({ allowedActions, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const primary = allowedActions[0] ?? 'download';

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => onSelect(primary)}
        className="px-3 py-1 bg-[#d4a017] text-black font-bold border-r border-black/30"
      >
        Commit: {LABELS[primary]}
      </button>
      <button
        type="button"
        aria-label="More commit options"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 bg-[#d4a017] text-black font-bold"
      >
        ▼
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 bg-[#141414] border border-[#2e2e2e] min-w-[220px] z-10">
          {allowedActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => { setOpen(false); onSelect(action); }}
              className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-[#1f1f1f]"
            >
              {LABELS[action]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
