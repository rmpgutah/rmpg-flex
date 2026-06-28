let lockCount = 0;
let previousOverflow = '';

export function lockBodyScroll(): void {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
  }
  lockCount++;
  document.body.style.overflow = 'hidden';
}

export function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow;
  }
}

export function hasActiveLock(): boolean {
  return lockCount > 0;
}

export function releaseAllLocks(): void {
  lockCount = 0;
  document.body.style.overflow = '';
}

export function getLockCount(): number {
  return lockCount;
}
