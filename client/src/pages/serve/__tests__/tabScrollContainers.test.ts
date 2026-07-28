// ============================================================
// Serve tabs must each own a scroll container
// ============================================================
// ServePage renders every tab inside:
//
//     <div className="flex-1 overflow-hidden">   {/* tab content */}
//
// That wrapper fixes the tab's height and CLIPS anything taller — with no
// scrollbar, no overflow indicator and no error. So the wrapper silently
// requires each tab to bring its own scroller, and any tab that forgets is
// simply truncated.
//
// Measured on live (2026-07-28) before the fix: the Analytics tab reported
// clientHeight 843 against scrollHeight 1357 — 514px of the tab, including the
// whole Weekly Trend and Workload sections, unreachable by any means. Assign
// and Performance had the same defect. Route and Stats were fine only because
// they happened to declare `h-full overflow-y-auto` themselves.
//
// This is a structural guard, not a style check: it fails when a tab component
// grows past the pane and cannot scroll, which is invisible to jsdom rendering
// (no layout engine) and easy to reintroduce.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVE_TABS_DIR = join(process.cwd(), 'src/pages/serve');

/** Tab components mounted directly into ServePage's `flex-1 overflow-hidden`. */
const TAB_COMPONENTS = [
  'AnalyticsTab.tsx',
  'PerformanceTab.tsx',
  'AssignTab.tsx',
  'MyRunTab.tsx',
];

/**
 * The root element of the default-exported component — the one that becomes the
 * direct child of the clipping wrapper. Grabs the first JSX tag after the
 * top-level `return (`, skipping comment lines.
 */
function rootElement(source: string): string {
  // Anchor on the DEFAULT EXPORT, then take the first top-level `return (`
  // after it. Neither "first" nor "last" return in the file works: these files
  // define helper components both before AND after the exported one (AnalyticsTab
  // declares its bulk-actions bar afterwards, which is what a naive "last match"
  // picks up).
  const exportIdx = source.search(/export default (?:React\.memo\()?function/);
  if (exportIdx === -1) return '';
  const after = source.slice(exportIdx);
  const m = after.match(/\n {2}return \(\n([\s\S]*?)>/);
  return m?.[1] ?? '';
}

describe('serve tab components own their scroll container', () => {
  it.each(TAB_COMPONENTS)('%s can scroll its own overflow', (file) => {
    const src = readFileSync(join(SERVE_TABS_DIR, file), 'utf8');
    const root = rootElement(src);

    // Either the root scrolls, or it is a full-height flex column whose body
    // scrolls (MyRunTab's shape). Both keep content reachable.
    const rootScrolls = /h-full/.test(root) && /overflow-y-auto/.test(root);
    const delegatesToInnerScroller =
      /h-full/.test(root) && /flex-1 min-h-0 overflow-y-auto/.test(src);

    expect(
      rootScrolls || delegatesToInnerScroller,
      `${file}'s root element must handle overflow — ServePage clips it at the `
        + 'pane height otherwise. Add "h-full overflow-y-auto scrollbar-dark" to '
        + `the root, or give it an inner "flex-1 min-h-0 overflow-y-auto" body.\n`
        + `Root was: ${root.trim().slice(0, 200)}`,
    ).toBe(true);
  });

  it('the ServePage wrapper still clips — the reason this guard exists', () => {
    const servePage = readFileSync(join(process.cwd(), 'src/pages/ServePage.tsx'), 'utf8');
    // If this ever changes to an auto/scroll wrapper, the per-tab requirement is
    // lifted and this whole guard can be revisited.
    expect(servePage).toContain('flex-1 overflow-hidden');
  });
});
