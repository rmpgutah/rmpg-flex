import { Link } from 'react-router-dom';
import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

export default function ReviewQueuesWidget({ queues }: { queues: IntelOverview['queues'] }) {
  const badge = (n: number) => (
    <span className="font-mono text-[9px] text-black bg-[#d4a017] rounded-[2px] px-[5px] py-[1px]">{n}</span>
  );
  return (
    <WidgetFrame title="⚐ Review Queues" note={String(queues.link_suggestions + queues.resolution_pairs)}>
      <Link to="/intel/queues" className="flex items-center gap-2 py-[5px] border-b border-[#131313]">
        <div className="flex-1"><div className="text-[11px] text-[#e8e8e8]">Narrative link suggestions</div>
          <div className="text-[10px] text-[#666]">person/vehicle mentions to confirm</div></div>
        {badge(queues.link_suggestions)}
      </Link>
      <Link to="/intel/queues" className="flex items-center gap-2 py-[5px]">
        <div className="flex-1"><div className="text-[11px] text-[#e8e8e8]">Duplicate-person review</div>
          <div className="text-[10px] text-[#666]">entity-resolution pairs</div></div>
        {badge(queues.resolution_pairs)}
      </Link>
    </WidgetFrame>
  );
}
