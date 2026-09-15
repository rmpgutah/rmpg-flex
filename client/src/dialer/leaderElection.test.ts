import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLeaderElection } from './leaderElection';

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(public name: string) { FakeChannel.all.push(this); }
  postMessage(data: unknown) { for (const c of FakeChannel.all) if (c !== this) c.onmessage?.({ data } as MessageEvent); }
  close() { FakeChannel.all = FakeChannel.all.filter((c) => c !== this); }
}
beforeEach(() => { FakeChannel.all = []; vi.stubGlobal('BroadcastChannel', FakeChannel); });
afterEach(() => vi.unstubAllGlobals());

describe('leader election', () => {
  test('a pop-out claims leadership and the opener becomes a follower; release hands it back', () => {
    const openerFollower = vi.fn(); const openerLeader = vi.fn();
    const opener = createLeaderElection({ isPopout: false, onBecomeFollower: openerFollower, onBecomeLeader: openerLeader });
    const popout = createLeaderElection({ isPopout: true, onBecomeFollower: vi.fn(), onBecomeLeader: vi.fn() });
    expect(openerFollower).toHaveBeenCalledTimes(1);
    popout.close();
    expect(openerLeader).toHaveBeenCalledTimes(1);
    opener.close();
  });

  test('a plain tab does not demote other plain tabs', () => {
    const f1 = vi.fn(); const f2 = vi.fn();
    const a = createLeaderElection({ isPopout: false, onBecomeFollower: f1, onBecomeLeader: vi.fn() });
    const b = createLeaderElection({ isPopout: false, onBecomeFollower: f2, onBecomeLeader: vi.fn() });
    expect(f1).not.toHaveBeenCalled(); expect(f2).not.toHaveBeenCalled();
    a.close(); b.close();
  });
});
