let lockCount = 0;
let previousOverflow = '';
let previousPosition = '';
let previousWidth = '';
let previousTop = '';
let savedScrollY = 0;

// iOS Safari doesn't reliably honor `overflow: hidden` on body (background
// still bleeds through with touch scroll) — the standard workaround is also
// pinning body to `position: fixed` at the negative scroll offset, then
// restoring scrollY on unlock. That position/top/width state used to be set
// directly by each modal component (DocumentViewer, ConfirmDialog,
// NewCallModal, UserProfileModal) — when two of them were open at once
// (e.g. a confirm dialog launched from inside another open modal), both
// independently overwrote the same document.body styles with no
// coordination: the inner modal's open re-captured `window.scrollY` as ~0
// (already pinned by the outer modal) and clobbered the outer's real
// offset, and the inner modal's close reset position/top/width to '' while
// the outer modal was still supposed to hold the lock. Owning this state
// here, gated on the same reference count as `overflow`, makes it correct
// under nesting: only the FIRST lock captures scroll position/applies the
// fixed pin, and only the LAST unlock restores it.
export function lockBodyScroll(): void {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    previousPosition = document.body.style.position;
    previousWidth = document.body.style.width;
    previousTop = document.body.style.top;
    savedScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${savedScrollY}px`;
  }
  lockCount++;
  document.body.style.overflow = 'hidden';
}

export function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow;
    document.body.style.position = previousPosition;
    document.body.style.width = previousWidth;
    document.body.style.top = previousTop;
    window.scrollTo(0, savedScrollY);
  }
}

export function hasActiveLock(): boolean {
  return lockCount > 0;
}

export function releaseAllLocks(): void {
  lockCount = 0;
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.top = '';
}

export function getLockCount(): number {
  return lockCount;
}
