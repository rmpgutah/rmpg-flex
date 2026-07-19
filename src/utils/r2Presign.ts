// ============================================================
// RMPG Flex — R2 presigned-PUT signer (shared)
// ============================================================
// Signs short-lived presigned PUT URLs against R2's S3-compatible API so
// the browser can upload large files directly to R2, bypassing the
// Worker's memory/CPU limits entirely. Used by:
//   - src/routes/uploads.ts        (attachments bucket: rmpg-flex-uploads)
//   - src/routes/adminMapData.ts   (map-data bucket: system-essentials)
//
// Both buckets share one R2 API token (Access Key ID + Secret Access Key,
// created in the R2 bucket settings page, scoped to both buckets) stored
// as Worker secrets — never committed, never pasted into chat. See the
// design spec's "Operator setup" section for how to provision them.
// ============================================================

import { AwsClient } from 'aws4fetch';

export interface PresignEnv {
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
}

const DEFAULT_EXPIRES_SECONDS = 900;

export function r2CredentialsConfigured(env: PresignEnv): boolean {
  return Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID);
}

// R2 object keys can contain spaces and other characters that must be
// percent-encoded per path segment (but NOT the `/` separators themselves).
function encodeR2Key(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/**
 * Returns a presigned PUT URL for `bucket`/`key`, valid for
 * `expiresInSeconds` (default 900 = 15 minutes). Throws if R2 credentials
 * are not configured — callers should check `r2CredentialsConfigured()`
 * first and return a `not_configured` response instead of letting this
 * throw reach the client as a 500.
 */
export async function presignPutUrl(
  env: PresignEnv,
  bucket: string,
  key: string,
  expiresInSeconds: number = DEFAULT_EXPIRES_SECONDS,
): Promise<string> {
  if (!r2CredentialsConfigured(env)) {
    throw new Error('R2 presign credentials not configured');
  }

  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: 'auto',
  });

  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${encodeR2Key(key)}`,
  );
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));

  const signed = await client.sign(url.toString(), {
    method: 'PUT',
    aws: { signQuery: true },
  });

  return signed.url;
}
