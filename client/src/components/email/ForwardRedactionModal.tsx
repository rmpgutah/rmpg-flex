// Shown when the server (/api/email/messages/:id/forward) returns 409 because
// the forward includes an external recipient AND PII was detected in the body.
// The officer reviews the redacted body, optionally edits it, then confirms.

import { useEffect, useState } from 'react';

export interface RedactionDiffItem {
  original: string;
  replacement: string;
  type: string;
  index: number;
}

export interface RedactionPreview {
  redacted: string;
  diff: RedactionDiffItem[];
}

interface Props {
  open: boolean;
  preview: RedactionPreview | null;
  onConfirm: (body: string) => void;
  onCancel: () => void;
}

export default function ForwardRedactionModal({ open, preview, onConfirm, onCancel }: Props) {
  const [edited, setEdited] = useState('');

  // Reset the textarea whenever the modal re-opens with fresh preview content.
  useEffect(() => {
    if (preview) setEdited(preview.redacted);
  }, [preview]);

  if (!open || !preview) return null;

  const uniqueTypes = [...new Set(preview.diff.map(d => d.type))];

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-[#d4a017] max-w-2xl w-full p-4 space-y-3">
        <div className="text-[#d4a017] text-sm font-semibold">
          EXTERNAL FORWARD — REVIEW REDACTIONS
        </div>
        <div className="text-xs text-gray-400">
          {preview.diff.length} item(s) flagged: <span className="font-mono text-[#d4a017]">{uniqueTypes.join(', ')}</span>
        </div>
        <div className="text-[11px] text-gray-500">
          The body below has been auto-redacted. Edit if needed, then confirm.
          The audit log records that you reviewed the redaction.
        </div>
        <textarea
          value={edited}
          onChange={e => setEdited(e.target.value)}
          className="w-full h-64 bg-black text-white font-mono text-xs p-2 border border-[#222]"
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1 border border-[#222] text-xs text-gray-300"
          >
            CANCEL
          </button>
          <button
            onClick={() => onConfirm(edited)}
            className="px-3 py-1 border border-[#d4a017] text-[#d4a017] text-xs"
          >
            CONFIRM &amp; SEND
          </button>
        </div>
      </div>
    </div>
  );
}
