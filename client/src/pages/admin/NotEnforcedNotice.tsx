import { AlertCircle } from 'lucide-react';

interface NotEnforcedNoticeProps {
  /** What this section configures, e.g. "Priority labels and colors". */
  what: string;
}

/**
 * Inline notice for a System Config section whose values are persisted but not
 * yet read by any consumer. Six sections were in this state as of 2026-07-25
 * (see docs/superpowers/specs/2026-07-25-admin-system-tab-wiring-design.md).
 * Each Phase 2/3 PR removes this notice from the section it wires — the notice
 * disappearing is the visible signal that enforcement landed.
 */
export default function NotEnforcedNotice({ what }: NotEnforcedNoticeProps) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 px-2.5 py-2 mb-3 bg-amber-950/30 border border-amber-700/40 text-[10px] text-amber-200/90"
    >
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px text-amber-400" aria-hidden="true" />
      <span>
        <span className="font-semibold">{what}</span> are saved here but{' '}
        <span className="font-semibold">not yet enforced</span> anywhere in the
        application. Changes persist and will take effect when this section is
        wired to its consumers.
      </span>
    </div>
  );
}
