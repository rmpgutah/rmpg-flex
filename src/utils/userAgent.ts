// Small regex-based User-Agent → friendly device label parser. No npm
// dependency (ua-parser-js etc. isn't installed) — this only needs to cover
// the handful of browsers/OSes officers and staff actually use, for display
// in the Admin Users "Active Sessions" list. Not a general-purpose UA parser.
export function parseUserAgentLabel(userAgent: string | null | undefined): string {
  if (!userAgent || !userAgent.trim()) return 'Unknown Device';
  const ua = userAgent;

  let os = 'Unknown OS';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Unknown Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Version\/.*Safari/i.test(ua) || /Safari\//i.test(ua)) browser = 'Safari';

  if (os === 'Unknown OS' && browser === 'Unknown Browser') return 'Unknown Device';
  return `${browser} on ${os}`;
}
