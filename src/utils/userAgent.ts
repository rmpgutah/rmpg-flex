// Small regex-based User-Agent parser. No npm dependency (ua-parser-js etc.
// isn't installed) — this only needs to cover the handful of browsers/OSes
// officers and staff actually use, for display in the Admin Users "Active
// Sessions" list and the Security Dashboard's login/session detail. Not a
// general-purpose UA parser.
export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  deviceType: 'mobile' | 'tablet' | 'desktop' | null;
}

export function parseUserAgentDetails(userAgent: string | null | undefined): ParsedUserAgent {
  if (!userAgent || !userAgent.trim()) return { browser: null, os: null, deviceType: null };
  const ua = userAgent;

  let os: string | null = null;
  if (/iPhone/i.test(ua)) os = 'iOS';
  else if (/iPad/i.test(ua)) os = 'iPadOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser: string | null = null;
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Version\/.*Safari/i.test(ua) || /Safari\//i.test(ua)) browser = 'Safari';

  let deviceType: ParsedUserAgent['deviceType'] = null;
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) deviceType = 'tablet';
  else if (/iPhone|Android|Mobile/i.test(ua)) deviceType = 'mobile';
  else if (os || browser) deviceType = 'desktop';

  return { browser, os, deviceType };
}

/** Friendly one-line label, e.g. "Chrome on Windows" or "Unknown Device". */
export function parseUserAgentLabel(userAgent: string | null | undefined): string {
  const { browser, os } = parseUserAgentDetails(userAgent);
  if (!browser && !os) return 'Unknown Device';
  return `${browser ?? 'Unknown Browser'} on ${os ?? 'Unknown OS'}`;
}
