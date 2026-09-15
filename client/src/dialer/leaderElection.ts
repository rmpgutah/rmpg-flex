// A popped-out softphone window must be the ONLY registered Twilio client for
// the dispatcher (two registrations ring twice / steal each other's calls).
// The pop-out claims leadership on open; every other window destroys its
// Device and goes passive until the pop-out releases.
const CHANNEL = 'rmpg-dialer';
type Msg = { type: 'claim'; id: string } | { type: 'release'; id: string };

export function createLeaderElection(opts: {
  isPopout: boolean;
  onBecomeFollower(): void;
  onBecomeLeader(): void;
}): { close(): void } {
  if (typeof BroadcastChannel === 'undefined') return { close() {} };
  const id = Math.random().toString(36).slice(2);
  const ch = new BroadcastChannel(CHANNEL);
  let demotedBy: string | null = null;
  ch.onmessage = (ev: MessageEvent<Msg>) => {
    const m = ev.data;
    if (m.type === 'claim' && !opts.isPopout) { demotedBy = m.id; opts.onBecomeFollower(); }
    if (m.type === 'release' && demotedBy === m.id) { demotedBy = null; opts.onBecomeLeader(); }
  };
  if (opts.isPopout) ch.postMessage({ type: 'claim', id } satisfies Msg);
  const release = () => { if (opts.isPopout) ch.postMessage({ type: 'release', id } satisfies Msg); };
  if (opts.isPopout && typeof window !== 'undefined') window.addEventListener('pagehide', release);
  return {
    close() {
      release();
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', release);
      ch.close();
    },
  };
}

export function isPopoutWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('popout') === '1';
}
