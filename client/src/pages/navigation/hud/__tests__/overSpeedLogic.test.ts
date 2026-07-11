import { describe, it, expect } from 'vitest';
import { shouldFireOverSpeedAlert, OVER_SPEED_COOLDOWN_MS } from '../useSpeedLimit';

describe('shouldFireOverSpeedAlert', () => {
  it('does not fire when speed is under the limit + threshold', () => {
    expect(shouldFireOverSpeedAlert(40, 35, 10, null, 0)).toBe(false);
  });

  it('fires when speed exceeds limit + threshold and no prior alert', () => {
    expect(shouldFireOverSpeedAlert(50, 35, 10, null, 0)).toBe(true);
  });

  it('does not fire again inside the cooldown window', () => {
    expect(shouldFireOverSpeedAlert(50, 35, 10, 1000, 1000 + OVER_SPEED_COOLDOWN_MS - 1)).toBe(false);
  });

  it('fires again once the cooldown has elapsed', () => {
    expect(shouldFireOverSpeedAlert(50, 35, 10, 1000, 1000 + OVER_SPEED_COOLDOWN_MS + 1)).toBe(true);
  });

  it('never fires when the posted limit is unknown', () => {
    expect(shouldFireOverSpeedAlert(90, null, 10, null, 0)).toBe(false);
  });
});
