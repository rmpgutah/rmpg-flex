import { describe, it, expect, vi } from 'vitest';
import { sendViaResend } from '../src/utils/resendEmail';

describe('sendViaResend', () => {
  it('calls Resend API with correct payload', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'test-id' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendViaResend('re_test_key', {
      from: 'Rocky Mountain Protective Group <server@rmpgutah.us>',
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.id).toBe('test-id');
    expect(result.status).toBe('sent');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer re_test_key',
          'Content-Type': 'application/json',
        }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('sends attachments when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'att-id' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await sendViaResend('re_test_key', {
      from: 'server@rmpgutah.us',
      to: 'recipient@example.com',
      subject: 'With PDF',
      html: '<p>See attached</p>',
      attachments: [{ filename: 'doc.pdf', content: 'base64data' }],
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.attachments).toEqual([{ filename: 'doc.pdf', content: 'base64data' }]);

    vi.unstubAllGlobals();
  });

  it('returns failed status on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('Invalid email'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendViaResend('re_test_key', {
      from: 'server@rmpgutah.us',
      to: 'bad',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('422');

    vi.unstubAllGlobals();
  });
});
