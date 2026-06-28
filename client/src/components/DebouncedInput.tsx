// ============================================================
// RMPG Flex — DebouncedInput / DebouncedTextarea
// Maintains local state for instant keystroke response, then
// propagates to the parent after a short debounce. This prevents
// large parent components (DispatchPage, MapPage) from
// re-rendering on every character typed.
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface DebouncedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

export function DebouncedInput({ value, onChange, debounceMs = 150, ...props }: DebouncedInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLocalEdit = useRef(false);

  // Sync from parent → local (only when parent value changes externally)
  useEffect(() => {
    if (!isLocalEdit.current) {
      setLocalValue(value);
    }
    isLocalEdit.current = false;
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    isLocalEdit.current = true;
    setLocalValue(newVal);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange(newVal);
    }, debounceMs);
  }, [onChange, debounceMs]);

  // Flush on blur so data isn't lost
  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onChange(localValue);
    props.onBlur?.(e);
  }, [localValue, onChange, props.onBlur]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <input
      {...props}
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}

interface DebouncedTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

export function DebouncedTextarea({ value, onChange, debounceMs = 150, ...props }: DebouncedTextareaProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLocalEdit = useRef(false);

  useEffect(() => {
    if (!isLocalEdit.current) {
      setLocalValue(value);
    }
    isLocalEdit.current = false;
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    isLocalEdit.current = true;
    setLocalValue(newVal);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange(newVal);
    }, debounceMs);
  }, [onChange, debounceMs]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onChange(localValue);
    props.onBlur?.(e);
  }, [localValue, onChange, props.onBlur]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <textarea
      {...props}
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
