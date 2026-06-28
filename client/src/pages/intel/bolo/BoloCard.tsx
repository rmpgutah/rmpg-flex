import { User, Car, Flag as FlagIcon } from 'lucide-react';
import { authedImageUrl } from '../../../hooks/useApi';
import type { Bolo } from '../useBolos';
import { formatEnumValue } from '../../../utils/formatters';

// Priority tags. Kept as inline hex for the warning red/amber bands — these
// are alert semantics (officer-safety), not theme decoration, and live as
// the same hex across every alert surface in the system.
const PRIORITY_TAG: Record<string, string> = {
  P1: 'bg-[#3a0d0a] text-red-400 border-red-700/50',
  P2: 'bg-[#3a2a08] text-amber-300 border-amber-700/50',
  P3: 'bg-surface-raised text-rmpg-400 border-border-subtle',
};

// Lucide icons replace the prior 🚗 / ◉ / ⚑ glyphs (v1047 audit). The emoji
// 🚗 in particular rendered as a colorful sticker in Chrome's emoji font,
// which clashed with the steel-blue theme and looked unprofessional in
// court packages.
function TypeIcon({ type }: { type: string }) {
  if (type === 'vehicle') return <Car size={16} />;
  if (type === 'person') return <User size={16} />;
  return <FlagIcon size={16} />;
}

export default function BoloCard({ bolo, canDelete, onResolve, onDelete }: {
  bolo: Bolo;
  canDelete: boolean;
  onResolve: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const expired = bolo.status !== 'active';
  return (
    <div className={`border rounded-[2px] p-3 ${expired ? 'border-border-default bg-surface-base opacity-60' : 'border-border-default bg-surface-overlay'}`}>
      <div className="flex items-start gap-3">
        {bolo.type === 'person' && bolo.photo_url
          ? <img src={authedImageUrl(bolo.photo_url)} alt="" className="w-10 h-12 object-cover rounded-[2px] border border-border-default shrink-0" />
          : (
            <div className="w-10 h-12 bg-surface-sunken border border-border-default rounded-[2px] shrink-0 flex items-center justify-center text-rmpg-500">
              <TypeIcon type={bolo.type} />
            </div>
          )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] border ${PRIORITY_TAG[bolo.priority] || PRIORITY_TAG.P3}`}>{bolo.priority}</span>
            <span className="font-mono text-[9px] text-rmpg-500">{bolo.bolo_number}</span>
            {expired && <span className="font-mono text-[8px] text-rmpg-500 uppercase">{formatEnumValue(bolo.status)}</span>}
          </div>
          <div className="text-[13px] text-rmpg-100 font-semibold mt-1 truncate">{bolo.title}</div>
          {bolo.subject_description && <div className="text-[11px] text-rmpg-300 truncate">{bolo.subject_description}</div>}
          {bolo.vehicle_description && <div className="text-[11px] text-rmpg-300 truncate">{bolo.vehicle_description}</div>}
          {bolo.description && <div className="text-[10px] text-rmpg-400 mt-1 line-clamp-2">{bolo.description}</div>}
          <div className="flex items-center gap-2 mt-2 text-[9px] text-rmpg-500 font-mono">
            <span>{bolo.issued_by_name || 'Unknown'}</span>
            {bolo.expires_at && <span>· expires {bolo.expires_at.slice(0, 10)}</span>}
          </div>
        </div>
      </div>
      {!expired && (
        <div className="flex gap-2 mt-2 justify-end">
          <button onClick={() => onResolve(bolo.id)}
            className="font-mono text-[8px] tracking-wide text-brand-400 border border-border-subtle rounded-[2px] px-2 py-[5px] uppercase">Resolve</button>
          {canDelete && (
            <button onClick={() => onDelete(bolo.id)}
              className="font-mono text-[8px] tracking-wide text-red-400 border border-red-900/50 rounded-[2px] px-2 py-[5px] uppercase">Cancel BOLO</button>
          )}
        </div>
      )}
    </div>
  );
}
