export function interpolateAlongRange(
  houseNumber: number,
  fromAddr: number,
  toAddr: number,
): number {
  if (fromAddr === toAddr) return 0;
  const lo = Math.min(fromAddr, toAddr);
  const hi = Math.max(fromAddr, toAddr);
  if (houseNumber <= lo) return fromAddr <= toAddr ? 0 : 1;
  if (houseNumber >= hi) return fromAddr <= toAddr ? 1 : 0;
  const fraction = (houseNumber - fromAddr) / (toAddr - fromAddr);
  return fraction;
}

export function parityMatches(
  houseNumber: number,
  parity: string | null,
): boolean {
  if (parity == null || parity === 'B') return true;
  const isOdd = houseNumber % 2 !== 0;
  if (parity === 'O') return isOdd;
  if (parity === 'E') return !isOdd;
  return true;
}

export function normalizeStreetName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
