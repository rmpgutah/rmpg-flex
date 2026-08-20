import { describe, it, expect } from 'vitest';
import { presignPutUrl, r2CredentialsConfigured } from '../src/utils/r2Presign';

describe('r2CredentialsConfigured', () => {
  it('returns false when any credential is missing', () => {
    expect(r2CredentialsConfigured({})).toBe(false);
    expect(r2CredentialsConfigured({ R2_ACCESS_KEY_ID: 'a' })).toBe(false);
    expect(r2CredentialsConfigured({ R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b' })).toBe(false);
  });

  it('returns true when all three are set', () => {
    expect(r2CredentialsConfigured({
      R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b', R2_ACCOUNT_ID: 'c',
    })).toBe(true);
  });
});

describe('presignPutUrl', () => {
  const env = {
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_ACCOUNT_ID: 'abc123',
  };

  it('throws when credentials are not configured', async () => {
    await expect(presignPutUrl({}, 'my-bucket', 'foo.txt')).rejects.toThrow('not configured');
  });

  it('returns a signed URL scoped to the bucket and key, expiring in 900s by default', async () => {
    const url = await presignPutUrl(env, 'my-bucket', 'attachments/abc.jpg');
    expect(url.startsWith('https://abc123.r2.cloudflarestorage.com/my-bucket/attachments/abc.jpg')).toBe(true);
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=900');
  });

  it('URL-encodes special characters in the key', async () => {
    const url = await presignPutUrl(env, 'my-bucket', 'Map Overlay Database/my file.geojson');
    expect(url).toContain('Map%20Overlay%20Database/my%20file.geojson');
  });

  it('respects a custom expiry', async () => {
    const url = await presignPutUrl(env, 'my-bucket', 'k', 60);
    expect(url).toContain('X-Amz-Expires=60');
  });
});
