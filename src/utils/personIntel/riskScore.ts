import type { RiskFlag } from './types';

const FLAG_WEIGHTS: Record<RiskFlag, number> = {
  warrant: 30,
  nsopw: 25,
  ofac: 40,
  hibp_breach: 10,
  arrest_mention: 15,
  fugitive: 35,
  court_criminal: 20,
};

export function computeRiskScore(flags: RiskFlag[]): number {
  const total = flags.reduce((sum, f) => sum + (FLAG_WEIGHTS[f] ?? 0), 0);
  return Math.min(100, total);
}
