const PLACEHOLDER_VALUES = new Set([
  '',
  '0',
  'none',
  'n/a',
  'na',
  'null',
  'undefined',
]);

export function getMeaningfulPersonStatus(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return PLACEHOLDER_VALUES.has(trimmed.toLowerCase()) ? undefined : trimmed;
}

export function hasMeaningfulPersonStatus(value: unknown): boolean {
  return getMeaningfulPersonStatus(value) !== undefined;
}

export function isPreTrialSupervisionStatus(value: unknown): boolean {
  const normalized = getMeaningfulPersonStatus(value);
  return normalized ? normalized.toLowerCase().includes('pre-trial') : false;
}
