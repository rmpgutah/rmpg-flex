// ============================================================
// RMPG Flex — Desktop Mini-Map Widget
// ============================================================
// Thin sizing wrapper around the existing DashboardMiniMap (fleet-wide live
// Mapbox situational map) for use in the Desktop Launcher's widget panel.
// DashboardMiniMap already owns its own loading/error states, data fetch,
// and map lifecycle (mapRef.current?.remove() on unmount) — this wrapper
// adds no logic of its own beyond fitting it into the widget frame.
// ============================================================

import DashboardMiniMap from '../../DashboardMiniMap';

export default function DesktopMiniMapWidget() {
  return (
    <div style={{ width: 260 }}>
      <DashboardMiniMap />
    </div>
  );
}
