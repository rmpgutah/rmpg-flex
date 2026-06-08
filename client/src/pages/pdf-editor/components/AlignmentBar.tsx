import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween,
  Maximize2,
} from 'lucide-react';
import type { AlignMode, DistributeMode, MatchSizeMode } from '../annotationOps';

// Compact arrangement toolbar shown when 2+ annotations are selected. Align +
// match-size need 2 selections; distribute needs 3 (Acrobat parity), so the
// distribute buttons disable below that threshold rather than vanish.
interface Props {
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (mode: DistributeMode) => void;
  onMatchSize: (mode: MatchSizeMode) => void;
}

export default function AlignmentBar({ count, onAlign, onDistribute, onMatchSize }: Props) {
  const btn = 'p-1 hover:bg-rmpg-700/40 rounded-sm text-rmpg-300 hover:text-[#d4a017] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-rmpg-300';
  const canDistribute = count >= 3;
  return (
    <div className="inline-flex items-center gap-0.5 border-l border-[#222] pl-2 ml-1" role="group" aria-label="Arrange selection">
      <button type="button" className={btn} title="Align left" onClick={() => onAlign('left')}><AlignStartVertical className="w-3.5 h-3.5" /></button>
      <button type="button" className={btn} title="Align horizontal centers" onClick={() => onAlign('hcenter')}><AlignCenterVertical className="w-3.5 h-3.5" /></button>
      <button type="button" className={btn} title="Align right" onClick={() => onAlign('right')}><AlignEndVertical className="w-3.5 h-3.5" /></button>
      <span className="w-px h-3.5 bg-[#222] mx-0.5" />
      <button type="button" className={btn} title="Align top" onClick={() => onAlign('top')}><AlignStartHorizontal className="w-3.5 h-3.5" /></button>
      <button type="button" className={btn} title="Align vertical centers" onClick={() => onAlign('vcenter')}><AlignCenterHorizontal className="w-3.5 h-3.5" /></button>
      <button type="button" className={btn} title="Align bottom" onClick={() => onAlign('bottom')}><AlignEndHorizontal className="w-3.5 h-3.5" /></button>
      <span className="w-px h-3.5 bg-[#222] mx-0.5" />
      <button type="button" className={btn} disabled={!canDistribute} title="Distribute horizontally (3+)" onClick={() => onDistribute('horizontal')}><AlignHorizontalSpaceBetween className="w-3.5 h-3.5" /></button>
      <button type="button" className={btn} disabled={!canDistribute} title="Distribute vertically (3+)" onClick={() => onDistribute('vertical')}><AlignVerticalSpaceBetween className="w-3.5 h-3.5" /></button>
      <span className="w-px h-3.5 bg-[#222] mx-0.5" />
      <button type="button" className={btn} title="Match size of active annotation" onClick={() => onMatchSize('both')}><Maximize2 className="w-3.5 h-3.5" /></button>
    </div>
  );
}
