import { log } from './logger';

export interface ResendEmailInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
}

export interface ResendResult {
  id: string | null;
  status: 'sent' | 'failed';
  error?: string;
}

export async function sendViaResend(
  apiKey: string,
  input: ResendEmailInput,
): Promise<ResendResult> {
  const body: Record<string, unknown> = {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
  };

  if (input.attachments?.length) {
    body.attachments = input.attachments.map(a => ({
      filename: a.filename,
      content: a.content,
    }));
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = `Resend ${res.status}: ${text.slice(0, 200)}`;
    log.error('Resend email failed', { status: res.status, to: input.to, error: err });
    return { id: null, status: 'failed', error: err };
  }

  const data = await res.json() as { id?: string };
  return { id: data.id || null, status: 'sent' };
}
