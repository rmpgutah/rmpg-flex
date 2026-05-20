// Keyboard shortcut registry

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description: string;
  handler: () => void;
  scope?: string;
}

const shortcuts: Shortcut[] = [];
let enabled = true;

/** Register a keyboard shortcut */
export function registerShortcut(shortcut: Shortcut): () => void {
  shortcuts.push(shortcut);
  return () => {
    const idx = shortcuts.indexOf(shortcut);
    if (idx >= 0) shortcuts.splice(idx, 1);
  };
}

/** Enable/disable all keyboard shortcuts */
export function setShortcutsEnabled(value: boolean): void {
  enabled = value;
}

/** Get all registered shortcuts (for help display) */
export function getRegisteredShortcuts(): Array<{
  key: string;
  modifiers: string;
  description: string;
  scope?: string;
}> {
  return shortcuts.map((s) => ({
    key: s.key,
    modifiers: [
      s.ctrl ? 'Ctrl' : '',
      s.shift ? 'Shift' : '',
      s.alt ? 'Alt' : '',
      s.meta ? 'Meta' : '',
    ]
      .filter(Boolean)
      .join('+'),
    description: s.description,
    scope: s.scope,
  }));
}

/** Initialize the keyboard shortcut listener */
export function initShortcuts(): () => void {
  function handler(e: KeyboardEvent) {
    if (!enabled) return;

    // Don't trigger in input fields
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    for (const s of shortcuts) {
      if (
        e.key.toLowerCase() === s.key.toLowerCase() &&
        !!e.ctrlKey === !!s.ctrl &&
        !!e.shiftKey === !!s.shift &&
        !!e.altKey === !!s.alt &&
        !!e.metaKey === !!s.meta
      ) {
        e.preventDefault();
        s.handler();
        return;
      }
    }
  }

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}
