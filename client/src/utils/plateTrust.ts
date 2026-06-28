export interface TrustView { trustScore: number; readCount: number; basis: string; }
export interface Badge { label: 'VERIFIED' | 'REVIEW' | 'UNVERIFIED'; tone: 'good' | 'warn'; detail: string; }

/** Honest badge from the server's derived trust. NEVER renders a model self-reported %. */
export function trustBadge(v: TrustView): Badge {
  if (v.readCount <= 1 || v.trustScore < 0.80) return { label: 'UNVERIFIED', tone: 'warn', detail: v.basis };
  if (v.trustScore < 0.85) return { label: 'REVIEW', tone: 'warn', detail: v.basis };
  return { label: 'VERIFIED', tone: 'good', detail: v.basis };
}
