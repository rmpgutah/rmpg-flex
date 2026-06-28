// Wrap-around index stepper for keyboard nav. len 0 → -1 (nothing selectable).
export function stepIndex(cur: number, delta: number, len: number): number {
  if (len <= 0) return -1;
  return ((cur + delta) % len + len) % len;
}
