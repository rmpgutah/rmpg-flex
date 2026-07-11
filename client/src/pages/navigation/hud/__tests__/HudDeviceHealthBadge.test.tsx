import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudDeviceHealthBadge } from '../HudInstruments';

describe('HudDeviceHealthBadge', () => {
  it('renders nothing when battery and GPS are healthy', () => {
    const { container } = render(
      <HudDeviceHealthBadge batteryLevel={80} batteryCharging={false} gpsAccuracy={20} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a low-battery warning below 20% unplugged', () => {
    render(<HudDeviceHealthBadge batteryLevel={15} batteryCharging={false} gpsAccuracy={20} />);
    expect(screen.getByText(/battery/i)).toBeInTheDocument();
  });

  it('does not warn on low battery while charging', () => {
    const { container } = render(
      <HudDeviceHealthBadge batteryLevel={15} batteryCharging={true} gpsAccuracy={20} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a GPS-degraded warning above the accuracy threshold', () => {
    render(<HudDeviceHealthBadge batteryLevel={80} batteryCharging={false} gpsAccuracy={600} />);
    expect(screen.getByText(/gps/i)).toBeInTheDocument();
  });
});
