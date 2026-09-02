export interface AosEmailData {
  recipientName: string;
  formTitle: string;
  documents?: { title: string; copies?: number }[];
  caseNumber?: string | null;
  dateServed?: string | null;
  serverName?: string | null;
  serverBadge?: string | null;
}

export function buildAosEmailHtml(data: AosEmailData): string {
  const docs = (data.documents || [])
    .map(d => `<div style="font-size:13px;color:#2c2c2a;margin-bottom:4px;">&#128196; ${esc(d.title)}</div>`)
    .join('');

  const metaParts: string[] = [];
  if (data.caseNumber) metaParts.push(`<div style="display:inline-block;vertical-align:top;min-width:80px;"><div style="color:#5f5e5a;margin-bottom:2px;">Case</div><div style="font-weight:500;">${esc(data.caseNumber)}</div></div>`);
  if (data.dateServed) metaParts.push(`<div style="display:inline-block;vertical-align:top;min-width:80px;"><div style="color:#5f5e5a;margin-bottom:2px;">Date served</div><div style="font-weight:500;">${esc(data.dateServed)}</div></div>`);
  if (data.serverName) {
    const badge = data.serverBadge ? ` ${esc(data.serverBadge)}` : '';
    metaParts.push(`<div style="display:inline-block;vertical-align:top;min-width:80px;"><div style="color:#5f5e5a;margin-bottom:2px;">Served by</div><div style="font-weight:500;">${esc(data.serverName)}${badge}</div></div>`);
  }
  const metaRow = metaParts.length
    ? `<div style="margin:20px 0;font-size:13px;">${metaParts.join('<div style="display:inline-block;width:24px;"></div>')}</div>`
    : '';

  const formTitleLower = data.formTitle.toLowerCase();

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#ffffff;border-radius:8px;overflow:hidden;">
<div style="background:#22405f;padding:24px 32px;text-align:center;">
<div style="font-size:11px;letter-spacing:2px;color:#c3ccd6;margin-bottom:4px;">ROCKY MOUNTAIN PROTECTIVE GROUP</div>
<div style="font-size:18px;font-weight:500;color:#f0f4f9;">Acknowledgement of Service</div>
<div style="font-size:12px;color:#8fa3b8;margin-top:4px;">Your signed copy</div>
</div>
<div style="padding:32px;color:#2c2c2a;font-size:14px;line-height:1.7;">
<p style="margin:0 0 16px;">${esc(data.recipientName)},</p>
<p style="margin:0 0 16px;">Attached is your copy of the <strong>${esc(formTitleLower)}</strong> you signed today, for your records.</p>
${docs ? `<div style="background:#f5f7fa;border-radius:6px;padding:16px 20px;margin:20px 0;border-left:3px solid #22405f;">
<div style="font-size:12px;color:#5f5e5a;margin-bottom:8px;">Documents served</div>
${docs}</div>` : ''}
${metaRow}
<p style="margin:20px 0 0;color:#5f5e5a;font-size:13px;">This message is a courtesy copy from Rocky Mountain Protective Group. Please do not reply &mdash; questions about the case should go to the court or the attorney of record.</p>
</div>
<div style="background:#f5f7fa;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
<div style="font-size:11px;color:#888780;line-height:1.6;">
Rocky Mountain Protective Group<br>Salt Lake City, Utah<br>
<span style="color:#5f5e5a;">server@rmpgutah.us</span>
</div>
</div>
</div>
</div>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
