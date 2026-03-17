import { useState, useEffect, useRef } from 'react';

/**
 * Animated count-up hook — smoothly animates a number from 0 to the target value.
 * Uses requestAnimationFrame for 60fps smooth animation.
 */
export function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const start = prevTarget.current;
    const diff = target - start;
    if (diff === 0) return;

    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + diff * eased);
      setValue(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        prevTarget.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return value;
}
