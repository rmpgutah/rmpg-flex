import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import MapToolbar from '../MapToolbar';
import { FeatureFlagsContext } from '../../context/FeatureFlagsContext';

const ALL_ON = {
  draw: true, annotations: true, gps_replay: true, nav_overlay: true,
  buildings_3d: true, buffer_rings: true, ruler: true, minimap: true,
  dev_diagnostics: false,
};

const mockMap = {} as any;

const FakeTool = ({ onClose }: { map: any; onClose: () => void }) => (
  <div data-testid="tool-panel">
    <button onClick={onClose}>close</button>
  </div>
);

const TOOLS = [
  { id: 'draw', icon: '✏️', label: 'Draw', flag: 'draw' as const, component: FakeTool },
  { id: 'ruler', icon: '📏', label: 'Ruler', flag: 'ruler' as const, component: FakeTool },
];

function wrap(ui: React.ReactElement, flags = ALL_ON) {
  return render(
    <FeatureFlagsContext.Provider value={flags}>{ui}</FeatureFlagsContext.Provider>
  );
}

test('renders toolbar icon buttons', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />);
  expect(screen.getByLabelText('Draw')).toBeInTheDocument();
  expect(screen.getByLabelText('Ruler')).toBeInTheDocument();
});

test('clicking a tool shows its panel', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />);
  fireEvent.click(screen.getByLabelText('Draw'));
  expect(screen.getByTestId('tool-panel')).toBeInTheDocument();
});

test('clicking the same tool again closes the panel', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />);
  fireEvent.click(screen.getByLabelText('Draw'));
  fireEvent.click(screen.getByLabelText('Draw'));
  expect(screen.queryByTestId('tool-panel')).not.toBeInTheDocument();
});

test('tool close button deactivates panel', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />);
  fireEvent.click(screen.getByLabelText('Draw'));
  fireEvent.click(screen.getByText('close'));
  expect(screen.queryByTestId('tool-panel')).not.toBeInTheDocument();
});

test('hides tools whose feature flag is false', () => {
  wrap(<MapToolbar map={mockMap} tools={TOOLS} />, { ...ALL_ON, ruler: false });
  expect(screen.queryByLabelText('Ruler')).not.toBeInTheDocument();
});

test('returns null when map is null', () => {
  const { container } = wrap(<MapToolbar map={null} tools={TOOLS} />);
  expect(container.firstChild).toBeNull();
});
