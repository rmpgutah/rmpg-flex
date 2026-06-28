import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTrapWatchdog,
  findBlockingOverlays,
  recoverIfTrapped,
  attemptTrapRecovery,
  type TrapWatchdogDeps,
} from '../uiTrapDiagnostic';

// ────────────────────────────────────────────────────────────
// Pure watchdog decision logic (no DOM, injected clock + timers)
// ────────────────────────────────────────────────────────────
describe('createTrapWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(over: Partial<TrapWatchdogDeps> = {}) {
    let clock = 0;
    const recoverIfTrappedFn = vi.fn<() => string[]>(() => []);
    const onRecovered = vi.fn();
    const wd = createTrapWatchdog({
      recoverIfTrapped: recoverIfTrappedFn,
      onRecovered,
      setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
      clearTimer: (h) => clearTimeout(h),
      now: () => clock,
      delayMs: 1500,
      throttleMs: 5000,
      ...over,
    });
    return { wd, recoverIfTrappedFn, onRecovered, setClock: (n: number) => { clock = n; } };
  }

  it('does nothing until the grace delay elapses', () => {
    const { wd, recoverIfTrappedFn } = setup();
    recoverIfTrappedFn.mockReturnValue(['neutralized fixed overlay z=50']);
    wd.notifyPotentialTrap();
    vi.advanceTimersByTime(1499);
    expect(recoverIfTrappedFn).not.toHaveBeenCalled(); // teardown still has a chance to win
    vi.advanceTimersByTime(1);
    expect(recoverIfTrappedFn).toHaveBeenCalledTimes(1);
  });

  it('recovers and notifies only when a trap is actually found', () => {
    const { wd, recoverIfTrappedFn, onRecovered } = setup();
    recoverIfTrappedFn.mockReturnValue(['neutralized fixed overlay z=50 backdrop']);
    wd.notifyPotentialTrap();
    vi.advanceTimersByTime(1500);
    expect(onRecovered).toHaveBeenCalledWith(['neutralized fixed overlay z=50 backdrop']);
  });

  it('stays silent when no overlay is trapped (routine API error)', () => {
    const { wd, recoverIfTrappedFn, onRecovered } = setup();
    recoverIfTrappedFn.mockReturnValue([]); // nothing stuck
    wd.notifyPotentialTrap();
    vi.advanceTimersByTime(1500);
    expect(recoverIfTrappedFn).toHaveBeenCalledTimes(1);
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it('coalesces a burst of rejections into a single check', () => {
    const { wd, recoverIfTrappedFn } = setup();
    recoverIfTrappedFn.mockReturnValue([]);
    wd.notifyPotentialTrap();
    wd.notifyPotentialTrap();
    wd.notifyPotentialTrap();
    vi.advanceTimersByTime(1500);
    expect(recoverIfTrappedFn).toHaveBeenCalledTimes(1);
  });

  it('throttles a second recovery within the throttle window', () => {
    const { wd, recoverIfTrappedFn, onRecovered, setClock } = setup();
    recoverIfTrappedFn.mockReturnValue(['neutralized fixed overlay z=99']);

    setClock(0);
    wd.notifyPotentialTrap();
    vi.advanceTimersByTime(1500);
    expect(onRecovered).toHaveBeenCalledTimes(1); // first recovery at t=0

    setClock(3000); // < 5000ms throttle since last recovery
    wd.notifyPotentialTrap();
    vi.advanceTimersByTime(1500);
    expect(onRecovered).toHaveBeenCalledTimes(1); // suppressed

    setClock(9000); // now past the throttle window
    wd.notifyPotentialTrap();
    vi.advanceTimersByTime(1500);
    expect(onRecovered).toHaveBeenCalledTimes(2); // allowed again
  });

  it('dispose() cancels a pending check', () => {
    const { wd, recoverIfTrappedFn } = setup();
    recoverIfTrappedFn.mockReturnValue(['neutralized x']);
    wd.notifyPotentialTrap();
    wd.dispose();
    vi.advanceTimersByTime(5000);
    expect(recoverIfTrappedFn).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────
// DOM predicate — jsdom can't compute Tailwind layout, so we set
// inline styles + stub getBoundingClientRect to simulate geometry.
// ────────────────────────────────────────────────────────────
describe('findBlockingOverlays / recoverIfTrapped (DOM)', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (window as unknown as { innerWidth: number }).innerWidth = 1000;
    (window as unknown as { innerHeight: number }).innerHeight = 800;
    document.body.replaceChildren();
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    // Every element reports a full-viewport box; the predicate then discriminates
    // on position/semantics, not on size.
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => rectSpy.mockRestore());

  function fixedDiv(attrs: Record<string, string> = {}): HTMLDivElement {
    const d = document.createElement('div');
    d.style.position = 'fixed';
    for (const [k, v] of Object.entries(attrs)) d.setAttribute(k, v);
    document.body.appendChild(d);
    return d;
  }

  it('flags an orphaned full-screen fixed overlay with no dialog semantics', () => {
    fixedDiv();
    expect(findBlockingOverlays()).toHaveLength(1);
  });

  it('ignores a legitimate dialog (aria-modal / role=dialog / aria-label)', () => {
    fixedDiv({ 'aria-modal': 'true' });
    fixedDiv({ role: 'dialog' });
    fixedDiv({ 'aria-label': 'Photo viewer' });
    expect(findBlockingOverlays()).toHaveLength(0);
  });

  it('ignores the app shell root', () => {
    fixedDiv({ id: 'root' });
    expect(findBlockingOverlays()).toHaveLength(0);
  });

  it('ignores a backdrop that hosts a real dialog', () => {
    const backdrop = fixedDiv();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    backdrop.appendChild(dialog);
    expect(findBlockingOverlays()).toHaveLength(0);
  });

  it('recoverIfTrapped neutralizes the orphan and reports the action', () => {
    const orphan = fixedDiv();
    const actions = recoverIfTrapped();
    expect(actions.some((a) => a.startsWith('neutralized'))).toBe(true);
    expect(orphan.style.pointerEvents).toBe('none'); // non-destructive un-trap
  });

  it('recoverIfTrapped is a no-op when nothing is trapped (zero DOM mutation)', () => {
    document.body.style.overflow = 'hidden'; // a lock exists, but no overlay trap
    const actions = recoverIfTrapped();
    expect(actions).toEqual([]);
    expect(document.body.style.overflow).toBe('hidden'); // untouched — not our trap to clear
  });

  it('attemptTrapRecovery (manual path) also releases a standalone overflow lock', () => {
    document.body.style.overflow = 'hidden';
    const actions = attemptTrapRecovery();
    expect(actions.some((a) => a.startsWith('reset'))).toBe(true);
    expect(document.body.style.overflow).toBe('');
  });
});
