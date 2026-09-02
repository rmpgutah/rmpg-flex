// ============================================================
// RMPG Flex — Windows Wi-Fi info parsing (netsh)
// Pure parsers for `netsh wlan ...` output — no live OS access
// here — mirroring desktop/systemInfo.js's /deviceInfo.js's /
// hardwareFz55.js's pattern, for zero-runtime-dependency unit
// testing. main.js's wifi:get-detail / wifi:scan-networks /
// wifi:list-profiles IPC handlers feed these raw stdout strings.
// ============================================================

'use strict';

/**
 * Convert a Windows WLAN link-quality percentage (0-100) to an
 * approximate RSSI in dBm. netsh reports "Signal" as a 0-100 link
 * quality, not a raw RSSI, so this is an estimate: 100% ≈ -50 dBm,
 * 50% ≈ -75 dBm, 0% ≈ -100 dBm. Returns null for non-finite input.
 */
function signalToDbm(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return null;
  return Math.round(p * 0.5 - 100);
}

/**
 * Map a WLAN channel + radio type string to a human band label.
 * Windows netsh does not cleanly expose band in `show networks`,
 * so the 6 GHz case is inferred from the radio type; 2.4 / 5 GHz
 * are inferred from the channel number ranges.
 */
function channelBand(channel, radioType) {
  const ch = Number(channel);
  if (!Number.isFinite(ch)) return null;
  if (/6e|11ax\b.*6/i.test(radioType || '')) return '6 GHz';
  if (ch >= 1 && ch <= 14) return '2.4 GHz';
  if (ch >= 32 && ch <= 177) return '5 GHz';
  if (ch > 177) return '6 GHz';
  return null;
}

/**
 * Convert a WLAN channel to a center frequency in MHz for the given
 * band. Uses the standard channel plan for each band.
 */
function channelFrequencyMhz(channel, band) {
  const ch = Number(channel);
  if (!Number.isFinite(ch)) return null;
  if (band === '2.4 GHz') return ch === 14 ? 2484 : 2407 + ch * 5;
  if (band === '5 GHz') return 5000 + ch * 5;
  if (band === '6 GHz') return 5950 + ch * 5;
  return null;
}

/** Parse a "Basic rates (Mbps) : 6 12 24" value into a numeric array. */
function parseRateList(value) {
  if (!value) return [];
  return value
    .split(/\s+/)
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n));
}

/**
 * Parse `netsh wlan show networks mode=Bssid` stdout into the full
 * ScannedNetwork[] shape the renderer's WifiSelector expects.
 * Each SSID block carries one or more BSSID sub-blocks.
 */
function parseNetshScanNetworks(raw) {
  if (!raw) return [];
  const blocks = String(raw).split(/(?=^SSID \d+ :)/m).filter((b) => b.trim().startsWith('SSID'));
  const networks = [];
  for (const block of blocks) {
    const ssidM  = block.match(/^SSID \d+ +: (.+)/m);
    const netM   = block.match(/Network type +: (.+)/m);
    const authM  = block.match(/Authentication +: (.+)/m);
    const encM   = block.match(/Encryption +: (.+)/m);
    const ssid   = ssidM ? ssidM[1].trim() : '';
    const isHidden = !ssid || /hidden network/i.test(ssid);
    const auth   = authM ? authM[1].trim() : 'Unknown';
    const enc    = encM ? encM[1].trim() : 'Unknown';
    const networkType = netM ? netM[1].trim() : null;

    const bssidBlocks = block.split(/(?=^ +BSSID \d+ +:)/m).slice(1);
    const bssids = bssidBlocks.map((bb) => {
      const bM = bb.match(/BSSID \d+ +: (.+)/m);
      const sM = bb.match(/Signal +: (\d+)%/m);
      const rtM = bb.match(/Radio type +: (.+)/m);
      const cM = bb.match(/Channel +: (\d+)/m);
      const basicM = bb.match(/Basic rates \(Mbps\)\s*: (.+)/i);
      const otherM = bb.match(/Other rates \(Mbps\)\s*: (.+)/i);
      const signal = sM ? parseInt(sM[1], 10) : 0;
      const radioType = rtM ? rtM[1].trim() : null;
      const channel = cM ? parseInt(cM[1], 10) : null;
      const band = channelBand(channel, radioType);
      const basicRates = parseRateList(basicM ? basicM[1] : '');
      const otherRates = parseRateList(otherM ? otherM[1] : '');
      const maxRateMbps = [...basicRates, ...otherRates].reduce((m, r) => Math.max(m, r), 0) || null;
      return {
        bssid: bM ? bM[1].trim() : null,
        signal,
        signalDbm: signalToDbm(signal),
        radioType,
        channel,
        band,
        frequencyMhz: channelFrequencyMhz(channel, band),
        basicRates,
        otherRates,
        maxRateMbps,
        vendor: null,
      };
    });

    if (!ssid && bssids.length === 0) continue;
    const maxSignal = bssids.reduce((m, b) => Math.max(m, b.signal), 0);
    const bestBssid = bssids.find((b) => b.signal === maxSignal) || bssids[0] || {};
    const channel = bestBssid.channel ?? null;
    const band = channelBand(channel, bestBssid.radioType);
    const allRates = [...(bestBssid.basicRates || []), ...(bestBssid.otherRates || [])];

    networks.push({
      ssid,
      auth,
      enc,
      networkType,
      isHidden,
      signal: maxSignal,
      signalDbm: signalToDbm(maxSignal),
      channel,
      band,
      radioType: bestBssid.radioType ?? null,
      frequencyMhz: channelFrequencyMhz(channel, band),
      vendor: null,
      maxRateMbps: allRates.reduce((m, r) => Math.max(m, r), 0) || bestBssid.maxRateMbps || null,
      basicRates: bestBssid.basicRates || [],
      otherRates: bestBssid.otherRates || [],
      bssidCount: bssids.length,
      bssids,
    });
  }
  return networks;
}

/**
 * Parse `netsh wlan show profiles` stdout into a saved-profile name
 * array (the `All User Profile :` lines).
 */
function parseNetshListProfiles(raw) {
  if (!raw) return [];
  const matches = String(raw).matchAll(/All User Profile\s*:\s*(.+)/g);
  return [...matches].map((m) => m[1].trim()).filter(Boolean);
}

/**
 * Parse `netsh wlan show interfaces` stdout into the detail shape the
 * renderer's WifiSelector WifiDetail interface expects. Field extraction
 * is independent of the IP/gateway/netmask enrichment, which main.js
 * still does via os.networkInterfaces()/PowerShell.
 */
function parseNetshGetDetail(raw) {
  if (!raw) return null;
  const text = String(raw);

  const field = (label) => {
    // netsh labels contain regex metacharacters (e.g. "Receive rate (Mbps)"),
    // so escape them before building the matcher.
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = text.match(new RegExp(`^\\s+${escaped}\\s*:\\s*(.+)`, 'm'));
    return m ? m[1].trim() : null;
  };
  const intField = (label) => {
    const v = field(label);
    return v ? parseInt(v, 10) : null;
  };

  const stateRaw = field('State');
  const state = stateRaw ? (stateRaw.toLowerCase().includes('connect') ? 'connected' : 'disconnected') : null;
  const channel = intField('Channel');
  const radioType = field('Radio type');
  const signal = intField('Signal');
  const rxMbpsRaw = field('Receive rate (Mbps)');
  const txMbpsRaw = field('Transmit rate (Mbps)');

  return {
    state,
    ssid: field('SSID'),
    bssid: field('BSSID'),
    signal,
    signalDbm: signalToDbm(signal),
    channel,
    band: channelBand(channel, radioType),
    radioType,
    auth: field('Authentication'),
    cipher: field('Cipher'),
    profile: field('Profile'),
    adapter: field('Description'),
    mac: field('Physical address'),
    rxMbps: rxMbpsRaw ? parseFloat(rxMbpsRaw) : null,
    txMbps: txMbpsRaw ? parseFloat(txMbpsRaw) : null,
  };
}

module.exports = {
  signalToDbm,
  channelBand,
  channelFrequencyMhz,
  parseNetshScanNetworks,
  parseNetshListProfiles,
  parseNetshGetDetail,
};
