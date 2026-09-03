'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  signalToDbm,
  channelBand,
  channelFrequencyMhz,
  parseNetshScanNetworks,
  parseNetshListProfiles,
  parseNetshGetDetail,
} = require('../wifiInfo');

// A representative `netsh wlan show networks mode=Bssid` block.
const SCAN_SAMPLE = `\nInterface name : Wi-Fi\nThere are 2 networks currently visible.\n\nSSID 1 : RMPG-5G\n    Network type            : Infrastructure\n    Authentication          : WPA2-Personal\n    Encryption              : CCMP\n    BSSID 1                 : aa:bb:cc:dd:ee:ff\n         Signal             : 85%\n         Radio type         : 802.11ac\n         Channel            : 36\n         Basic rates (Mbps) : 6 12 24\n         Other rates (Mbps) : 9 18 36 48 54\n    BSSID 2                 : 11:22:33:44:55:66\n         Signal             : 60%\n         Radio type         : 802.11ac\n         Channel            : 36\n         Basic rates (Mbps) : 6 12 24\n         Other rates (Mbps) : 9 18 36 48 54\n\nSSID 2 : Coffee Shop\n    Network type            : Infrastructure\n    Authentication          : Open\n    Encryption              : None\n    BSSID 1                 : 99:88:77:66:55:44\n         Signal             : 40%\n         Radio type         : 802.11n\n         Channel            : 6\n         Basic rates (Mbps) : 6 12\n         Other rates (Mbps) : 9 18\n`;

test('signalToDbm: maps link quality scale', () => {
  assert.equal(signalToDbm(100), -50);
  assert.equal(signalToDbm(50), -75);
  assert.equal(signalToDbm(0), -100);
  assert.equal(signalToDbm('bad'), null);
  assert.equal(signalToDbm(NaN), null);
});

test('channelBand: 2.4 / 5 / 6 GHz classification', () => {
  assert.equal(channelBand(6, '802.11n'), '2.4 GHz');
  assert.equal(channelBand(36, '802.11ac'), '5 GHz');
  assert.equal(channelBand(149, '802.11ac'), '5 GHz');
  assert.equal(channelBand(5, '802.11ax-6GHz'), '6 GHz');
  assert.equal(channelBand(233, '802.11ax'), '6 GHz');
  assert.equal(channelBand(null, null), null);
});

test('channelFrequencyMhz: per-band center frequencies', () => {
  assert.equal(channelFrequencyMhz(1, '2.4 GHz'), 2412);
  assert.equal(channelFrequencyMhz(14, '2.4 GHz'), 2484);
  assert.equal(channelFrequencyMhz(36, '5 GHz'), 5180);
  assert.equal(channelFrequencyMhz(1, '6 GHz'), 5955);
  assert.equal(channelFrequencyMhz(null, null), null);
});

test('parseNetshScanNetworks: emits the full renderer shape', () => {
  const nets = parseNetshScanNetworks(SCAN_SAMPLE);
  assert.equal(nets.length, 2);

  const main = nets[0];
  assert.equal(main.ssid, 'RMPG-5G');
  assert.equal(main.auth, 'WPA2-Personal');
  assert.equal(main.enc, 'CCMP');
  assert.equal(main.networkType, 'Infrastructure');
  assert.equal(main.isHidden, false);
  assert.equal(main.signal, 85);
  assert.equal(main.signalDbm, -57);
  assert.equal(main.channel, 36);
  assert.equal(main.band, '5 GHz');
  assert.equal(main.frequencyMhz, 5180);
  assert.equal(main.bssidCount, 2);
  assert.deepEqual(main.basicRates, [6, 12, 24]);
  assert.deepEqual(main.otherRates, [9, 18, 36, 48, 54]);
  assert.equal(main.maxRateMbps, 54);
  assert.equal(main.bssids.length, 2);
  assert.equal(main.bssids[0].bssid, 'aa:bb:cc:dd:ee:ff');
  assert.equal(main.bssids[0].signalDbm, -57);
  assert.deepEqual(main.bssids[0].basicRates, [6, 12, 24]);

  const open = nets[1];
  assert.equal(open.ssid, 'Coffee Shop');
  assert.equal(open.auth, 'Open');
  assert.equal(open.band, '2.4 GHz');
  assert.equal(open.frequencyMhz, 2437);
});

test('parseNetshScanNetworks: hidden SSID flagged', () => {
  const withHidden = `SSID 1 : (Hidden network)\n    Network type            : Infrastructure\n    Authentication          : Open\n    Encryption              : None\n    BSSID 1 : 00:00:00:00:00:01\n         Signal : 30%\n         Radio type : 802.11n\n         Channel : 1\n`;
  const nets = parseNetshScanNetworks(withHidden);
  assert.equal(nets.length, 1);
  assert.equal(nets[0].isHidden, true);
});

test('parseNetshScanNetworks: empty / malformed input returns []', () => {
  assert.deepEqual(parseNetshScanNetworks(''), []);
  assert.deepEqual(parseNetshScanNetworks(null), []);
  assert.deepEqual(parseNetshScanNetworks('no wifi here'), []);
});

test('parseNetshListProfiles: extracts profile names', () => {
  const sample = '\nProfiles on interface Wi-Fi:\n\nGroup policy profiles (read only)\n---------------------------------\n    <None>\n\nUser profiles\n-------------\n    All User Profile     : RMPG\n    All User Profile     : Guest-Open\n\n';
  assert.deepEqual(parseNetshListProfiles(sample), ['RMPG', 'Guest-Open']);
  assert.deepEqual(parseNetshListProfiles(''), []);
});

test('parseNetshGetDetail: parses show interfaces', () => {
  const sample = `\nThere is 1 interface on the system:\n\n    Name                   : Wi-Fi\n    Description            : Intel(R) Wi-Fi 6E AX211\n    GUID                   : x\n    Physical address       : aa:bb:cc:dd:ee:ff\n    State                  : connected\n    SSID                   : RMPG\n    BSSID                  : 11:22:33:44:55:66\n    Network type           : Infrastructure\n    Radio type             : 802.11ax\n    Authentication         : WPA3-Personal\n    Cipher                 : CCMP\n    Connection mode        : Profile\n    Channel                : 36\n    Receive rate (Mbps)    : 866.7\n    Transmit rate (Mbps)   : 866.7\n    Signal                 : 90%\n    Profile                : RMPG\n`;
  const d = parseNetshGetDetail(sample);
  assert.equal(d.state, 'connected');
  assert.equal(d.ssid, 'RMPG');
  assert.equal(d.channel, 36);
  assert.equal(d.band, '5 GHz');
  assert.equal(d.signal, 90);
  assert.equal(d.signalDbm, -55);
  assert.equal(d.radioType, '802.11ax');
  assert.equal(d.auth, 'WPA3-Personal');
  assert.equal(d.rxMbps, 866.7);
  assert.equal(d.mac, 'aa:bb:cc:dd:ee:ff');
});
