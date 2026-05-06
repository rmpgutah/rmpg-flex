/**
 * PrintButtonGroup — dual-button print UI for office vs. mobile printers.
 *
 * RMPG Flex prints to two distinct printer surfaces:
 *   • Office laser/inkjet (letter paper, full margins)
 *   • Brother PJ-700/800 mobile thermal (continuous-roll, ~6mm leading-edge
 *     dead zone — needs PDFs with a top safe-zone offset).
 *
 * Rather than a single "Print" button + a hidden preference toggle, we
 * surface two clearly-labeled buttons. In a CAD context an officer under
 * stress can't miss them, and a wrong choice is recoverable in seconds
 * (re-tap the other button) — no preference page to find.
 *
 * Usage:
 *   <PrintButtonGroup
 *     onPrint={(target) => downloadRecordPdf('citation', data, citation.id, { printTarget: target })}
 *   />
 *
 * Both handlers receive the PrintTarget; the caller passes it through to
 * the PDF generator's options. The generator tags the doc via
 * applyPrintTarget(); chrome-drawing helpers read it via topMarginY().
 */

import React from 'react';
import { Printer, Smartphone } from 'lucide-react';
import type { PrintTarget } from '../utils/pdfTokens';

export interface PrintButtonGroupProps {
  /** Called when the user picks a target. Caller does the actual generation. */
  onPrint: (target: PrintTarget) => void | Promise<void>;
  /** Disable both buttons (e.g., while a generation is in flight). */
  disabled?: boolean;
  /** Optional className applied to the outer wrapper. */
  className?: string;
  /** Show only one button. Useful where only mobile or only office makes sense. */
  only?: PrintTarget;
  /** Override default labels. */
  officeLabel?: string;
  mobileLabel?: string;
  /** Compact size (icon-only when true). */
  compact?: boolean;
}

export default function PrintButtonGroup({
  onPrint,
  disabled = false,
  className = '',
  only,
  officeLabel = 'Office Print',
  mobileLabel = 'Mobile Print',
  compact = false,
}: PrintButtonGroupProps) {
  const showOffice = only !== 'mobile';
  const showMobile = only !== 'office';

  const baseBtn =
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ' +
    'border transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className={`inline-flex gap-2 ${className}`}>
      {showOffice && (
        <button
          type="button"
          onClick={() => onPrint('office')}
          disabled={disabled}
          aria-label={officeLabel}
          title={`${officeLabel} (laser/inkjet, letter paper)`}
          className={`${baseBtn} bg-[#141414] hover:bg-[#1a1a1a] border-[#2e2e2e] text-[#d4a017]`}
        >
          <Printer className="w-3.5 h-3.5" aria-hidden="true" />
          {!compact && <span>{officeLabel}</span>}
        </button>
      )}
      {showMobile && (
        <button
          type="button"
          onClick={() => onPrint('mobile')}
          disabled={disabled}
          aria-label={mobileLabel}
          title={`${mobileLabel} (Brother PJ thermal printer, in-vehicle)`}
          className={`${baseBtn} bg-[#141414] hover:bg-[#1a1a1a] border-[#2e2e2e] text-[#d4a017]`}
        >
          <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
          {!compact && <span>{mobileLabel}</span>}
        </button>
      )}
    </div>
  );
}
