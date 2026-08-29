import { describe, it, expect, vi } from 'vitest';
import { formatServerAssignLabel, toastClockLinkWarnings } from '../corporateOpsClient';

describe('corporateOpsClient', () => {
  it('toasts handbook, service, and license flags', () => {
    const addToast = vi.fn();
    toastClockLinkWarnings(addToast, {
      handbook_pending: true,
      service_due: true,
      license_expiring: true,
    });
    expect(addToast).toHaveBeenCalledTimes(3);
    expect(addToast).toHaveBeenCalledWith('Handbook acknowledgment still pending', 'warning');
  });

  it('formats on-duty servers for the assign dropdown', () => {
    expect(formatServerAssignLabel({
      name: 'Smith',
      onDuty: true,
      vehicle: 'D19',
      milesToday: 12.4,
    })).toBe('Smith · on duty · D19 · 12.4 mi');
  });
});
