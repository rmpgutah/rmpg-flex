import type { HoverTooltipState } from '../hooks/useOlHoverTooltip';

interface MapV2HoverTooltipProps {
  tooltip: HoverTooltipState | null;
}

/**
 * Floating monospaced label that tracks the cursor over a hovered map
 * feature. fixed positioning (vs absolute) so it sits cleanly above
 * other map chrome without z-index conflicts. pointer-events none so
 * it doesn't intercept clicks.
 */
export default function MapV2HoverTooltip({ tooltip }: MapV2HoverTooltipProps) {
  if (!tooltip) return null;
  return (
    <div
      className="fixed z-[150] bg-[#0a0a0a] border border-[#222222] text-[#e5e7eb] font-mono text-[10px] px-2 py-1 pointer-events-none whitespace-nowrap shadow-md"
      style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
      aria-hidden="true"
    >
      {tooltip.label}
    </div>
  );
}
