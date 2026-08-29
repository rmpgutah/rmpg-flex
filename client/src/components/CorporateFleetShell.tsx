import type { ReactNode } from 'react';
import CorporateLinkageStrip from './CorporateLinkageStrip';

/** Wraps fleet routes so the corporate hours/miles strip is visible without
 *  editing `client/src/pages/fleet/**` (that path cannot land in the same PR
 *  as a new D1 migration). */
export default function CorporateFleetShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 flex flex-col">
      <CorporateLinkageStrip />
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
