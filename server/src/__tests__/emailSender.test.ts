import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/msGraphClient', () => ({
  getGraphClient: vi.fn(),
  isAuthorized: vi.fn(),
  isEnabled: vi.fn(),
  getConfigValue: vi.fn(() => 'test@example.com'),
  CONFIG_KEYS: { mailbox: 'ms_email_mailbox' },
}));
vi.mock('../utils/smtpClient', () => ({
  sendViaSMTP: vi.fn(),
  isSmtpConfigured: vi.fn(),
}));
vi.mock('../models/database', () => ({
  getDb: () => ({ prepare: () => ({ get: () => ({ email: 'u@example.com', full_name: 'U' }) }) }),
}));

import { sendEmail } from '../utils/emailSender';
import * as graph from '../utils/msGraphClient';
import * as smtp from '../utils/smtpClient';

describe('sendEmail result shape', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ok:false with reason=unknown when disabled', async () => {
    (graph.isEnabled as any).mockReturnValue(false);
    const res = await sendEmail({ to: 'a@b.c', subject: 's', html: '<p/>' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('unknown');
  });

  it('returns ok:true with transport=graph on graph success', async () => {
    (graph.isEnabled as any).mockReturnValue(true);
    (graph.isAuthorized as any).mockReturnValue(true);
    (graph.getGraphClient as any).mockResolvedValue({
      api: () => ({ post: vi.fn().mockResolvedValue({}) }),
    });
    const res = await sendEmail({ to: 'a@b.c', subject: 's', html: '<p/>' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.transport).toBe('graph');
  });

  it('falls back to SMTP when graph throws and returns transport=smtp', async () => {
    (graph.isEnabled as any).mockReturnValue(true);
    (graph.isAuthorized as any).mockReturnValue(true);
    (graph.getGraphClient as any).mockResolvedValue({
      api: () => ({ post: vi.fn().mockRejectedValue(new Error('auth expired')) }),
    });
    (smtp.isSmtpConfigured as any).mockReturnValue(true);
    (smtp.sendViaSMTP as any).mockResolvedValue(undefined);
    const res = await sendEmail({ to: 'a@b.c', subject: 's', html: '<p/>' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.transport).toBe('smtp');
  });

  it('returns ok:false with reason=auth_expired when graph fails & smtp not configured', async () => {
    (graph.isEnabled as any).mockReturnValue(true);
    (graph.isAuthorized as any).mockReturnValue(true);
    (graph.getGraphClient as any).mockResolvedValue({
      api: () => ({ post: vi.fn().mockRejectedValue(new Error('AuthenticationFailure: token expired')) }),
    });
    (smtp.isSmtpConfigured as any).mockReturnValue(false);
    const res = await sendEmail({ to: 'a@b.c', subject: 's', html: '<p/>' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('auth_expired');
  });
});
