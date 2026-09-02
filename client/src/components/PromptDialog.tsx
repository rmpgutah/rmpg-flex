import { useEffect, useId, useState, type HTMLAttributes } from 'react';
import ConfirmDialog from './ConfirmDialog';

export interface PromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  message: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** When true, Confirm stays enabled on a blank value (word-goal clear, etc.). */
  allowEmpty?: boolean;
  inputType?: 'text' | 'number';
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
}

/** Themed text prompt wrapping ConfirmDialog — replaces native window.prompt(). */
export default function PromptDialog({
  isOpen,
  onClose,
  onSubmit,
  title,
  message,
  label,
  defaultValue = '',
  placeholder,
  confirmLabel = 'OK',
  allowEmpty = false,
  inputType = 'text',
  inputMode,
}: PromptDialogProps) {
  const inputId = useId();
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) setValue(defaultValue);
  }, [isOpen, defaultValue]);

  const trimmed = value.trim();
  const canSubmit = allowEmpty || trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(allowEmpty ? value : trimmed);
  };

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={submit}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      confirmVariant="default"
      confirmDisabled={!canSubmit}
      details={
        <div className="mt-1">
          <label htmlFor={inputId} className="block text-[9px] uppercase tracking-wider text-fg-muted mb-1">
            {label}
          </label>
          <input
            id={inputId}
            autoFocus
            type={inputType}
            inputMode={inputMode}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) {
                e.preventDefault();
                submit();
              }
            }}
            className="input-dark text-[12px] w-full"
            placeholder={placeholder}
          />
        </div>
      }
    />
  );
}
