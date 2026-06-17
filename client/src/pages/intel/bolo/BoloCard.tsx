import { authedImageUrl } from '../../../hooks/useApi';
import type { Bolo } from '../useBolos';

const PRIORITY_TAG: Record<string, string> = {
  P1: 'bg-[#3a0d0a] text-[#ff6b5e] border-[#5a1410]',
  P2: 'bg-[#3a2a08] text-[#f0c050] border-[#5a3a10]',
  P3: 'bg-[#1a1a1a] text-[#aaa] border-[#333]',
};
const TYPE_ICON: Record<string, string> = { person: '◉', vehicle: '🚗', other: '⚑' };

export default function BoloCard({ bolo, canDelete, onResolve, onDelete }: {
  bolo: Bolo;
  canDelete: boolean;
  onResolve: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const expired = bolo.status !== 'active';
  return (
    <div className={`border rounded-[2px] p-3 ${expired ? 'border-[#1a1a1a] bg-[#040404] opacity-60' : 'border-[#232323] bg-[#070707]'}`}>
      <div className="flex items-start gap-3">
        {bolo.type === 'person' && bolo.photo_url
          ? <img src={authedImageUrl(bolo.photo_url)} alt="" className="w-10 h-12 object-cover rounded-[2px] border border-[#2a2a2a] shrink-0" />
          : <div className="w-10 h-12 bg-[#161616] border border-[#2a2a2a] rounded-[2px] shrink-0 flex items-center justify-center text-[#555]">{TYPE_ICON[bolo.type] || '⚑'}</div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] border ${PRIORITY_TAG[bolo.priority] || PRIORITY_TAG.P3}`}>{bolo.priority}</span>
            <span className="font-mono text-[9px] text-[#888]">{bolo.bolo_number}</span>
            {expired && <span className="font-mono text-[8px] text-[#666] uppercase">{bolo.status}</span>}
          </div>
          <div className="text-[13px] text-rmpg-100 font-semibold mt-1 truncate">{bolo.title}</div>
          {bolo.subject_description && <div className="text-[11px] text-[#bbb] truncate">{bolo.subject_description}</div>}
          {bolo.vehicle_description && <div className="text-[11px] text-[#bbb] truncate">{bolo.vehicle_description}</div>}
          {bolo.description && <div className="text-[10px] text-[#777] mt-1 line-clamp-2">{bolo.description}</div>}
          <div className="flex items-center gap-2 mt-2 text-[9px] text-[#555] font-mono">
            <span>{bolo.issued_by_name || 'Unknown'}</span>
            {bolo.expires_at && <span>· expires {bolo.expires_at.slice(0, 10)}</span>}
          </div>
        </div>
      </div>
      {!expired && (
        <div className="flex gap-2 mt-2 justify-end">
          <button onClick={() => onResolve(bolo.id)}
            className="font-mono text-[8px] tracking-wide text-[#d4a017] border border-[#3a3a3a] rounded-[2px] px-2 py-[5px] uppercase">Resolve</button>
          {canDelete && (
            <button onClick={() => onDelete(bolo.id)}
              className="font-mono text-[8px] tracking-wide text-[#ff6b5e] border border-[#5a1410] rounded-[2px] px-2 py-[5px] uppercase">Cancel BOLO</button>
          )}
        </div>
      )}
    </div>
  );
}
