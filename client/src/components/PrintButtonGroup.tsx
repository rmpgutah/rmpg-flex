/**
 * PrintButtonGroup — dual-target print/preview UI for office vs. mobile.
 *
 * RMPG Flex prints to two distinct printer surfaces:
 *   • Office laser/inkjet (letter paper, full margins)
 *   • Brother PJ-700/800 mobile thermal (continuous-roll, ~6mm leading-edge
 *     dead zone — needs PDFs with a top safe-zone offset).
 *
 * The component renders 1-4 buttons depending on which handlers are
 * provided. The recommended preview-first flow:
 *
 *   <PrintButtonGroup onPreview={(t) => setPreviewTarget(t)} />
 *
 * which renders two buttons (📄 Office Preview, 📱 Mobile Preview). The
 * caller mounts <PdfPreviewModal> when previewTarget is set; the modal
 * handles Download / Print / Close. Preview-first saves paper when the
 * record has a typo or wrong officer — the officer catches it before
 * pressing Print, not after.
 *
 * Direct-print mode is still supported for surfaces where preview is
 * overkill (e.g., bulk batch print of citations):
 *
 *   <PrintButtonGroup onPrint={(t) => downloadRecordPdf('citation', d, id, { printTarget: t })} />
 *
 * Pass BOTH onPreview and onPrint to render four buttons (preview pair
 * on the left, print pair on the right). Two visible buttons per row
 * beats a hidden setting in CAD context — a wrong-choice tap is
 * recoverable in seconds, while a settings hunt is not.
 */

import React from 'react';
import { Printer, Smartphone, Eye } from 'lucide-react';
import type { PrintTarget } from '../utils/pdfTokens';

export interface PrintButtonGroupProps {
  /**
   * Preview-first handler. When provided, renders Office/Mobile preview
   * buttons. The caller is expected to render <PdfPreviewModal> when the
   * target becomes non-null and clear it on close.
   */
  onPreview?: (target: PrintTarget) => void;
  /**
   * Direct-print handler. When provided, renders Office/Mobile print
   * buttons that immediately invoke the generator and trigger download.
   */
  onPrint?: (target: PrintTarget) => void | Promise<void>;
  /** Disable all buttons (e.g., while a generation is in flight). */
  disabled?: boolean;
  /** Optional className applied to the outer wrapper. */
  className?: string;
  /** Show only one target. Useful where mobile or office is irrelevant. */
  only?: PrintTarget;
  /** Override default labels. */
  officeLabel?: string;
  mobileLabel?: string;
  /** Compact size (icon-only when true). */
  compact?: boolean;
}

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ' +
  'border transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_DEFAULT = 'bg-[#141414] hover:bg-[#1a1a1a] border-[#2e2e2e] text-[#d4a017]';
const BTN_PRIMARY = 'bg-[#d4a017] hover:bg-[#b8881a] border-[#d4a017] text-black';

export default function PrintButtonGroup({
  onPreview,
  onPrint,
  disabled = false,
  className = '',
  only,
  officeLabel = 'Office',
  mobileLabel = 'Mobile',
  compact = false,
}: PrintButtonGroupProps) {
  // Default behavior when nothing is provided: nothing to render. This
  // catches misconfiguration loudly during dev rather than silently.
  if (!onPreview && !onPrint) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('PrintButtonGroup: pass onPreview or onPrint (or both).');
    }
    return null;
  }

  const showOffice = only !== 'mobile';
  const showMobile = only !== 'office';

  // When BOTH handlers are provided, preview pair is the default action
  // (more common, safer). Print pair becomes the primary "go directly to
  // printer" action — slightly visually deemphasized via the gold filled
  // style on print to draw the eye toward the destructive action.
  const renderBtn = (
    target: PrintTarget,
    action: 'preview' | 'print',
    label: string,
    Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>,
  ) => {
    const isPrint = action === 'print';
    const handler = isPrint ? onPrint : onPreview;
    if (!handler) return null;
    const fullLabel = isPrint ? `${label} Print` : `${label} Preview`;
    const titleHint =
      target === 'mobile'
        ? '(Brother PJ thermal printer, in-vehicle)'
        : '(laser/inkjet, letter paper)';
    return (
      <button
        key={`${action}-${target}`}
        type="button"
        onClick={() => handler(target)}
        disabled={disabled}
        aria-label={fullLabel}
        title={`${fullLabel} ${titleHint}`}
        className={`${BTN_BASE} ${isPrint && !onPreview ? BTN_PRIMARY : BTN_DEFAULT}`}
      >
        {isPrint ? (
          <Icon className="w-3.5 h-3.5" aria-hidden={true} />
        ) : (
          <span className="inline-flex items-center gap-1">
            <Eye className="w-3.5 h-3.5" aria-hidden={true} />
            <Icon className="w-3.5 h-3.5" aria-hidden={true} />
          </span>
        )}
        {!compact && <span>{fullLabel}</span>}
      </button>
    );
  };

  return (
    <div className={`inline-flex flex-wrap gap-2 ${className}`}>
      {/* Preview pair (when onPreview provided) */}
      {onPreview && showOffice && renderBtn('office', 'preview', officeLabel, Printer)}
      {onPreview && showMobile && renderBtn('mobile', 'preview', mobileLabel, Smartphone)}
      {/* Print pair (when onPrint provided) */}
      {onPrint && showOffice && renderBtn('office', 'print', officeLabel, Printer)}
      {onPrint && showMobile && renderBtn('mobile', 'print', mobileLabel, Smartphone)}
    </div>
  );
}
