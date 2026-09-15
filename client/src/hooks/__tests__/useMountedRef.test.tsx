import React, { useEffect, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useMountedRef } from '../useMountedRef';

// Mirrors the page pattern: fetch on mount, apply the result only while mounted.
function Probe() {
  const mountedRef = useMountedRef();
  const [value, setValue] = useState('pending');
  useEffect(() => {
    Promise.resolve('loaded').then((v) => { if (mountedRef.current) setValue(v); });
  }, [mountedRef]);
  return <span>{value}</span>;
}

describe('useMountedRef', () => {
  it('is still true after StrictMode mount → cleanup → mount, so async results are applied', async () => {
    render(<React.StrictMode><Probe /></React.StrictMode>);
    await waitFor(() => expect(screen.getByText('loaded')).toBeTruthy());
  });

  it('flips to false on real unmount', () => {
    let captured: { current: boolean } | null = null;
    function Capture() { captured = useMountedRef(); return null; }
    const { unmount } = render(<Capture />);
    expect(captured!.current).toBe(true);
    unmount();
    expect(captured!.current).toBe(false);
  });
});
