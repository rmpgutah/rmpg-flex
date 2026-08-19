// Step 4 — Statements
//
// Renders the variant-appropriate attestations as a numbered plain-English
// list. No per-item checkboxes — one single "I confirm all of the above"
// checkbox at the bottom blocks Continue until checked.

import { Check } from 'lucide-react';
import { type Attestation } from '../../../utils/serveReceiptVariant';

export interface Step4Props {
  attestations: Attestation[];
  formTitle: string;
  allConfirmed: boolean;
  setAllConfirmed: (v: boolean) => void;
}

export default function Step4Statements({
  attestations,
  formTitle,
  allConfirmed,
  setAllConfirmed,
}: Step4Props) {
  return (
    <div className="p-4 pb-6 max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Statements</h2>
        <p className="text-[13px] text-gray-500 leading-snug">{formTitle}</p>
      </div>

      {/* Numbered attestation list */}
      <ol className="space-y-3">
        {attestations.map((a, i) => (
          <li key={a.id} className="flex gap-3">
            <span className="shrink-0 mt-0.5 w-6 h-6 rounded-sm bg-blue-900 border border-blue-700 flex items-center justify-center text-[12px] font-bold text-blue-400 tabular-nums">
              {i + 1}
            </span>
            <p className="text-[14px] text-gray-200 leading-relaxed flex-1">
              {a.text}
              {a.required && <span className="text-red-500 ml-0.5" aria-hidden>*</span>}
            </p>
          </li>
        ))}
      </ol>

      {/* Single confirm checkbox */}
      <div className="border-t border-gray-700 pt-4">
        <button
          type="button"
          onClick={() => setAllConfirmed(!allConfirmed)}
          aria-pressed={allConfirmed}
          className={`w-full flex items-start gap-3 text-left p-4 rounded-sm bg-gray-50 border-2 active:opacity-80 ${allConfirmed ? 'border-rmpg-600' : 'border-gray-200'}`}
        >
          <span
            className={`mt-0.5 shrink-0 w-6 h-6 rounded-sm border-2 flex items-center justify-center transition-colors ${
              allConfirmed ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
            }`}
            aria-hidden
          >
            {allConfirmed && <Check size={15} className="text-white" />}
          </span>
          <span className="text-[14px] leading-relaxed text-gray-200 font-medium">
            I have read all the statements above and confirm they are true.
          </span>
        </button>
        <p className="mt-2 text-[11px] text-gray-400 leading-snug">
          Statements marked <span className="text-red-500">*</span> are legally required.
        </p>
      </div>
    </div>
  );
}
