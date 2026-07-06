import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lockBodyScroll, unlockBodyScroll, releaseAllLocks, hasActiveLock, getLockCount } from './bodyScrollLock';

describe('bodyScrollLock', () => {
  beforeEach(() => {
    releaseAllLocks();
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    window.scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  });

  it('locks overflow and pins position on the first lock', () => {
    lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');
    expect(hasActiveLock()).toBe(true);
  });

  it('restores overflow/position and scrolls back on the matching unlock', () => {
    Object.defineProperty(window, 'scrollY', { value: 240, writable: true, configurable: true });
    lockBodyScroll();
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 240);
  });

  it('stays locked while a second (nested) lock is still held', () => {
    lockBodyScroll(); // outer modal
    lockBodyScroll(); // inner modal opened from within the outer one
    unlockBodyScroll(); // inner modal closes
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');
    expect(getLockCount()).toBe(1);
    unlockBodyScroll(); // outer modal closes
    expect(document.body.style.overflow).toBe('');
    expect(getLockCount()).toBe(0);
  });

  it('does not re-capture scroll position for a nested lock opened while already pinned', () => {
    Object.defineProperty(window, 'scrollY', { value: 500, writable: true, configurable: true });
    lockBodyScroll(); // captures 500
    // Simulate the body already being pinned (scrollY reads ~0 while fixed),
    // which is exactly what corrupted the old per-component implementation.
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    lockBodyScroll(); // nested lock — must NOT overwrite the captured 500
    unlockBodyScroll();
    unlockBodyScroll();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 500);
  });

  it('never goes negative on an unpaired unlock', () => {
    unlockBodyScroll();
    unlockBodyScroll();
    expect(getLockCount()).toBe(0);
    lockBodyScroll();
    expect(getLockCount()).toBe(1);
  });

  it('releaseAllLocks resets everything regardless of nesting depth', () => {
    lockBodyScroll();
    lockBodyScroll();
    lockBodyScroll();
    releaseAllLocks();
    expect(getLockCount()).toBe(0);
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });
});
