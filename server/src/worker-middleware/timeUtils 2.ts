// ============================================================
// RMPG Flex — Workers Time Utils
// ============================================================
// Mirrors server/src/utils/timeUtils.ts for Hono/Workers.
// ============================================================

export function localNow(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }));
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const offsetMin = d.getTimezoneOffset();
  const sign = offsetMin <= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMin);
  const tzH = pad(Math.floor(absOffset / 60));
  const tzM = pad(absOffset % 60);
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${tzH}:${tzM}`;
}

export function localToday(): string {
  const now = new Date();
  const mt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  return `${mt.getFullYear()}-${String(mt.getMonth() + 1).padStart(2, '0')}-${String(mt.getDate()).padStart(2, '0')}`;
}
