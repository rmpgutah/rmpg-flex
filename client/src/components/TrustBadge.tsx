import { trustBadge, type TrustView } from '../utils/plateTrust';

export default function TrustBadge({ trust }: { trust: TrustView }) {
  const b = trustBadge(trust);
  const color = b.tone === 'good' ? '#d4a017' : '#888888';
  return (
    <span title={b.detail} style={{ color, border: `1px solid ${color}`, padding: '0 4px', fontSize: 9 }}>
      {b.label}
    </span>
  );
}
