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

// ── Main scan entry point ─────────────────────────────────────────────

/**
 * Run a full RF scan (WiFi + Bluetooth) and return a scan session object
 * ready to POST to /api/radar360/signal-scan.
 *
 * @param {object} opts
 * @param {number|null} opts.lat  - Scanner GPS latitude
 * @param {number|null} opts.lng  - Scanner GPS longitude
 * @param {string|null} opts.deviceId - Scanner device tag
 * @param {number|null} opts.callId - Link to active call
 * @returns {Promise<object>} scan session object
 */
async function runRfScan({ lat = null, lng = null, deviceId = null, callId = null } = {}) {
  const scanSessionId = crypto.randomUUID();
  const now = new Date().toISOString();

  const [wifiResults, btResults] = await Promise.allSettled([scanWifi(), scanBluetooth()]);

  const signals = [
    ...(wifiResults.status === 'fulfilled' ? wifiResults.value : []),
    ...(btResults.status === 'fulfilled'   ? btResults.value   : []),
  ].map((s) => ({
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
    signals,
    counts: {
      wifi: signals.filter(s => s.signal_type === 'wifi_ap').length,
      bt_classic: signals.filter(s => s.signal_type === 'bt_classic').length,
      ble: signals.filter(s => s.signal_type === 'ble').length,
      cell: signals.filter(s => s.signal_type === 'cell_tower').length,
    },
  };
}

module.exports = { runRfScan, lookupVendor, pctToDbm, rssiToMetres, freqToBand, btClassToCategory };
