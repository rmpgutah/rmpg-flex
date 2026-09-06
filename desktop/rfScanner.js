// ============================================================
// RMPG Flex — RF / Electronic Signal Scanner
// Passive scanning of WiFi APs, Bluetooth Classic, BLE, and
// cellular towers via OS-native commands.
//
// No active probing: we only read what devices broadcast. Caller
// receives normalized signal objects matching the signal_detections
// schema; IDs, phone numbers, and IMEIs of nearby devices are NOT
// capturable here (those require IMSI-catcher hardware).
//
// Platform support:
//   WiFi   : Windows (netsh), macOS (airport), Linux (nmcli)
//   BT/BLE : Windows (PowerShell WinRT), macOS (system_profiler)
//   Cell   : submitted by mobile clients only (desktop has no radio)
// ============================================================

'use strict';

const { exec, execFile } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ── OUI vendor lookup (first 3 MAC octets → vendor) ──────────────────
// Top ~120 prefixes covering >90 % of real-world devices.
// Full IEEE registry: https://regauth.standards.ieee.org/standards-ra-web/pub/view.html#registries
const OUI_TABLE = {
  '00:00:0C': 'Cisco', '00:0E:8F': 'Cisco', '00:1B:D4': 'Cisco',
  '00:17:F2': 'Apple', '00:1C:B3': 'Apple', '00:23:12': 'Apple',
  '00:25:BC': 'Apple', '04:52:F3': 'Apple', '04:54:53': 'Apple',
  '08:6D:41': 'Apple', '0C:4D:E9': 'Apple', '10:40:F3': 'Apple',
  '14:8F:C6': 'Apple', '18:65:90': 'Apple', '1C:91:48': 'Apple',
  '20:76:8F': 'Apple', '24:A0:74': 'Apple', '28:37:37': 'Apple',
  '2C:F0:EE': 'Apple', '34:08:BC': 'Apple', '38:CA:DA': 'Apple',
  '3C:06:30': 'Apple', '40:CB:C0': 'Apple', '44:65:0D': 'Apple',
  '48:43:7C': 'Apple', '4C:57:CA': 'Apple', '54:72:4F': 'Apple',
  '58:B1:0A': 'Apple', '60:F4:45': 'Apple', '64:A3:CB': 'Apple',
  '68:96:7B': 'Apple', '6C:40:08': 'Apple', '70:3E:AC': 'Apple',
  '74:8D:08': 'Apple', '78:4F:43': 'Apple', '7C:04:D0': 'Apple',
  '80:82:23': 'Apple', '84:78:8B': 'Apple', '88:19:08': 'Apple',
  '8C:7B:9D': 'Apple', '90:27:E4': 'Apple', '94:BF:2D': 'Apple',
  'A4:C3:F0': 'Apple', 'A8:51:AB': 'Apple', 'AC:CF:85': 'Apple',
  'B0:34:95': 'Apple', 'BC:52:B7': 'Apple', 'C0:9F:42': 'Apple',
  'C4:B3:01': 'Apple', 'C8:BC:C8': 'Apple', 'CC:08:8D': 'Apple',
  'D0:03:4B': 'Apple', 'D4:61:9D': 'Apple', 'D8:1D:72': 'Apple',
  'DC:A4:CA': 'Apple', 'E0:AC:CB': 'Apple', 'E4:98:D6': 'Apple',
  'E8:06:88': 'Apple', 'EC:35:86': 'Apple', 'F0:99:BF': 'Apple',
  'F4:1B:A1': 'Apple', 'F8:27:93': 'Apple', 'FC:25:3F': 'Apple',

  '00:15:5D': 'Microsoft', '28:18:78': 'Microsoft', '3C:83:75': 'Microsoft',
  '54:EE:75': 'Microsoft', '7C:1E:52': 'Microsoft', '9C:B6:D0': 'Microsoft',

  '00:21:70': 'Samsung', '00:26:5F': 'Samsung', '08:D4:6A': 'Samsung',
  '10:D5:42': 'Samsung', '18:3A:2D': 'Samsung', '1C:62:B8': 'Samsung',
  '20:64:32': 'Samsung', '24:4B:81': 'Samsung', '28:98:7B': 'Samsung',
  '34:14:5F': 'Samsung', '38:AA:3C': 'Samsung', '40:0E:85': 'Samsung',
  '44:F4:59': 'Samsung', '4C:3C:16': 'Samsung', '50:01:BB': 'Samsung',
  '54:88:0E': 'Samsung', '58:CB:52': 'Samsung', '5C:3C:27': 'Samsung',
  '60:6B:BD': 'Samsung', '64:B8:53': 'Samsung', '68:27:37': 'Samsung',
  '6C:F3:73': 'Samsung', '70:F0:27': 'Samsung', '74:E1:4A': 'Samsung',
  '78:1F:DB': 'Samsung', '7C:0B:C6': 'Samsung', '80:65:6D': 'Samsung',
  '84:25:DB': 'Samsung', '88:83:22': 'Samsung', '8C:71:F8': 'Samsung',

  '00:24:D7': 'Google', '08:9E:08': 'Google', '14:7D:C5': 'Google',
  '1C:F2:9A': 'Google', '20:DF:B9': 'Google', '48:D6:D5': 'Google',
  '54:60:09': 'Google', 'A4:77:33': 'Google', 'F4:F5:D8': 'Google',

  '00:23:14': 'Intel', '00:27:10': 'Intel', '00:AA:01': 'Intel',
  '10:02:B5': 'Intel', '18:67:B0': 'Intel', '28:D2:44': 'Intel',
  '34:02:86': 'Intel', '40:A5:EF': 'Intel', '48:45:20': 'Intel',
  '54:27:1E': 'Intel', '60:57:18': 'Intel', '68:5D:43': 'Intel',
  '78:92:9C': 'Intel', '8C:8D:28': 'Intel', 'A0:A8:CD': 'Intel',
  'B0:35:9F': 'Intel', 'B8:E8:56': 'Intel', 'C4:D9:87': 'Intel',

  '00:0B:86': 'Aruba', '00:1A:1E': 'Aruba', '20:4C:03': 'Aruba',
  '24:DE:C6': 'Aruba', '40:E3:D6': 'Aruba', '6C:F3:7F': 'Aruba',
  '84:D4:7E': 'Aruba', '94:B4:0F': 'Aruba', 'B0:B8:67': 'Aruba',
  'D8:C7:C8': 'Aruba',

  '00:18:0A': 'Ubiquiti', '00:27:22': 'Ubiquiti', '04:18:D6': 'Ubiquiti',
  '18:E8:29': 'Ubiquiti', '24:A4:3C': 'Ubiquiti', '44:D9:E7': 'Ubiquiti',
  '68:72:51': 'Ubiquiti', '78:45:58': 'Ubiquiti', '80:2A:A8': 'Ubiquiti',
  'B4:FB:E4': 'Ubiquiti', 'DC:9F:DB': 'Ubiquiti', 'F0:9F:C2': 'Ubiquiti',

  '00:17:88': 'Philips (Hue)', '00:1A:C5': 'Belkin', '20:F3:A3': 'Belkin',
  'EC:1A:59': 'Belkin',

  '00:0F:AC': 'Qualcomm', '00:0F:E0': 'Qualcomm', '00:17:C9': 'Qualcomm',

  '18:B4:30': 'Nest', '64:16:66': 'Nest', '18:B4:30': 'Nest',

  '74:75:48': 'Amazon', 'A4:08:01': 'Amazon', 'FC:A1:83': 'Amazon',
  'B4:7C:9C': 'Amazon', '40:B4:CD': 'Amazon',

  '00:0C:E7': 'Motorola', '00:17:C9': 'Motorola', '58:40:4E': 'Motorola',
  '84:10:0D': 'Motorola',

  '00:1E:65': 'Xiaomi', '00:EC:0A': 'Xiaomi', '10:2A:B3': 'Xiaomi',
  '28:6C:07': 'Xiaomi', '34:80:B3': 'Xiaomi', '58:44:98': 'Xiaomi',
  '64:09:80': 'Xiaomi', '74:23:44': 'Xiaomi', '78:11:DC': 'Xiaomi',

  '00:24:E4': 'Withings', '00:1C:23': 'Dell', '00:21:9B': 'Dell',
  '00:23:AE': 'Dell', '14:FE:B5': 'Dell', '18:66:DA': 'Dell',
  '28:F1:0E': 'Dell', '34:E6:D7': 'Dell', '84:7B:EB': 'Dell',
  'B0:83:FE': 'Dell', 'F0:4D:A2': 'Dell',

  '00:22:90': 'Netgear', '20:4E:7F': 'Netgear', '28:28:5D': 'Netgear',
  '30:46:9A': 'Netgear', '44:94:FC': 'Netgear', '6C:B0:CE': 'Netgear',
  '84:1B:5E': 'Netgear', 'A0:21:B7': 'Netgear', 'C0:3F:0E': 'Netgear',
  'E0:46:9A': 'Netgear', 'E4:F4:C6': 'Netgear',

  '00:90:4C': 'Epigram (Broadcom)', '00:1A:73': 'Ralink (MediaTek)',
  'C8:3A:35': 'Tenda', '00:26:18': 'Actiontec', '00:12:3F': 'Wistron',
};

/**
 * Look up vendor from the first 3 octets of a MAC address.
 * Input may be colon- or dash-separated (normalised to colons, upper-cased).
 */
function lookupVendor(mac) {
  if (!mac || typeof mac !== 'string') return 'Unknown';
  const normalised = mac.toUpperCase().replace(/-/g, ':');
  const prefix = normalised.slice(0, 8); // e.g. "AA:BB:CC"
  return OUI_TABLE[prefix] ?? 'Unknown';
}

// ── BLE Bluetooth SIG Company ID → manufacturer name ────────────────
const BLE_COMPANY_TABLE = {
  0x0006: 'Microsoft', 0x000D: 'Texas Instruments', 0x000F: 'Broadcom',
  0x0013: 'Atmel', 0x001D: 'Qualcomm', 0x002D: 'Bose',
  0x004C: 'Apple', 0x0059: 'Nordic Semiconductor', 0x005D: 'Realtek',
  0x0075: 'Samsung', 0x0078: 'Nike', 0x0087: 'Garmin',
  0x00E0: 'Google', 0x00D2: 'Dialog Semiconductor', 0x0157: 'Huawei',
  0x0171: 'Amazon', 0x01A7: 'Cypress', 0x0310: 'Xiaomi',
  0x038F: 'Tile', 0x0499: 'Ruuvi Innovations', 0x02E5: 'Espressif',
  0x0822: 'Adafruit', 0x0046: 'MediaTek', 0x000A: 'Qualcomm CSR',
  0x0001: 'Nokia', 0x0002: 'Intel', 0x0003: 'IBM', 0x0008: 'Motorola',
  0x000E: 'Ericsson', 0x0038: 'Plantronics', 0x004F: 'Continental Auto',
  0x0056: 'Sony', 0x0057: 'Harman International', 0x005A: 'Beats',
  0x0060: 'GN Audio (Jabra)', 0x0067: 'JBL', 0x0076: 'LG Electronics',
  0x0080: 'Johnson Controls', 0x0089: 'Ring', 0x008C: 'Sonos',
  0x009E: 'Bose Corp', 0x00AA: 'Peloton', 0x00AB: 'SimpliSafe',
  0x00B0: 'Ember Technologies', 0x00FF: 'Logitech',
  0x0131: 'Shenzhen Goodix', 0x02D5: 'Oura', 0x030B: 'Anker',
  0x0388: 'Govee', 0x0473: 'Wyze Labs', 0x0590: 'Eufy',
  0x0672: 'Govee', 0x0822: 'Adafruit Industries',
};

function lookupBleMfg(companyId) {
  if (companyId == null) return null;
  return BLE_COMPANY_TABLE[companyId] ?? null;
}

// ── NetBIOS suffix code descriptions ────────────────────────────────
const NB_SUFFIX = {
  '00': 'Workstation', '03': 'Messenger', '06': 'RAS Server',
  '1B': 'Domain Master Browser', '1C': 'Domain Controller', '1D': 'Master Browser',
  '1E': 'Browser Election', '1F': 'NetDDE', '20': 'File Server',
  '21': 'RAS Client', '22': 'Exchange Interchange', '23': 'Exchange Store',
  '24': 'Exchange Directory', '2B': 'Lotus Notes Server',
  '2F': 'Lotus Notes', '30': 'Modem Sharing Server',
  '31': 'Modem Sharing Client', '33': 'SMS Clients Remote Control',
  '43': 'SMS Admin Remote Control', '44': 'SMS Clients Remote Chat',
  '45': 'SMS Clients Remote Transfer', '46': 'SMS Clients Remote Tools',
  '4C': 'DEC Pathworks TCPIP', '52': 'DEC Pathworks TCPIP',
  '87': 'Exchange MTA', '6A': 'Exchange IMC',
  'BE': 'Network Monitor Agent', 'BF': 'Network Monitor App',
};

/**
 * Convert WiFi signal percentage (0-100) to approximate RSSI dBm.
 * Windows `netsh` reports signal as %; IEEE formula: dBm = (pct / 2) - 100.
 */
function pctToDbm(pct) {
  if (pct == null) return null;
  return Math.round((Number(pct) / 2) - 100);
}

/**
 * Estimate distance from RSSI using the log-distance path loss model.
 * txPower = measured power at 1 m (default -59 dBm for typical APs/phones).
 * n = path-loss exponent (2 = free space; 2.7 indoor; 3.5 obstructed).
 */
function rssiToMetres(rssi, txPower = -59, n = 2.7) {
  if (rssi == null) return null;
  return Math.round(Math.pow(10, (txPower - rssi) / (10 * n)) * 10) / 10;
}

/**
 * Determine band from frequency in MHz.
 */
function freqToBand(mhz) {
  if (!mhz) return 'unknown';
  const f = Number(mhz);
  if (f < 2500) return '2.4';
  if (f < 6000) return '5';
  return '6';
}

/**
 * Map channel number to approximate centre frequency.
 */
function channelToMhz(ch) {
  const n = Number(ch);
  if (!n) return null;
  if (n >= 1 && n <= 14) return 2407 + n * 5;   // 2.4 GHz
  if (n >= 36 && n <= 165) return 5000 + n * 5; // 5 GHz
  if (n >= 1 && n <= 233) return 5950 + n * 5;  // 6 GHz (Wi-Fi 6E)
  return null;
}

// ── WiFi scanning ────────────────────────────────────────────────────

/**
 * Scan WiFi networks and return an array of normalised wifi_ap objects.
 * Resolves to [] if scanning isn't supported or the command fails.
 */
async function scanWifi() {
  const platform = os.platform();
  try {
    if (platform === 'win32') return await scanWifiWindows();
    if (platform === 'darwin') return await scanWifiMacos();
    if (platform === 'linux') return await scanWifiLinux();
  } catch (err) {
    console.warn('[rfScanner] wifi scan failed:', err && err.message);
  }
  return [];
}

function scanWifiWindows() {
  return new Promise((resolve) => {
    exec('netsh wlan show networks mode=bssid', { timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      resolve(parseNetsh(stdout));
    });
  });
}

function parseNetsh(raw) {
  const results = [];
  // Split on "SSID \d+ :" blocks
  const blocks = raw.split(/(?=^SSID \d+ :)/m).filter(b => b.trim().startsWith('SSID'));

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const get = (key) => {
      const line = lines.find(l => l.trim().startsWith(key));
      return line ? line.split(':').slice(1).join(':').trim() : null;
    };
    const ssid = get('SSID') && !get('SSID').startsWith('BSSID') ? get('SSID') : null;
    const secType = get('Authentication') ?? get('Security');
    const cipher = get('Encryption');
    const networkType = get('Network type');

    // Pull out BSSID sub-blocks (there may be multiple per SSID)
    const bssidBlocks = block.split(/(?=\s+BSSID \d+ :)/);
    for (let i = 1; i < bssidBlocks.length; i++) {
      const bb = bssidBlocks[i].split(/\r?\n/);
      const bget = (key) => {
        const l = bb.find(l => l.trim().startsWith(key));
        return l ? l.split(':').slice(1).join(':').trim() : null;
      };
      const bssidLine = bb[0] ? bb[0].split(':').slice(1).join(':').trim() : null;
      const bssid = bssidLine ? bssidLine.trim() : null;
      const signalPct = bget('Signal') ? parseInt(bget('Signal')) : null;
      const radioType = bget('Radio type') ?? bget('Radio Type');
      const channelStr = bget('Channel');
      const channel = channelStr ? parseInt(channelStr) : null;
      const freqMhz = channelToMhz(channel);
      const rssiDbm = signalPct != null ? pctToDbm(signalPct) : null;
      const vendor = bssid ? lookupVendor(bssid) : 'Unknown';

      if (!bssid) continue;

      results.push({
        signal_type: 'wifi_ap',
        identifier: bssid.toLowerCase(),
        display_name: ssid ?? '(hidden)',
        rssi_dbm: rssiDbm,
        signal_pct: signalPct,
        tx_power_dbm: null,
        distance_estimate_m: rssiDbm != null ? rssiToMetres(rssiDbm) : null,
        properties: {
          // ── 50 signal intelligence fields ─────────────────────────────
          // WiFi AP group (18 fields)
          ssid: ssid,
          bssid: bssid,
          channel: channel,
          frequency_mhz: freqMhz,
          band: freqToBand(freqMhz),
          security_type: secType ?? 'Unknown',
          cipher_suite: cipher ?? 'Unknown',
          auth_suite: secType ?? 'Unknown',
          wps_enabled: null,         // netsh doesn't expose this directly
          hidden: !ssid,
          vendor: vendor,
          network_type: networkType ?? 'Infrastructure',
          radio_type: radioType ?? null,
          max_data_rate_mbps: null,  // not in basic netsh output
          beacon_interval_ms: null,
          supported_rates: null,
          country_code: null,
          channel_utilization_pct: null,
        },
      });
    }
  }
  return results;
}

function scanWifiMacos() {
  return new Promise((resolve) => {
    // airport utility — deprecated in macOS 14+ but still present
    const airportPath = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport';
    exec(`"${airportPath}" -s`, { timeout: 12000, encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      resolve(parseAirport(stdout));
    });
  });
}

function parseAirport(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  // Skip header
  const dataLines = lines.filter(l => !l.trim().startsWith('SSID'));
  const results = [];
  for (const line of dataLines) {
    // Format: SSID  BSSID  RSSI  CHANNEL  HT  CC  SECURITY
    //          some ssid  aa:bb:cc:dd:ee:ff  -70  6  Y  US  WPA2
    const match = line.match(/^(.+?)\s{2,}([\da-fA-F:]{17})\s+(-\d+)\s+(\d+[^,\s]*)\s+/);
    if (!match) continue;
    const [, ssid, bssid, rssiStr, channelStr] = match;
    const rssiDbm = parseInt(rssiStr);
    const channel = parseInt(channelStr);
    const freqMhz = channelToMhz(channel);
    const vendor = lookupVendor(bssid);
    // Security is at the end
    const parts = line.trim().split(/\s+/);
    const security = parts[parts.length - 1] ?? 'Unknown';

    results.push({
      signal_type: 'wifi_ap',
      identifier: bssid.toLowerCase(),
      display_name: ssid.trim(),
      rssi_dbm: rssiDbm,
      signal_pct: Math.min(100, Math.max(0, (rssiDbm + 100) * 2)),
      tx_power_dbm: null,
      distance_estimate_m: rssiToMetres(rssiDbm),
      properties: {
        ssid: ssid.trim(), bssid, channel, frequency_mhz: freqMhz,
        band: freqToBand(freqMhz), security_type: security,
        cipher_suite: null, auth_suite: security,
        wps_enabled: null, hidden: false, vendor,
        network_type: 'Infrastructure', radio_type: null,
        max_data_rate_mbps: null, beacon_interval_ms: null,
        supported_rates: null, country_code: null, channel_utilization_pct: null,
      },
    });
  }
  return results;
}

function scanWifiLinux() {
  return new Promise((resolve) => {
    // nmcli with tabular output
    exec(
      'nmcli -t -f SSID,BSSID,SIGNAL,CHAN,SECURITY,FREQ device wifi list',
      { timeout: 12000, encoding: 'utf8' },
      (err, stdout) => {
        if (err || !stdout) { resolve([]); return; }
        const results = [];
        for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
          const parts = line.split(':');
          if (parts.length < 5) continue;
          const [ssid, bssid, signalPct, chan, security, freqRaw] = parts;
          const pct = parseInt(signalPct);
          const rssiDbm = pctToDbm(pct);
          const channel = parseInt(chan);
          const freqMhz = freqRaw ? parseInt(freqRaw.replace(/\D/g, '')) : channelToMhz(channel);
          results.push({
            signal_type: 'wifi_ap',
            identifier: bssid.toLowerCase().replace(/\\\:/g, ':'),
            display_name: ssid ?? '(hidden)',
            rssi_dbm: rssiDbm,
            signal_pct: pct,
            tx_power_dbm: null,
            distance_estimate_m: rssiToMetres(rssiDbm),
            properties: {
              ssid: ssid || null, bssid: bssid.replace(/\\\:/g, ':'),
              channel, frequency_mhz: freqMhz, band: freqToBand(freqMhz),
              security_type: security ?? 'Unknown', cipher_suite: null,
              auth_suite: security ?? 'Unknown', wps_enabled: null,
              hidden: !ssid, vendor: lookupVendor(bssid),
              network_type: 'Infrastructure', radio_type: null,
              max_data_rate_mbps: null, beacon_interval_ms: null,
              supported_rates: null, country_code: null, channel_utilization_pct: null,
            },
          });
        }
        resolve(results);
      }
    );
  });
}

// ── Bluetooth scanning ───────────────────────────────────────────────

/**
 * Bluetooth device category from Windows device class hex code.
 * See Bluetooth Assigned Numbers spec, §3.3.
 */
function btClassToCategory(classHex) {
  if (!classHex) return 'Unknown';
  const cls = parseInt(classHex, 16);
  const major = (cls >> 8) & 0x1F;
  const majorNames = {
    0: 'Miscellaneous', 1: 'Computer', 2: 'Phone', 3: 'Network Access Point',
    4: 'Audio/Video', 5: 'Peripheral', 6: 'Imaging', 7: 'Wearable',
    8: 'Toy', 9: 'Health',
  };
  return majorNames[major] ?? 'Uncategorized';
}

function btClassToSubcategory(classHex) {
  if (!classHex) return null;
  const cls = parseInt(classHex, 16);
  const major = (cls >> 8) & 0x1F;
  const minor = (cls >> 2) & 0x3F;
  if (major === 1) { // Computer
    return ['Unspecified','Desktop','Server','Laptop','Handheld','Palm','Wearable'][minor] ?? null;
  }
  if (major === 2) { // Phone
    return ['Unspecified','Cellular','Cordless','Smartphone','Modem','ISDN'][minor] ?? null;
  }
  if (major === 4) { // Audio/Video
    return ['Unspecified','Headset','Hands-free','Microphone','Loudspeaker',
            'Headphones','Portable Audio','Car Audio','Set-top Box',
            'HiFi Audio','VCR','Camcorder','Webcam','Video Monitor',
            'Video Display/Loudspeaker','Video Conferencing','Unclassified',
            'Gaming/Toy'][minor] ?? null;
  }
  return null;
}

async function scanBluetooth() {
  const platform = os.platform();
  try {
    if (platform === 'win32') return await scanBluetoothWindows();
    if (platform === 'darwin') return await scanBluetoothMacos();
  } catch (err) {
    console.warn('[rfScanner] BT scan failed:', err && err.message);
  }
  return [];
}

function scanBluetoothWindows() {
  // Use PowerShell to enumerate nearby BT devices visible to Windows.
  // This includes both paired and recently-seen (cached) devices.
  const script = `
$ErrorActionPreference = 'SilentlyContinue';
$devs = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue;
if (-not $devs) { Write-Output '[]'; exit }
$out = @();
foreach ($d in $devs) {
  if ($d.InstanceId -notmatch 'BTHENUM') { continue }
  $mac = '';
  if ($d.DeviceID -match '([0-9A-F]{12})') { $m = $Matches[1]; $mac = ($m -replace '(..)','$1:').TrimEnd(':') }
  $out += @{name=$d.FriendlyName; mac=$mac; status=$d.Status; instanceId=$d.DeviceID}
}
$out | ConvertTo-Json -Compress
`;
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -NonInteractive -Command "${script.replace(/\r?\n/g, ' ')}"`,
      { timeout: 15000, encoding: 'utf8' },
      (err, stdout) => {
        if (err || !stdout) { resolve([]); return; }
        let parsed = [];
        try { parsed = JSON.parse(stdout.trim()); } catch { resolve([]); return; }
        if (!Array.isArray(parsed)) parsed = [parsed];
        const results = [];
        for (const d of parsed) {
          if (!d || !d.name) continue;
          const mac = d.mac ? d.mac.toUpperCase() : null;
          // Estimate RSSI isn't available from PnP enumeration; paired devices show as connected
          results.push({
            signal_type: 'bt_classic',
            identifier: mac ? mac.toLowerCase() : `win-${d.instanceId}`,
            display_name: d.name,
            rssi_dbm: null,
            signal_pct: null,
            tx_power_dbm: null,
            distance_estimate_m: null,
            properties: {
              bt_name: d.name,
              bt_mac: mac,
              bt_class_hex: null,
              bt_device_category: 'Unknown',
              bt_device_subcategory: null,
              bt_vendor: mac ? lookupVendor(mac) : 'Unknown',
              bt_connectable: d.status === 'OK',
              bt_paired: true,
              bt_services: [],
              bt_version: null,
              bt_lmp_version: null,
              bt_manufacturer_id: null,
              // BLE-specific (null for classic)
              ble_mac_type: null, ble_service_uuids: null,
              ble_manufacturer_id: null, ble_manufacturer_name: null,
              ble_appearance_category: null, ble_advertisement_interval_ms: null,
              ble_manufacturer_data_hex: null, ble_service_data: null,
              ble_flags: null, ble_complete_local_name: null,
            },
          });
        }
        resolve(results);
      }
    );
  });
}

function scanBluetoothMacos() {
  return new Promise((resolve) => {
    exec('system_profiler SPBluetoothDataType -json', { timeout: 15000, encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      let profiler;
      try { profiler = JSON.parse(stdout); } catch { resolve([]); return; }

      const btData = profiler.SPBluetoothDataType?.[0];
      if (!btData) { resolve([]); return; }

      const results = [];
      const processDevice = (name, info, paired) => {
        const mac = info['device_address'] ?? info['device_minorClassOfDevice_string'] ?? null;
        const rssi = info['device_rssi'] ? parseInt(info['device_rssi']) : null;
        const classHex = info['device_classOfDevice'] ?? null;
        results.push({
          signal_type: 'bt_classic',
          identifier: mac ? mac.toLowerCase() : `macos-${name}`,
          display_name: name,
          rssi_dbm: rssi,
          signal_pct: rssi != null ? Math.min(100, Math.max(0, (rssi + 100) * 2)) : null,
          tx_power_dbm: null,
          distance_estimate_m: rssi != null ? rssiToMetres(rssi) : null,
          properties: {
            bt_name: name,
            bt_mac: mac,
            bt_class_hex: classHex,
            bt_device_category: btClassToCategory(classHex),
            bt_device_subcategory: btClassToSubcategory(classHex),
            bt_vendor: mac ? lookupVendor(mac) : 'Unknown',
            bt_connectable: info['device_isconnected'] === 'attrib_Yes',
            bt_paired: paired,
            bt_services: info['device_services'] ? [info['device_services']] : [],
            bt_version: info['device_bluetoothVersionNumber'] ?? null,
            bt_lmp_version: null,
            bt_manufacturer_id: null,
            ble_mac_type: null, ble_service_uuids: null,
            ble_manufacturer_id: null, ble_manufacturer_name: null,
            ble_appearance_category: null, ble_advertisement_interval_ms: null,
            ble_manufacturer_data_hex: null, ble_service_data: null,
            ble_flags: null, ble_complete_local_name: null,
          },
        });
      };

      const connectedDevices = btData['device_title'] ?? btData['devices_list'] ?? {};
      for (const [name, info] of Object.entries(connectedDevices)) {
        if (typeof info === 'object') processDevice(name, info, true);
      }
      const nearbyDevices = btData['nearby_devices'] ?? {};
      for (const [name, info] of Object.entries(nearbyDevices)) {
        if (typeof info === 'object') processDevice(name, info, false);
      }
      resolve(results);
    });
  });
}

// ── BLE advertisement scanning ──────────────────────────────────────

async function scanBle() {
  const platform = os.platform();
  try {
    if (platform === 'win32') return await scanBleWindows();
    if (platform === 'darwin') return await scanBleMacos();
  } catch (err) {
    console.warn('[rfScanner] BLE scan failed:', err && err.message);
  }
  return [];
}

function scanBleWindows() {
  const scriptContent = `
$ErrorActionPreference = 'SilentlyContinue'
try {
  [void][Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher,Windows.Devices.Bluetooth.Advertisement,ContentType=WindowsRuntime]
  $w = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher]::new()
  $w.ScanningMode = 1
  $d = [hashtable]::Synchronized(@{})
  $w.add_Received({
    param($s,$e)
    $a = $e.BluetoothAddress
    $m = '{0:X12}' -f $a
    $m = $m.Insert(10,':').Insert(8,':').Insert(6,':').Insert(4,':').Insert(2,':')
    $r = $e.RawSignalStrengthInDBm
    $n = $e.Advertisement.LocalName
    $sv = @()
    try { foreach($u in $e.Advertisement.ServiceUuids) { $sv += $u.ToString() } } catch {}
    $mf = @()
    try {
      foreach($x in $e.Advertisement.ManufacturerData) {
        $dr = [Windows.Storage.Streams.DataReader]::FromBuffer($x.Data)
        $b = New-Object byte[] $x.Data.Length
        $dr.ReadBytes($b)
        $mf += @{id=[int]$x.CompanyId; hex=($b|ForEach-Object{'{0:X2}'-f$_})-join''}
      }
    } catch {}
    $tp = $null
    try {
      foreach($ds in $e.Advertisement.DataSections) {
        if ($ds.DataType -eq 0x0A) {
          $dr2 = [Windows.Storage.Streams.DataReader]::FromBuffer($ds.Data)
          $v = $dr2.ReadByte()
          $tp = if($v -gt 127){[int]$v-256}else{[int]$v}
          break
        }
      }
    } catch {}
    $fl = $null
    try { $fl = [int]$e.Advertisement.Flags } catch {}
    $cn = ($e.AdvertisementType -eq 0) -or ($e.AdvertisementType -eq 1)
    $at = $e.AdvertisementType.ToString()
    $entry = @{mac=$m;name=$n;rssi=[int]$r;tx=$tp;svc=$sv;mfg=$mf;flags=$fl;conn=$cn;adv_type=$at}
    if (-not $d.ContainsKey($a) -or $r -gt $d[$a].rssi) {
      $prev = $d[$a]
      if ($prev -and -not $n -and $prev.name) { $entry.name = $prev.name }
      $d[$a] = $entry
    }
  })
  $w.Start()
  Start-Sleep -Seconds 5
  $w.Stop()
  Start-Sleep -Milliseconds 500
  $results = @($d.Values)
  if ($results.Count -eq 0) { Write-Output '[]' }
  else { $results | ConvertTo-Json -Depth 4 -Compress }
} catch {
  Write-Output '[]'
}
`.trim();
  const tmpScript = path.join(os.tmpdir(), `rmpg-ble-${Date.now()}.ps1`);
  return new Promise((resolve) => {
    try {
      fs.writeFileSync(tmpScript, scriptContent, 'utf8');
    } catch { resolve([]); return; }
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpScript}"`,
      { timeout: 20000, encoding: 'utf8' },
      (err, stdout) => {
        try { fs.unlinkSync(tmpScript); } catch {}
        if (err || !stdout) { resolve([]); return; }
        let parsed = [];
        try { parsed = JSON.parse(stdout.trim()); } catch { resolve([]); return; }
        if (!Array.isArray(parsed)) parsed = [parsed];
        const results = [];
        for (const d of parsed) {
          if (!d || !d.mac) continue;
          const mac = d.mac;
          const rssi = typeof d.rssi === 'number' ? d.rssi : null;
          const txPower = typeof d.tx === 'number' ? d.tx : null;
          const mfgId = d.mfg?.[0]?.id ?? null;
          results.push({
            signal_type: 'ble',
            identifier: mac.toLowerCase(),
            display_name: d.name || `BLE ${mac.substring(0, 8)}…`,
            rssi_dbm: rssi,
            signal_pct: rssi != null ? Math.min(100, Math.max(0, (rssi + 100) * 2)) : null,
            tx_power_dbm: txPower,
            distance_estimate_m: rssi != null ? rssiToMetres(rssi, txPower ?? -59) : null,
            properties: {
              ble_complete_local_name: d.name || null,
              ble_mac_type: null,
              ble_service_uuids: d.svc?.length ? d.svc : null,
              ble_manufacturer_id: mfgId,
              ble_manufacturer_name: lookupBleMfg(mfgId),
              ble_appearance_category: null,
              ble_advertisement_interval_ms: null,
              ble_connectable: d.conn ?? null,
              ble_manufacturer_data_hex: d.mfg?.[0]?.hex ?? null,
              ble_service_data: null,
              ble_flags: d.flags ?? null,
              bt_vendor: lookupVendor(mac),
            },
          });
        }
        resolve(results);
      }
    );
  });
}

function scanBleMacos() {
  return new Promise((resolve) => {
    exec('system_profiler SPBluetoothDataType -json', { timeout: 15000, encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      let profiler;
      try { profiler = JSON.parse(stdout); } catch { resolve([]); return; }
      const btData = profiler.SPBluetoothDataType?.[0];
      if (!btData) { resolve([]); return; }
      const results = [];
      const nearby = btData['nearby_devices'] ?? btData['device_not_paired'] ?? {};
      for (const [name, info] of Object.entries(nearby)) {
        if (typeof info !== 'object') continue;
        const isLe = (info['device_isLowEnergy'] === 'attrib_Yes' ||
                       info['device_minorType']?.includes('LE') ||
                       (info['device_classOfDevice'] == null && !info['device_services']));
        if (!isLe) continue;
        const mac = info['device_address'] ?? null;
        const rssi = info['device_rssi'] ? parseInt(info['device_rssi']) : null;
        results.push({
          signal_type: 'ble',
          identifier: mac ? mac.toLowerCase() : `macos-ble-${name}`,
          display_name: name,
          rssi_dbm: rssi,
          signal_pct: rssi != null ? Math.min(100, Math.max(0, (rssi + 100) * 2)) : null,
          tx_power_dbm: null,
          distance_estimate_m: rssi != null ? rssiToMetres(rssi) : null,
          properties: {
            ble_complete_local_name: name,
            ble_mac_type: null,
            ble_service_uuids: null,
            ble_manufacturer_id: null,
            ble_manufacturer_name: null,
            ble_appearance_category: info['device_minorType'] ?? null,
            ble_advertisement_interval_ms: null,
            ble_connectable: null,
            ble_manufacturer_data_hex: null,
            ble_service_data: null,
            ble_flags: null,
            bt_vendor: mac ? lookupVendor(mac) : 'Unknown',
          },
        });
      }
      resolve(results);
    });
  });
}

// ── ARP / NDP scan (local network devices) ──────────────────────────

async function scanArp() {
  const platform = os.platform();
  try {
    const cmd = platform === 'win32' ? 'arp -a' : 'arp -an';
    const { stdout } = await new Promise((resolve, reject) => {
      exec(cmd, { timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
        if (err) reject(err); else resolve({ stdout });
      });
    });
    if (!stdout) return [];
    const entries = [];
    const lines = stdout.split(/\r?\n/);
    let currentInterface = null;
    for (const line of lines) {
      const ifMatch = line.match(/Interface:\s*([\d.]+)\s*---\s*0x([0-9a-fA-F]+)/);
      if (ifMatch) { currentInterface = ifMatch[1]; continue; }
      const match = platform === 'win32'
        ? line.match(/^\s*([\d.]+)\s+([\da-f:-]+)\s+(\w+)/i)
        : line.match(/\(([\d.]+)\)\s+at\s+([\da-f:]+)(?:\s+on\s+(\S+))?/i);
      if (!match) continue;
      const ip = match[1];
      const mac = match[2].toUpperCase().replace(/-/g, ':');
      if (mac === 'FF:FF:FF:FF:FF:FF' || ip === '255.255.255.255') continue;
      if (mac === '00:00:00:00:00:00') continue;
      const arpType = platform === 'win32' ? (match[3] ?? 'dynamic') : 'dynamic';
      const iface = platform === 'win32' ? currentInterface : (match[3] ?? null);
      entries.push({ ip, mac, arpType, iface });
    }

    // Batch hostname resolution (parallel, 2s timeout each)
    const hostnameMap = new Map();
    const dnsCmd = platform === 'win32'
      ? (ip) => `powershell -NoProfile -Command "(Resolve-DnsName -Name '${ip}' -Type PTR -DnsOnly -ErrorAction SilentlyContinue).NameHost"`
      : (ip) => `host -W 2 ${ip} 2>/dev/null`;
    const hostPromises = entries.slice(0, 50).map(({ ip }) =>
      new Promise((resolve) => {
        exec(dnsCmd(ip), { timeout: 3000, encoding: 'utf8' }, (err, stdout) => {
          if (err || !stdout) { resolve(null); return; }
          const hostname = platform === 'win32'
            ? stdout.trim()
            : (stdout.match(/domain name pointer\s+(\S+)/i)?.[1]?.replace(/\.$/, '') ?? null);
          if (hostname) hostnameMap.set(ip, hostname);
          resolve(hostname);
        });
      })
    );
    await Promise.allSettled(hostPromises);

    return entries.map(({ ip, mac, arpType, iface }) => {
      const hostname = hostnameMap.get(ip) ?? null;
      const vendor = lookupVendor(mac);
      const name = hostname || `${ip} (${vendor})`;
      return {
        signal_type: 'arp_device',
        identifier: mac.toLowerCase(),
        display_name: name,
        rssi_dbm: null,
        signal_pct: null,
        tx_power_dbm: null,
        distance_estimate_m: null,
        properties: {
          ip_address: ip,
          mac_address: mac,
          vendor,
          hostname,
          arp_type: arpType,
          interface_name: iface,
          is_gateway: ip.endsWith('.1') || ip.endsWith('.254'),
        },
      };
    });
  } catch (err) {
    console.warn('[rfScanner] ARP scan failed:', err && err.message);
    return [];
  }
}

// ── SSDP / UPnP scan ────────────────────────────────────────────────

function fetchSsdpXml(locationUrl) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2500);
    try {
      const parsed = new URL(locationUrl);
      if (parsed.protocol !== 'http:') { clearTimeout(timer); resolve(null); return; }
      http.get(locationUrl, { timeout: 2000 }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; if (data.length > 65536) res.destroy(); });
        res.on('end', () => {
          clearTimeout(timer);
          const get = (tag) => {
            const m = data.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
            return m ? m[1].trim() : null;
          };
          resolve({
            friendlyName: get('friendlyName'),
            manufacturer: get('manufacturer'),
            manufacturerURL: get('manufacturerURL'),
            modelName: get('modelName'),
            modelNumber: get('modelNumber'),
            modelDescription: get('modelDescription'),
            serialNumber: get('serialNumber'),
            UDN: get('UDN'),
            deviceType: get('deviceType'),
            presentationURL: get('presentationURL'),
          });
        });
      }).on('error', () => { clearTimeout(timer); resolve(null); })
        .on('timeout', function () { this.destroy(); clearTimeout(timer); resolve(null); });
    } catch { clearTimeout(timer); resolve(null); }
  });
}

async function scanSsdp() {
  try {
    const dgram = require('dgram');
    const SSDP_ADDR = '239.255.255.250';
    const SSDP_PORT = 1900;
    const SEARCH = 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: ssdp:all\r\n\r\n';
    const rawDevices = await new Promise((resolve) => {
      const devices = new Map();
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (msg, rinfo) => {
        const text = msg.toString('utf8');
        const loc = (text.match(/LOCATION:\s*(.+)/i) || [])[1]?.trim();
        const server = (text.match(/SERVER:\s*(.+)/i) || [])[1]?.trim();
        const usn = (text.match(/USN:\s*(.+)/i) || [])[1]?.trim();
        const st = (text.match(/ST:\s*(.+)/i) || [])[1]?.trim();
        const cacheControl = (text.match(/CACHE-CONTROL:\s*(.+)/i) || [])[1]?.trim();
        const key = usn || `${rinfo.address}:${loc || ''}`;
        if (!devices.has(key)) {
          devices.set(key, { key, ip: rinfo.address, port: rinfo.port, loc, server, usn, st, cacheControl });
        }
      });
      sock.on('error', () => { sock.close(); resolve([]); });
      sock.bind(() => {
        try { sock.addMembership(SSDP_ADDR); } catch {}
        sock.send(Buffer.from(SEARCH), SSDP_PORT, SSDP_ADDR);
        setTimeout(() => { sock.close(); resolve([...devices.values()]); }, 4000);
      });
    });

    // Fetch XML device descriptions in parallel (max 15 concurrent)
    const xmlFetches = rawDevices.slice(0, 15).map(async (d) => {
      const xml = d.loc ? await fetchSsdpXml(d.loc) : null;
      return { ...d, xml };
    });
    const enriched = await Promise.allSettled(xmlFetches);

    return enriched
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .map((d) => ({
        signal_type: 'ssdp_device',
        identifier: d.key,
        display_name: d.xml?.friendlyName || d.server || d.loc || d.ip,
        rssi_dbm: null, signal_pct: null, tx_power_dbm: null, distance_estimate_m: null,
        properties: {
          ip_address: d.ip,
          port: d.port,
          location: d.loc,
          server: d.server,
          usn: d.usn,
          search_target: d.st,
          cache_control: d.cacheControl,
          friendly_name: d.xml?.friendlyName ?? null,
          manufacturer: d.xml?.manufacturer ?? null,
          manufacturer_url: d.xml?.manufacturerURL ?? null,
          model_name: d.xml?.modelName ?? null,
          model_number: d.xml?.modelNumber ?? null,
          model_description: d.xml?.modelDescription ?? null,
          serial_number: d.xml?.serialNumber ?? null,
          udn: d.xml?.UDN ?? null,
          device_type: d.xml?.deviceType ?? null,
          presentation_url: d.xml?.presentationURL ?? null,
        },
      }));
  } catch (err) {
    console.warn('[rfScanner] SSDP scan failed:', err && err.message);
    return [];
  }
}

// ── mDNS scan ────────────────────────────────────────────────────────

// ── DNS response parser for mDNS ────────────────────────────────────

const DNS_TYPE = { A: 1, NS: 2, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 };

function readDnsName(buf, offset) {
  const parts = [];
  let jumped = false;
  let returnOffset = offset;
  const seen = new Set();
  while (offset < buf.length) {
    const len = buf[offset];
    if (len === 0) { if (!jumped) returnOffset = offset + 1; break; }
    if ((len & 0xC0) === 0xC0) {
      if (offset + 1 >= buf.length) break;
      const ptr = ((len & 0x3F) << 8) | buf[offset + 1];
      if (seen.has(ptr)) break;
      seen.add(ptr);
      if (!jumped) returnOffset = offset + 2;
      offset = ptr;
      jumped = true;
      continue;
    }
    offset++;
    if (offset + len > buf.length) break;
    parts.push(buf.slice(offset, offset + len).toString('utf8'));
    offset += len;
  }
  return { name: parts.join('.'), newOffset: jumped ? returnOffset : offset };
}

function parseDnsRecords(buf) {
  if (buf.length < 12) return [];
  const qdcount = buf.readUInt16BE(4);
  const ancount = buf.readUInt16BE(6);
  const nscount = buf.readUInt16BE(8);
  const arcount = buf.readUInt16BE(10);
  let offset = 12;
  for (let i = 0; i < qdcount && offset < buf.length; i++) {
    const { newOffset } = readDnsName(buf, offset);
    offset = newOffset + 4;
  }
  const records = [];
  const total = ancount + nscount + arcount;
  for (let i = 0; i < total && offset + 10 < buf.length; i++) {
    const { name, newOffset: noff } = readDnsName(buf, offset);
    offset = noff;
    if (offset + 10 > buf.length) break;
    const type = buf.readUInt16BE(offset);
    const rdlength = buf.readUInt16BE(offset + 8);
    const rdStart = offset + 10;
    offset = rdStart + rdlength;
    if (offset > buf.length) break;
    const rdata = buf.slice(rdStart, rdStart + rdlength);
    if (type === DNS_TYPE.PTR) {
      records.push({ type: 'PTR', name, value: readDnsName(buf, rdStart).name });
    } else if (type === DNS_TYPE.SRV && rdata.length >= 6) {
      const port = rdata.readUInt16BE(4);
      const target = readDnsName(buf, rdStart + 6).name;
      records.push({ type: 'SRV', name, port, target });
    } else if (type === DNS_TYPE.TXT) {
      const entries = {};
      let toff = 0;
      while (toff < rdata.length) {
        const tlen = rdata[toff]; toff++;
        if (toff + tlen > rdata.length) break;
        const text = rdata.slice(toff, toff + tlen).toString('utf8');
        const eq = text.indexOf('=');
        if (eq > 0) entries[text.slice(0, eq)] = text.slice(eq + 1);
        else if (text) entries[text] = '';
        toff += tlen;
      }
      records.push({ type: 'TXT', name, entries });
    } else if (type === DNS_TYPE.A && rdata.length === 4) {
      records.push({ type: 'A', name, address: `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}` });
    } else if (type === DNS_TYPE.AAAA && rdata.length === 16) {
      const parts = [];
      for (let j = 0; j < 16; j += 2) parts.push(rdata.readUInt16BE(j).toString(16));
      records.push({ type: 'AAAA', name, address: parts.join(':') });
    }
  }
  return records;
}

function buildDnsQuery(serviceName) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const labels = serviceName.split('.');
  const parts = [header];
  for (const label of labels) {
    const len = Buffer.alloc(1); len[0] = label.length;
    parts.push(len, Buffer.from(label, 'utf8'));
  }
  parts.push(Buffer.from([0x00, 0x00, 0x0C, 0x00, 0x01]));
  return Buffer.concat(parts);
}

async function scanMdns() {
  try {
    const dgram = require('dgram');
    const MDNS_ADDR = '224.0.0.251';
    const MDNS_PORT = 5353;
    const queries = [
      buildDnsQuery('_services._dns-sd._udp.local'),
      buildDnsQuery('_http._tcp.local'),
      buildDnsQuery('_airplay._tcp.local'),
      buildDnsQuery('_ipp._tcp.local'),
      buildDnsQuery('_googlecast._tcp.local'),
      buildDnsQuery('_raop._tcp.local'),
      buildDnsQuery('_smb._tcp.local'),
      buildDnsQuery('_companion-link._tcp.local'),
    ];

    return await new Promise((resolve) => {
      const deviceMap = new Map();
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (msg, rinfo) => {
        const records = parseDnsRecords(msg);
        const ip = rinfo.address;
        if (!deviceMap.has(ip)) {
          deviceMap.set(ip, { ip, port: rinfo.port, hostnames: new Set(), services: [], txt: {}, ips: new Set([ip]) });
        }
        const dev = deviceMap.get(ip);
        for (const rec of records) {
          if (rec.type === 'PTR' && !rec.value.startsWith('_')) dev.hostnames.add(rec.value);
          if (rec.type === 'PTR' && rec.value.includes('._tcp') || rec.value?.includes('._udp')) {
            dev.services.push(rec.value);
          }
          if (rec.type === 'SRV') {
            dev.hostnames.add(rec.target);
            dev.services.push(`${rec.name}:${rec.port}`);
          }
          if (rec.type === 'TXT') Object.assign(dev.txt, rec.entries);
          if (rec.type === 'A' || rec.type === 'AAAA') {
            dev.ips.add(rec.address);
            if (rec.name) dev.hostnames.add(rec.name);
          }
        }
      });
      sock.on('error', () => { sock.close(); resolve([]); });
      sock.bind(() => {
        try { sock.addMembership(MDNS_ADDR); } catch {}
        for (const q of queries) sock.send(q, MDNS_PORT, MDNS_ADDR);
        setTimeout(() => {
          sock.close();
          const results = [];
          for (const dev of deviceMap.values()) {
            const hostnames = [...dev.hostnames].filter(h => h && !h.startsWith('_'));
            const services = [...new Set(dev.services)];
            const serviceTypes = services
              .map(s => s.match(/(_[^.]+\._(?:tcp|udp))/)?.[1])
              .filter(Boolean);
            const hostname = hostnames.find(h => !h.endsWith('.local')) || hostnames[0] || null;
            results.push({
              signal_type: 'mdns_device',
              identifier: dev.ip,
              display_name: hostname || `mDNS ${dev.ip}`,
              rssi_dbm: null, signal_pct: null, tx_power_dbm: null, distance_estimate_m: null,
              properties: {
                ip_address: dev.ip,
                port: dev.port,
                hostname,
                hostnames,
                service_types: [...new Set(serviceTypes)],
                services,
                txt_records: Object.keys(dev.txt).length > 0 ? dev.txt : null,
                ip_addresses: [...dev.ips],
                vendor: null,
              },
            });
          }
          resolve(results);
        }, 4000);
      });
    });
  } catch (err) {
    console.warn('[rfScanner] mDNS scan failed:', err && err.message);
    return [];
  }
}

// ── NetBIOS scan ─────────────────────────────────────────────────────

async function scanNetbios() {
  try {
    if (os.platform() !== 'win32') return [];

    const run = (cmd) => new Promise((resolve) => {
      exec(cmd, { timeout: 12000, encoding: 'utf8' }, (err, stdout) => {
        resolve(err ? '' : stdout || '');
      });
    });

    const [cacheOut, localOut] = await Promise.all([
      run('nbtstat -c'),
      run('nbtstat -n'),
    ]);

    const seen = new Map();

    const parseBlock = (block, isRemote) => {
      const ipMatch = block.match(/(?:Host|Node)\s+IpAddress:\s+\[?([\d.]+)\]?/i);
      const macMatch = block.match(/MAC\s+Address\s*=\s*([\dA-Fa-f-]{17})/i);
      const ip = ipMatch ? ipMatch[1] : null;
      const mac = macMatch ? macMatch[1].replace(/-/g, ':').toUpperCase() : null;

      const lines = block.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*(\S+)\s+<([0-9A-Fa-f]{2})>\s+(\w+)/);
        if (!m) continue;
        const name = m[1].trim();
        const suffix = m[2];
        const regType = m[3];
        const suffixDesc = NB_SUFFIX[suffix] || 'Unknown';
        const key = `${ip || mac || name}-${name}-${suffix}`;
        if (seen.has(key)) continue;
        seen.set(key, true);

        const vendor = mac ? lookupVendor(mac) : null;
        const displayParts = [name];
        if (suffixDesc !== 'Unknown') displayParts.push(`(${suffixDesc})`);
        if (ip) displayParts.push(`[${ip}]`);

        seen.set(key, {
          signal_type: 'netbios_device',
          identifier: mac ? `nb-${mac}` : `nb-${name}-${suffix}`,
          display_name: displayParts.join(' '),
          rssi_dbm: null, signal_pct: null, tx_power_dbm: null, distance_estimate_m: null,
          properties: {
            netbios_name: name,
            suffix,
            suffix_description: suffixDesc,
            registration_type: regType,
            ip_address: ip,
            mac_address: mac,
            vendor,
            source: isRemote ? 'cache' : 'local',
          },
        });
      }
    };

    const splitBlocks = (text) => text.split(/(?=\S.*:$)/m).filter(b => b.trim());
    for (const block of splitBlocks(cacheOut)) parseBlock(block, true);
    for (const block of splitBlocks(localOut)) parseBlock(block, false);

    return [...seen.values()].filter(v => v && typeof v === 'object' && v.signal_type);
  } catch (err) {
    console.warn('[rfScanner] NetBIOS scan failed:', err && err.message);
    return [];
  }
}

// ── Protocol → scan function mapping ─────────────────────────────────

const PROTOCOL_SCANNERS = {
  wifi: [scanWifi],
  bt: [scanBluetooth, scanBle],
  ble: [scanBle],
  arp: [scanArp],
  ssdp: [scanSsdp],
  mdns: [scanMdns],
  nb: [scanNetbios],
  all: [scanWifi, scanBluetooth, scanBle, scanArp, scanSsdp, scanMdns, scanNetbios],
};

// ── Main scan entry point ─────────────────────────────────────────────

/**
 * Run an RF/network scan and return a scan session object.
 *
 * @param {object} opts
 * @param {string|null} opts.protocol - Protocol filter: 'wifi', 'bt', 'arp', 'ssdp', 'mdns', 'nb', or null/undefined for all
 * @param {number|null} opts.lat  - Scanner GPS latitude
 * @param {number|null} opts.lng  - Scanner GPS longitude
 * @param {string|null} opts.deviceId - Scanner device tag
 * @param {number|null} opts.callId - Link to active call
 * @returns {Promise<object>} scan session object
 */
async function runRfScan({ protocol = null, lat = null, lng = null, deviceId = null, callId = null } = {}) {
  const scanSessionId = crypto.randomUUID();
  const now = new Date().toISOString();

  const scanners = PROTOCOL_SCANNERS[protocol] || PROTOCOL_SCANNERS.all;
  const results = await Promise.allSettled(scanners.map(fn => fn()));

  const signals = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .map((s) => ({
      ...s,
      scan_session_id: scanSessionId,
      scanner_lat: lat,
      scanner_lng: lng,
      scanner_device_id: deviceId,
      call_id: callId,
      first_seen_at: now,
      last_seen_at: now,
      properties: JSON.stringify(s.properties ?? {}),
    }));

  return {
    scan_session_id: scanSessionId,
    scanned_at: now,
    scanner_lat: lat,
    scanner_lng: lng,
    scanner_device_id: deviceId,
    call_id: callId,
    protocol: protocol || 'all',
    signals,
    counts: {
      wifi: signals.filter(s => s.signal_type === 'wifi_ap').length,
      bt_classic: signals.filter(s => s.signal_type === 'bt_classic').length,
      ble: signals.filter(s => s.signal_type === 'ble').length,
      cell: signals.filter(s => s.signal_type === 'cell_tower').length,
      arp: signals.filter(s => s.signal_type === 'arp_device').length,
      ssdp: signals.filter(s => s.signal_type === 'ssdp_device').length,
      mdns: signals.filter(s => s.signal_type === 'mdns_device').length,
      netbios: signals.filter(s => s.signal_type === 'netbios_device').length,
    },
  };
}

module.exports = {
  runRfScan, scanWifi, scanBluetooth, scanBle, scanArp, scanSsdp, scanMdns, scanNetbios,
  lookupVendor, lookupBleMfg, pctToDbm, rssiToMetres, freqToBand, btClassToCategory,
};
