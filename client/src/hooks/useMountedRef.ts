import { useEffect, useRef, type MutableRefObject } from 'react';

// A mounted flag that survives React 18 StrictMode's dev-only
// mount → cleanup → mount cycle. The hand-rolled
// `const r = useRef(true); useEffect(() => () => { r.current = false; }, [])`
// pattern only ever flips the flag off, so after StrictMode's simulated
// unmount every `if (!mountedRef.current) return` guard dropped its fetch
// result and pages sat on "Loading…" with no data in dev.
export function useMountedRef(): MutableRefObject<boolean> {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => { ref.current = false; };
  }, []);
  return ref;
}

export default useMountedRef;
