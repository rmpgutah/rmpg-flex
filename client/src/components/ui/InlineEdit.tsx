// ═══════════════════════════════════════════════════════════════
// Feature 30: Inline Editing
// Click cell to edit value directly in table
// ═══════════════════════════════════════════════════════════════
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X } from 'lucide-react';

interface InlineEditProps {
  value: string;
  onSave: (newValue: string) => Promise<void> | void;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  displayClassName?: string;
}

export default function InlineEdit({
  value,
  onSave,
  type = 'text',
  options,
  placeholder = 'Click to edit',
  className = '',
  displayClassName = '',
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ('select' in inputRef.current) {
        (inputRef.current as HTMLInputElement).select();
      }
    }
  }, [editing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleSave = useCallback(async () => {
    if (editValue === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(editValue);
      setEditing(false);
    } catch {
      setEditValue(value);
    } finally {
      setSaving(false);
    }
  }, [editValue, value, onSave]);

  const handleCancel = useCallback(() => {
    setEditValue(value);
    setEditing(false);
  }, [value]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
  }, [handleSave, handleCancel]);

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-pointer hover:bg-brand-500/10 px-1 py-0.5 rounded-sm border border-transparent hover:border-brand-500/30 transition-all ${displayClassName}`}
        title="Click to edit"
      >
        {value || <span className="text-rmpg-600 italic">{placeholder}</span>}
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {type === 'select' && options ? (
        <select
          ref={inputRef as React.Ref<HTMLSelectElement>}
          name="inline-edit-select"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="input-dark text-xs px-1.5 py-0.5 w-full"
          disabled={saving}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <input
          ref={inputRef as React.Ref<HTMLInputElement>}
          name="inline-edit"
          type={type}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="input-dark text-xs px-1.5 py-0.5 w-full"
          disabled={saving}
        />
      )}
      <button type="button" onClick={handleSave} disabled={saving} className="p-0.5 text-green-400 hover:text-green-300">
        <Check className="w-3 h-3" />
      </button>
      <button type="button" onClick={handleCancel} disabled={saving} className="p-0.5 text-red-400 hover:text-red-300" aria-label="Close" title="Close">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
