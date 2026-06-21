// ============================================================
// DeleteRecordModal — destructive confirmation with row identity
// ============================================================
// 14+ pages in the app used an identical inline JSX modal with the
// shape "Delete <X> Record? This permanently removes this record."
// — no name, no case number, no identifier. The 2026-06-21 audit
// flagged this as the Camden-Clark problem extended to delete
// confirmations: an operator who clicks the wrong row in a long
// table has no chance to catch it before destruction.
//
// This component wraps ConfirmDialog with a standardized layout
// that REQUIRES a recordLabel and accepts optional structured
// details. Adopting it in a page is a 1-line swap:
//
//   <DeleteRecordModal
//     isOpen={!!deleteTarget}
//     onClose={() => setDeleteTarget(null)}
//     onConfirm={handleDelete}
//     recordType="victim"
//     recordLabel={deleteTarget?.victim_name}
//     details={
//       <>
//         <div>Case {deleteTarget?.case_number} · {deleteTarget?.crime_type}</div>
//         {deleteTarget?.intake_date && <div>Intake {deleteTarget.intake_date}</div>}
//       </>
//     }
//     isDeleting={deletingState}
//   />
//
// The shared component also picks up ConfirmDialog's audit-driven
// fixes for free: Enter no longer fires from the X close button,
// focus lands on Cancel for `danger` variants, etc.

import ConfirmDialog from './ConfirmDialog';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Short type name surfaced in the title — "victim", "complaint",
   *  "case", etc. Capitalized in the rendered title. */
  recordType: string;
  /** Human-readable label of the row being deleted — name, case
   *  number, whatever uniquely identifies it to the operator. Falls
   *  back to "the selected record" so a parent's empty/null state
   *  during the close transition doesn't produce a janky string. */
  recordLabel?: string | null;
  /** Optional structured context rendered as bullet-like details:
   *  case number, dates, related entity names. Use plain React
   *  nodes (no formatting library required). */
  details?: React.ReactNode;
  isDeleting?: boolean;
  /** When the record carries evidence that destruction would
   *  break custody chain (e.g. a body-cam video locked for case
   *  evidence), set this true to disable the Delete button + show
   *  a "Locked" notice. */
  evidenceLocked?: boolean;
  evidenceLockReason?: string;
}

export default function DeleteRecordModal({
  isOpen, onClose, onConfirm,
  recordType, recordLabel,
  details, isDeleting = false,
  evidenceLocked = false,
  evidenceLockReason,
}: Props) {
  const label = recordLabel?.trim() || 'the selected record';
  const titleCased = recordType.charAt(0).toUpperCase() + recordType.slice(1);
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={evidenceLocked ? () => {} : onConfirm}
      title={`Delete ${titleCased}`}
      message={`Permanently delete ${label}? This cannot be undone.`}
      details={
        <>
          {details}
          {evidenceLocked && (
            <div className="mt-2 px-2 py-1 bg-red-900/30 border border-red-700/50 text-[11px] text-red-300">
              <span className="font-bold uppercase tracking-wider">Locked: </span>
              {evidenceLockReason || 'This record is in an active evidence chain and cannot be deleted from here.'}
            </div>
          )}
        </>
      }
      confirmLabel={evidenceLocked ? 'Locked — cannot delete' : 'Delete'}
      cancelLabel="Cancel"
      confirmVariant="danger"
      isLoading={isDeleting}
    />
  );
}
