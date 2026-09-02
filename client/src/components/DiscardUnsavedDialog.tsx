import ConfirmDialog from './ConfirmDialog';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message?: string;
}

/** Shared discard-unsaved ConfirmDialog used by fleet/HR form chrome. */
export default function DiscardUnsavedDialog({
  isOpen,
  onClose,
  onConfirm,
  message = 'You have unsaved changes. Discard them?',
}: Props) {
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Discard unsaved changes"
      message={message}
      confirmLabel="Discard"
      confirmVariant="warning"
    />
  );
}
