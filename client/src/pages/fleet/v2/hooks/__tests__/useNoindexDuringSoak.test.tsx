import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useNoindexDuringSoak, V2_SOAK_ACTIVE } from '../useNoindexDuringSoak';

function HookHost() {
  useNoindexDuringSoak();
  return <div>host</div>;
}

describe('useNoindexDuringSoak', () => {
  beforeEach(() => { document.head.replaceChildren(); });
  afterEach(() => { cleanup(); document.head.replaceChildren(); });

  it('adds <meta name="robots" content="noindex"> on mount when soak is active', () => {
    if (!V2_SOAK_ACTIVE) return;
    render(<HookHost />);
    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('noindex');
  });

  it('removes the meta on unmount (idempotent)', () => {
    if (!V2_SOAK_ACTIVE) return;
    const { unmount } = render(<HookHost />);
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeNull();
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('does not duplicate the meta if mounted twice', () => {
    if (!V2_SOAK_ACTIVE) return;
    render(<HookHost />);
    render(<HookHost />);
    const metas = document.head.querySelectorAll('meta[name="robots"]');
    expect(metas.length).toBe(1);
  });
});
