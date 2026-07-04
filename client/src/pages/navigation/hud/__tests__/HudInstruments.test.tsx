import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudNextManeuver } from '../HudInstruments';

const baseProps = {
  maneuverType: 'turn',
  modifier: 'left',
  instruction: 'Turn left onto S Main St',
  distanceToTurnMeters: 200,
  stepDistanceMeters: 1112,
};

describe('HudNextManeuver', () => {
  it('does not render a lane strip when lanes is undefined', () => {
    render(<HudNextManeuver {...baseProps} />);
    expect(screen.queryByTestId('lane-strip')).not.toBeInTheDocument();
  });

  it('does not render a lane strip when lanes is an empty array', () => {
    render(<HudNextManeuver {...baseProps} lanes={[]} />);
    expect(screen.queryByTestId('lane-strip')).not.toBeInTheDocument();
  });

  it('renders one lane icon per lane, with valid/invalid styling distinguishable', () => {
    render(
      <HudNextManeuver
        {...baseProps}
        lanes={[
          { valid: true, active: false, indications: ['left'] },
          { valid: true, active: true, indications: ['straight'] },
          { valid: false, active: false, indications: ['right'] },
        ]}
      />
    );
    const strip = screen.getByTestId('lane-strip');
    const lanes = screen.getAllByTestId('lane-icon');
    expect(lanes).toHaveLength(3);
    expect(strip).toBeInTheDocument();
    // Valid lanes carry a different data attribute than invalid ones.
    expect(lanes[0]).toHaveAttribute('data-lane-valid', 'true');
    expect(lanes[1]).toHaveAttribute('data-lane-valid', 'true');
    expect(lanes[2]).toHaveAttribute('data-lane-valid', 'false');
    // The Mapbox-recommended ("active") lane is flagged distinctly from a merely-valid one.
    expect(lanes[0]).toHaveAttribute('data-lane-active', 'false');
    expect(lanes[1]).toHaveAttribute('data-lane-active', 'true');
  });
});
