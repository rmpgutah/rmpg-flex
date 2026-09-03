// ============================================================
// RMPG Flex — Map Dock Render Integration Test
// Proves the left/right docks actually RENDER correctly from the
// layer registry via buildDockSections — not just that the data
// structures are shaped right. Browser verification is blocked
// behind the login wall, so this is the substitute proof.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapLeftDock from '../MapLeftDock';
import MapRightDock from '../MapRightDock';
import { MapDensityProvider } from '../../hooks/useMapDensity';
import {
  LEFT_DOCK_GROUPS, RIGHT_DOCK_GROUPS, MAP_LAYER_REGISTRY,
} from '../../config/layerRegistry';
import { buildDockSections, type LayerBindingMap } from '../../hooks/useLayerBindings';
import { HIERARCHY_CONFIGS } from '../../../../hooks/useDistrictHierarchyLayers';
import { GEO_LAYER_CONFIGS } from '../../../../hooks/useGeoJsonLayers';

function nonOsmRegistry() {
  return MAP_LAYER_REGISTRY.filter((l) => !l.group.startsWith('OSM'));
}

async function expandOsmSections(user: ReturnType<typeof userEvent.setup>) {
  for (const title of LEFT_DOCK_GROUPS.filter((g) => g.startsWith('OSM'))) {
    const header = screen.getByRole('button', { name: title });
    if (header.getAttribute('aria-expanded') === 'false') {
      await user.click(header);
    }
  }
}

function buildAllBoundBindings(): LayerBindingMap {
  const bindings: LayerBindingMap = {};
  for (const layer of MAP_LAYER_REGISTRY) {
    bindings[layer.id] = { active: false, onToggle: vi.fn() };
  }
  return bindings;
}

describe('Map dock render (registry-driven)', () => {
  it('renders all 6 left dock group titles', () => {
    const bindings = buildAllBoundBindings();
    const sections = buildDockSections(LEFT_DOCK_GROUPS, bindings);
    render(<MapLeftDock sections={sections} />);
    for (const title of LEFT_DOCK_GROUPS) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('renders all 4 right dock group titles', () => {
    const bindings = buildAllBoundBindings();
    const sections = buildDockSections(RIGHT_DOCK_GROUPS, bindings);
    render(<MapRightDock sections={sections} />);
    for (const title of RIGHT_DOCK_GROUPS) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('renders one switch row per registry entry, with matching accessible names', async () => {
    const user = userEvent.setup();
    const bindings = buildAllBoundBindings();
    const leftSections = buildDockSections(LEFT_DOCK_GROUPS, bindings);
    const rightSections = buildDockSections(RIGHT_DOCK_GROUPS, bindings);

    render(
      <div>
        <MapLeftDock sections={leftSections} />
        <MapRightDock sections={rightSections} />
      </div>,
    );

    expect(screen.getAllByRole('switch')).toHaveLength(nonOsmRegistry().length);

    await expandOsmSections(user);

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(MAP_LAYER_REGISTRY.length);

    const renderedNames = new Set(switches.map((el) => el.textContent?.trim()));
    const registryLabels = new Set(MAP_LAYER_REGISTRY.map((l) => l.label));
    expect(renderedNames).toEqual(registryLabels);
  });

  it('renders the 9 derived boundary rows (3 HIERARCHY_CONFIGS + 6 GEO_LAYER_CONFIGS) — the case with no other guard', () => {
    const bindings = buildAllBoundBindings();
    const leftSections = buildDockSections(LEFT_DOCK_GROUPS, bindings);
    render(<MapLeftDock sections={leftSections} />);

    for (const cfg of HIERARCHY_CONFIGS) {
      expect(screen.getByRole('switch', { name: cfg.label })).toBeInTheDocument();
    }
    for (const cfg of GEO_LAYER_CONFIGS) {
      expect(screen.getByRole('switch', { name: cfg.label })).toBeInTheDocument();
    }
  });

  it('gives every row a leading lucide <svg> icon (never the loading/error icon)', async () => {
    const user = userEvent.setup();
    const bindings = buildAllBoundBindings();
    const leftSections = buildDockSections(LEFT_DOCK_GROUPS, bindings);
    const rightSections = buildDockSections(RIGHT_DOCK_GROUPS, bindings);
    render(
      <div>
        <MapLeftDock sections={leftSections} />
        <MapRightDock sections={rightSections} />
      </div>,
    );

    await expandOsmSections(user);

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(MAP_LAYER_REGISTRY.length);
    for (const row of switches) {
      const svgs = row.querySelectorAll('svg');
      expect(svgs.length).toBe(1);
      expect(svgs[0]).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it("fires a row's onToggle when clicked and reflects the binding's active value in aria-checked", async () => {
    const user = userEvent.setup();
    const bindings = buildAllBoundBindings();
    // Mark one layer active so we can prove aria-checked tracks the binding.
    const activeLayer = MAP_LAYER_REGISTRY.find((l) => l.group === 'Live Conditions')!;
    bindings[activeLayer.id] = { ...bindings[activeLayer.id], active: true };

    const sections = buildDockSections(LEFT_DOCK_GROUPS, bindings);
    render(<MapLeftDock sections={sections} />);

    const activeRow = screen.getByRole('switch', { name: activeLayer.label });
    expect(activeRow).toHaveAttribute('aria-checked', 'true');

    const inactiveLayer = MAP_LAYER_REGISTRY.find(
      (l) => l.group === 'Live Conditions' && l.id !== activeLayer.id,
    )!;
    const inactiveRow = screen.getByRole('switch', { name: inactiveLayer.label });
    expect(inactiveRow).toHaveAttribute('aria-checked', 'false');

    await user.click(inactiveRow);
    expect(bindings[inactiveLayer.id].onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders rows at the 44px minimum height under touch density', () => {
    const bindings = buildAllBoundBindings();
    const sections = buildDockSections(LEFT_DOCK_GROUPS, bindings);
    render(
      <MapDensityProvider initialOverride="touch">
        <MapLeftDock sections={sections} />
      </MapDensityProvider>,
    );
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(0);
    for (const row of switches) {
      expect(row).toHaveStyle({ minHeight: '44px' });
    }
  });

  it('renders rows at the 24px minimum height under compact density', () => {
    const bindings = buildAllBoundBindings();
    const sections = buildDockSections(LEFT_DOCK_GROUPS, bindings);
    render(
      <MapDensityProvider initialOverride="compact">
        <MapLeftDock sections={sections} />
      </MapDensityProvider>,
    );
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(0);
    for (const row of switches) {
      expect(row).toHaveStyle({ minHeight: '24px' });
    }
  });

  it('OSM All enables the group without expanding it', async () => {
    const user = userEvent.setup();
    const bindings = buildAllBoundBindings();
    const sections = buildDockSections(LEFT_DOCK_GROUPS, bindings);
    render(<MapLeftDock sections={sections} />);

    const header = screen.getByRole('button', { name: 'OSM Fire & Safety' });
    const group = header.closest('.border-b') as HTMLElement;
    await user.click(within(group).getByRole('button', { name: 'All' }));
    expect(bindings['osm_safety_hydrant'].onToggle).toHaveBeenCalled();
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch', { name: 'Fire hydrants' })).not.toBeInTheDocument();
  });
});
