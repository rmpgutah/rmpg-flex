// Intel alerts surface — reads the overview alert feed (warrants / officer
// safety / gang / BOLO). A focused, full-height view of the dashboard widget.
import { useIntelOverview } from './useIntelOverview';
import { useIntelContext } from './IntelContext';
import ActiveAlertsWidget from './widgets/ActiveAlertsWidget';

export default function AlertsSection() {
  const { data } = useIntelOverview();
  const { selectEntity } = useIntelContext();
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[10px] tracking-widest text-fg-muted uppercase">Alerts</div>
      <ActiveAlertsWidget rows={data?.alerts || []} onSelect={selectEntity} />
    </div>
  );
}
