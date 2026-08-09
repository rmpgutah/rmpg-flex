// Cloudflare stamps every incoming Request with a `cf` object (Workers-only,
// free, no external geo-IP API call) carrying the edge's read of the
// connecting IP's location and network. Reading it here — rather than
// leaving login/session rows with only a bare IP address — is what lets the
// admin security views show "Chrome on Windows, Salt Lake City, UT, US
// (Comcast Cable)" instead of just "128.177.161.30".
//
// Local `wrangler dev` / Miniflare requests may have a `cf` with all-null
// placeholder fields (no real edge in front of them), and this file must
// tolerate `cf` being entirely absent (unit tests constructing a bare
// Request). Every field is optional on the return type for that reason.
export interface RequestGeo {
  country: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  timezone: string | null;
  latitude: string | null;
  longitude: string | null;
  asn: string | null;
  isp: string | null;
  httpProtocol: string | null;
  tlsVersion: string | null;
  tlsCipher: string | null;
  likelyVpnOrHosting: boolean;
}

// Cloudflare's `cf` object has no direct "isVPN" field — this is a heuristic,
// not a certainty, matching the same class of signal commercial fraud/IAM
// tools use: an IP whose ASN organization name reads as a commercial VPN
// service or a cloud/hosting provider is far more likely to be a VPN exit
// node, proxy, or a bot/script running in a datacenter than an employee's
// actual residential or corporate ISP connection. False positives happen
// (an officer legitimately using a corporate VPN backhaul) and false
// negatives happen (a VPN provider using unbranded residential IP space) —
// this is a dashboard signal for a human to weigh, not an auto-block.
const VPN_HOSTING_KEYWORDS = [
  'vpn', 'proxy', 'tor exit', 'nordvpn', 'expressvpn', 'protonvpn', 'surfshark',
  'privateinternetaccess', 'ipvanish', 'mullvad', 'windscribe', 'cyberghost',
  'amazon', 'aws', 'google cloud', 'microsoft azure', 'digitalocean', 'linode',
  'ovh', 'hetzner', 'vultr', 'm247', 'datacamp', 'leaseweb', 'choopa',
  'contabo', 'hosting', 'colo', 'datacenter', 'data center',
];

function looksLikeVpnOrHosting(org: string | null): boolean {
  if (!org) return false;
  const lower = org.toLowerCase();
  return VPN_HOSTING_KEYWORDS.some((kw) => lower.includes(kw));
}

export function getRequestGeo(c: { req: { raw: Request } }): RequestGeo {
  const cf = (c.req.raw as unknown as { cf?: Record<string, unknown> }).cf;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : v != null ? String(v) : null);
  const isp = str(cf?.asOrganization);
  return {
    country: str(cf?.country),
    region: str(cf?.region),
    city: str(cf?.city),
    postalCode: str(cf?.postalCode),
    timezone: str(cf?.timezone),
    latitude: str(cf?.latitude),
    longitude: str(cf?.longitude),
    asn: str(cf?.asn),
    isp,
    httpProtocol: str(cf?.httpProtocol),
    tlsVersion: str(cf?.tlsVersion),
    tlsCipher: str(cf?.tlsCipher),
    likelyVpnOrHosting: looksLikeVpnOrHosting(isp),
  };
}
