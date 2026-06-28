// Accessibility focus management

/** Trap focus within a container element (for modals) */
export function trapFocus(container: HTMLElement): () => void {
  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable]',
  ].join(', ');

  function handler(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;

    const focusable = Array.from(
      container.querySelectorAll(focusableSelectors)
    ) as HTMLElement[];
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

/** Announce a message to screen readers */
export function announce(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): void {
  let announcer = document.getElementById('sr-announcer');
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.id = 'sr-announcer';
    announcer.setAttribute('aria-live', priority);
    announcer.setAttribute('aria-atomic', 'true');
    announcer.style.position = 'absolute';
    announcer.style.width = '1px';
    announcer.style.height = '1px';
    announcer.style.overflow = 'hidden';
    announcer.style.clip = 'rect(0, 0, 0, 0)';
    announcer.style.whiteSpace = 'nowrap';
    announcer.style.border = '0';
    document.body.appendChild(announcer);
  }

  announcer.setAttribute('aria-live', priority);
  announcer.textContent = '';
  // Small delay to ensure the change is detected by screen readers
  requestAnimationFrame(() => {
    announcer!.textContent = message;
  });
}

/** Move focus to an element by ID, scrolling it into view */
export function focusElement(id: string): boolean {
  const el = document.getElementById(id);
  if (el) {
    el.focus({ preventScroll: false });
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return true;
  }
  return false;
}

/** Skip to main content link handler */
export function skipToMain(): void {
  const main =
    document.querySelector('main') || document.getElementById('main-content');
  if (main) {
    (main as HTMLElement).tabIndex = -1;
    (main as HTMLElement).focus();
  }
}
