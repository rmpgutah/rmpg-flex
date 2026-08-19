// Step 3 — Documents
//
// Read-only list of every document handed to the signer, with copy
// count steppers. Always valid — Continue is always enabled here.
// The footer note reminds the signer to speak up before moving on.

import { FileText, Minus, Plus } from 'lucide-react';

export interface Step3Props {
  docCopies: Record<string, number>;
  setDocCopies: (v: Record<string, number>) => void;
  /** Fallback description when no itemized document list exists. */
  documentType: string | null;
}

export default function Step3Documents({ docCopies, setDocCopies, documentType }: Step3Props) {
  const entries = Object.entries(docCopies);
  const singleDoc = entries.length === 1 && entries[0][1] === 1;

  const adjust = (title: string, delta: number) => {
    const prev = docCopies[title] ?? 1;
    setDocCopies({ ...docCopies, [title]: Math.max(1, prev + delta) });
  };

  return (
    <div className="p-4 pb-6 max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Documents received</h2>
        <p className="text-[14px] text-gray-500 leading-relaxed">
          Review the documents listed below. This is what you are confirming receipt of.
        </p>
      </div>

      <div className="space-y-2">
        {entries.length === 0 ? (
          // No itemized list — fall back to the document_type field
          <div className="flex items-center gap-3 p-3.5 rounded-sm bg-gray-50 border border-gray-200">
            <FileText size={18} className="text-gray-400 shrink-0" />
            <span className="flex-1 text-[15px] text-white">
              {documentType || 'Court documents'} — 1 set
            </span>
          </div>
        ) : (
          entries.map(([title, copies]) => (
            <div
              key={title}
              className="flex items-center gap-3 p-3.5 rounded-sm bg-gray-50 border border-gray-200"
            >
              <FileText size={18} className="text-gray-400 shrink-0" />
              <span className="flex-1 text-[15px] text-white leading-snug break-words">
                {title}
              </span>

              {/* Only show stepper when there are multiple docs or multiple copies */}
              {!singleDoc && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => adjust(title, -1)}
                    disabled={copies <= 1}
                    aria-label={`Decrease copies of ${title}`}
                    className="w-7 h-7 flex items-center justify-center rounded-sm border border-gray-600 text-gray-300 disabled:opacity-30 active:opacity-60"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-6 text-center text-[14px] font-semibold text-gray-200 tabular-nums">
                    {copies}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjust(title, 1)}
                    aria-label={`Increase copies of ${title}`}
                    className="w-7 h-7 flex items-center justify-center rounded-sm border border-gray-600 text-gray-300 active:opacity-60"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <p className="text-[13px] text-gray-400 leading-relaxed border-t border-gray-700 pt-4">
        If anything listed here was not handed to you, tell the process server before
        you continue.
      </p>
    </div>
  );
}
