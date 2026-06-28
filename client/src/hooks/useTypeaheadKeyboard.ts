// ============================================================
// useTypeaheadKeyboard — shared keyboard-nav state for all pickers
// ============================================================
// All 11 record-pickers share the same shape: a text input above a
// dropdown of result buttons. Each picker independently tracked
// arrow-key state would be 11x duplicated logic — and none of them
// had it, which is why every picker was tab-only and required mouse
// click to select. This hook centralises keyboard navigation so a
// picker only has to:
//
//   const { activeIndex, onKeyDown, listboxProps, optionProps } =
//     useTypeaheadKeyboard({
//       open, items: filtered, onSelect: select, onClose: () => setOpen(false),
//     });
//
//   <input ... onKeyDown={onKeyDown} aria-activedescendant={...} />
//   <div {...listboxProps}>
//     {filtered.map((item, i) => (
//       <button {...optionProps(i, isSelected)} ... />
//     ))}
//   </div>
//
// Keys handled:
//   ArrowDown  — next item (wraps to first)
//   ArrowUp    — previous item (wraps to last)
//   Home       — first item
//   End        — last item
//   Enter      — select the active item (or first item if none active)
//   Esc        — close dropdown
//
// Resets active index to -1 whenever the dropdown closes or items
// change. Returns ARIA props that match the WAI-ARIA combobox pattern.

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';

export interface UseTypeaheadKeyboardArgs<T> {
  /** Whether the dropdown is currently open. */
  open: boolean;
  /** Currently visible items (post-filter). */
  items: T[];
  /** Called when the user presses Enter (or otherwise commits a selection). */
  onSelect: (item: T) => void;
  /** Called when the user presses Esc to close the dropdown. */
  onClose: () => void;
  /** Stable id prefix so each rendered option can be referenced via
   *  aria-activedescendant. Defaults to a non-colliding constant; consumers
   *  with multiple pickers on one page should pass a unique value. */
  idPrefix?: string;
}

export interface UseTypeaheadKeyboardResult {
  /** Current 'focused but not yet selected' index. -1 when no item is active. */
  activeIndex: number;
  /** Wire onto the input's onKeyDown. */
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Spread onto the dropdown container <div> — role=listbox + id. */
  listboxProps: {
    role: 'listbox';
    id: string;
  };
  /** Spread onto each result <button>. Pass (index, isSelected) where
   *  `isSelected` is true when the picker's `value` prop matches this row. */
  optionProps: (i: number, isSelected: boolean) => {
    id: string;
    role: 'option';
    'aria-selected': boolean;
    onMouseEnter: () => void;
  };
  /** Suffix to append to the input via aria-activedescendant. Null when no item is active. */
  activeDescendantId: string | null;
}

export function useTypeaheadKeyboard<T>({
  open, items, onSelect, onClose,
  idPrefix = 'typeahead-opt',
}: UseTypeaheadKeyboardArgs<T>): UseTypeaheadKeyboardResult {
  const [activeIndex, setActiveIndex] = useState(-1);

  // Reset active index whenever the dropdown closes or the items array
  // changes shape. We test by length rather than identity so callers can
  // useMemo a new array every render without triggering thrash.
  useEffect(() => {
    if (!open) { setActiveIndex(-1); return; }
    // Clamp the index when items shrink (e.g. user keeps typing and
    // narrows the result set — activeIndex 7 must not point past length 3).
    if (activeIndex >= items.length) setActiveIndex(items.length > 0 ? items.length - 1 : -1);
  }, [open, items.length, activeIndex]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      // When the dropdown is closed, keyboard nav is a no-op — every
      // caller wires onFocus={() => setOpen(true)} so the dropdown
      // opens before the user gets to press a navigation key. Setting
      // activeIndex here would just get reset by the close-handling
      // effect below; better to be honest about the dead state.
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1 >= items.length ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(items.length > 0 ? 0 : -1);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (e.key === 'Enter') {
      // Enter selects the active item; if none is active, select the first
      // result (matches Chrome's URL bar / Google search behavior — pressing
      // Enter on a fresh dropdown picks the top hit). Falls through to the
      // native form-submit when there are no results so a parent <form>
      // can still react.
      if (items.length === 0) return;
      e.preventDefault();
      const target = activeIndex >= 0 ? items[activeIndex] : items[0];
      if (target) onSelect(target);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [open, items, activeIndex, onSelect, onClose]);

  const optionId = (i: number) => `${idPrefix}-${i}`;
  const activeDescendantId = activeIndex >= 0 && activeIndex < items.length
    ? optionId(activeIndex) : null;

  return {
    activeIndex,
    onKeyDown,
    listboxProps: { role: 'listbox', id: `${idPrefix}-listbox` },
    optionProps: (i: number, isSelected: boolean) => ({
      id: optionId(i),
      role: 'option' as const,
      'aria-selected': isSelected,
      onMouseEnter: () => setActiveIndex(i),
    }),
    activeDescendantId,
  };
}
