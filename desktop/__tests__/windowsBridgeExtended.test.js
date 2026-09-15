'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

// Platform-neutral stand-in for app.getPath so the allowed-roots check is
// exercised with real absolute paths on whichever OS runs the suite.
const FAKE_USER_ROOT = path.join(os.tmpdir(), 'rmpg-winext-test');
const fakeGetPath = (k) => path.join(FAKE_USER_ROOT, k);
const {
  registerWindowsBridgeExtended,
  parsePsJsonArray,
  parsePingOutput,
  validateHost,
  validatePid,
  validateLaunchableApp,
  validateEnvVar,
  validateEventLogQuery,
  validateSystemSound,
  validateRotation,
  validateResolution,
  clampPercent,
  formatRecentEntries,
  formatDrives,
  formatProcesses,
  formatInstalledApps,
  formatEventLog,
  formatScheduledTasks,
  formatNetAdapters,
  formatBluetoothDevices,
  parseDisplayModes,
  interpretDisplayChangeCode,
  normalizePsDate,
} = require('../windowsBridgeExtended');

const PING_OK = `
Pinging 8.8.8.8 with 32 bytes of data:
Reply from 8.8.8.8: bytes=32 time=14ms TTL=117
Reply from 8.8.8.8: bytes=32 time=13ms TTL=117
Reply from 8.8.8.8: bytes=32 time=15ms TTL=117
Reply from 8.8.8.8: bytes=32 time=13ms TTL=117

Ping statistics for 8.8.8.8:
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 13ms, Maximum = 15ms, Average = 13ms
`;

const PING_DEAD = `
Pinging 10.0.0.250 with 32 bytes of data:
Request timed out.
Request timed out.

Ping statistics for 10.0.0.250:
    Packets: Sent = 2, Received = 0, Lost = 2 (100% loss),
`;

test('parsePsJsonArray: wraps single objects, passes arrays, tolerates garbage', () => {
  assert.deepEqual(parsePsJsonArray('{"a":1}'), [{ a: 1 }]);
  assert.deepEqual(parsePsJsonArray('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(parsePsJsonArray(''), []);
  assert.deepEqual(parsePsJsonArray('   '), []);
  assert.deepEqual(parsePsJsonArray('not json'), []);
  assert.deepEqual(parsePsJsonArray('null'), []);
});

test('parsePingOutput: success and total-loss cases', () => {
  const ok = parsePingOutput(PING_OK);
  assert.equal(ok.ok, true);
  assert.equal(ok.sent, 4);
  assert.equal(ok.received, 4);
  assert.equal(ok.lost, 0);
  assert.equal(ok.avgMs, 13);
  assert.equal(ok.maxMs, 15);

  const dead = parsePingOutput(PING_DEAD);
  assert.equal(dead.ok, false);
  assert.equal(dead.received, 0);
  assert.equal(dead.lost, 2);
  assert.equal(dead.avgMs, null);
});

test('validateHost: accepts hostnames and IPs, rejects flag smuggling', () => {
  assert.equal(validateHost('api.rmpgutah.us').ok, true);
  assert.equal(validateHost('8.8.8.8').ok, true);
  assert.equal(validateHost('2001:4860:4860::8888').ok, true);
  assert.equal(validateHost(' google.com ').host, 'google.com');
  assert.equal(validateHost('-t 8.8.8.8').ok, false);
  assert.equal(validateHost('/t').ok, false);
  assert.equal(validateHost('a b').ok, false);
  assert.equal(validateHost('host; rm -rf').ok, false);
  assert.equal(validateHost('').ok, false);
  assert.equal(validateHost(42).ok, false);
});

test('validatePid: integer > 4, never self', () => {
  assert.equal(validatePid(1234, 999).ok, true);
  assert.equal(validatePid(4, 999).ok, false);
  assert.equal(validatePid(0, 999).ok, false);
  assert.equal(validatePid(999, 999).ok, false);
  assert.equal(validatePid('1234', 999).ok, false);
  assert.equal(validatePid(12.5, 999).ok, false);
});

test('validateLaunchableApp: allowlist only', () => {
  assert.equal(validateLaunchableApp('notepad').exe, 'notepad.exe');
  assert.equal(validateLaunchableApp('cmd').ok, false);
  assert.equal(validateLaunchableApp('C:\\evil.exe').ok, false);
  assert.equal(validateLaunchableApp('__proto__').ok, false);
});

test('validateEnvVar: RMPG_ namespace, string/null values, no control chars', () => {
  assert.equal(validateEnvVar('RMPG_UNIT', 'A12').ok, true);
  assert.equal(validateEnvVar('RMPG_UNIT', null).ok, true);
  assert.equal(validateEnvVar('PATH', 'x').ok, false);
  assert.equal(validateEnvVar('rmpg_unit', 'x').ok, false);
  assert.equal(validateEnvVar('RMPG_UNIT', 'a\nb').ok, false);
  assert.equal(validateEnvVar('RMPG_UNIT', 'x'.repeat(513)).ok, false);
  assert.equal(validateEnvVar('RMPG_UNIT', 7).ok, false);
});

test('validateEventLogQuery: defaults and clamping', () => {
  assert.deepEqual(validateEventLogQuery(undefined), { ok: true, logName: 'System', level: 'all', maxEvents: 50 });
  assert.equal(validateEventLogQuery({ logName: 'Security' }).logName, 'System');
  assert.equal(validateEventLogQuery({ logName: 'Application' }).logName, 'Application');
  assert.equal(validateEventLogQuery({ level: 'error' }).level, 'error');
  assert.equal(validateEventLogQuery({ level: 'bogus' }).level, 'all');
  assert.equal(validateEventLogQuery({ maxEvents: 9999 }).maxEvents, 200);
  assert.equal(validateEventLogQuery({ maxEvents: 0 }).maxEvents, 1);
});

test('validateSystemSound / validateRotation / validateResolution', () => {
  assert.equal(validateSystemSound('Asterisk').ok, true);
  assert.equal(validateSystemSound('Asterisk; Remove-Item').ok, false);
  assert.deepEqual(validateRotation(90), { ok: true, dmOrientation: 1, degrees: 90 });
  assert.equal(validateRotation(45).ok, false);
  assert.deepEqual(validateResolution(1920, 1080), { ok: true, width: 1920, height: 1080 });
  assert.equal(validateResolution(100, 100).ok, false);
  assert.equal(validateResolution('1920; x', 1080).ok, false);
});

test('clampPercent', () => {
  assert.equal(clampPercent(150), 100);
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent('42.6'), 43);
  assert.equal(clampPercent('nope'), 0);
});

test('formatRecentEntries: newest first, .lnk stripped, capped', () => {
  const entries = [
    { name: 'a.lnk', fullPath: 'C:\\r\\a.lnk', mtimeMs: 100 },
    { name: 'b.lnk', fullPath: 'C:\\r\\b.lnk', mtimeMs: 300 },
    { name: 'desktop.ini', fullPath: 'C:\\r\\desktop.ini', mtimeMs: 900 },
    { name: 'c.lnk', fullPath: 'C:\\r\\c.lnk', mtimeMs: 200 },
  ];
  const out = formatRecentEntries(entries, 2);
  assert.deepEqual(out.map((e) => e.name), ['b', 'c']);
  assert.equal(out[0].modifiedAt, new Date(300).toISOString());
});

test('formatDrives: percentages and totals', () => {
  const [c] = formatDrives([{ Name: 'C', Used: 75, Free: 25, Root: 'C:\\', Description: 'OS' }]);
  assert.equal(c.letter, 'C');
  assert.equal(c.totalBytes, 100);
  assert.equal(c.usedPercent, 75);
  assert.deepEqual(formatDrives([{ Used: 1 }]), []);
});

test('formatProcesses / formatInstalledApps dedupe + sort', () => {
  const procs = formatProcesses([{ Id: 12, ProcessName: 'x', CPU: 1.5, WorkingSet64: 1024 }, { Id: 'bad' }]);
  assert.equal(procs.length, 1);
  assert.equal(procs[0].pid, 12);
  const apps = formatInstalledApps([
    { DisplayName: 'Zed', DisplayVersion: '1' },
    { DisplayName: 'Zed', DisplayVersion: '1' },
    { DisplayName: 'Alpha', DisplayVersion: '2' },
    { DisplayName: '   ' },
  ]);
  assert.deepEqual(apps.map((a) => a.name), ['Alpha', 'Zed']);
});

test('formatEventLog + normalizePsDate handle ISO and /Date()/ forms', () => {
  const ev = formatEventLog([
    { Id: 41, LevelDisplayName: 'Error', ProviderName: 'Kernel-Power', Message: 'boom', TimeCreated: '2026-09-08T10:00:00.000Z' },
    { Id: 7, LevelDisplayName: 'Warning', ProviderName: 'X', Message: null, TimeCreated: '/Date(1700000000000)/' },
  ]);
  assert.equal(ev[0].level, 'error');
  assert.equal(ev[0].time, '2026-09-08T10:00:00.000Z');
  assert.equal(ev[1].message, '');
  assert.equal(ev[1].time, new Date(1700000000000).toISOString());
  assert.equal(normalizePsDate(undefined), null);
  assert.equal(normalizePsDate('garbage'), null);
});

test('formatScheduledTasks maps numeric State enum', () => {
  const [t] = formatScheduledTasks([{ TaskName: 'Sync', TaskPath: '\\RMPG\\', State: 3 }]);
  assert.equal(t.state, 'Ready');
});

test('formatNetAdapters flags wifi and up state', () => {
  const [wifi, eth] = formatNetAdapters([
    { Name: 'Wi-Fi', InterfaceDescription: 'Intel Wireless-AC', Status: 'Up', MediaType: 'Native 802.11' },
    { Name: 'Ethernet', InterfaceDescription: 'Realtek', Status: 'Disconnected', MediaType: '802.3' },
  ]);
  assert.equal(wifi.isWifi, true);
  assert.equal(wifi.up, true);
  assert.equal(eth.isWifi, false);
  assert.equal(eth.up, false);
});

test('formatBluetoothDevices flags the radio', () => {
  const devs = formatBluetoothDevices([
    { FriendlyName: 'Intel(R) Wireless Bluetooth(R) Radio', Status: 'OK' },
    { FriendlyName: 'Headset', Status: 'Error' },
  ]);
  assert.equal(devs[0].isRadio, true);
  assert.equal(devs[1].ok, false);
});

test('parseDisplayModes: current mode + deduped sorted list', () => {
  const out = parseDisplayModes('1920x1080@60/0\r\n800x600@60;1280x720@60;1920x1080@60;1920x1080@75;640x480@60;');
  assert.deepEqual(out.current, { width: 1920, height: 1080, refreshHz: 60, rotation: 0 });
  assert.deepEqual(out.modes.map((m) => `${m.width}x${m.height}`), ['1920x1080', '1280x720', '800x600']);
});

test('interpretDisplayChangeCode', () => {
  assert.deepEqual(interpretDisplayChangeCode('0'), { ok: true, code: 0 });
  assert.equal(interpretDisplayChangeCode('-2').error, 'bad_mode');
  assert.equal(interpretDisplayChangeCode('junk\n1').error, 'restart_required');
});

// ─── Registration wiring ─────────────────────────────────────

function makeHarness({ platform = 'win32', psOutput = '' } = {}) {
  const handlers = new Map();
  const calls = [];
  const deps = {
    guardedHandle: (channel, fn) => handlers.set(channel, fn),
    execFileAsync: async (bin, args, opts) => {
      calls.push({ bin, args, opts });
      return { stdout: typeof psOutput === 'function' ? psOutput(bin, args) : psOutput };
    },
    electron: {
      app: { getPath: fakeGetPath },
      shell: { openPath: async () => '', trashItem: async () => {} },
      Notification: null,
      desktopCapturer: { getSources: async () => [] },
    },
    fs: { promises: { readdir: async () => [], stat: async () => ({ mtimeMs: 0 }), mkdir: async () => {}, writeFile: async () => {}, statfs: async () => { throw new Error('nope'); } } },
    os: { cpus: () => [{ model: 'x', times: { user: 1, nice: 0, sys: 1, idle: 2, irq: 0 } }], totalmem: () => 100, freemem: () => 50, uptime: () => 5, hostname: () => 'h', release: () => '10', arch: () => 'x64' },
    getMainWindow: () => null,
    checkRateLimit: () => true,
    log: { error: () => {} },
    platform,
    selfPid: 4242,
  };
  registerWindowsBridgeExtended(deps);
  return { handlers, calls, invoke: (ch, ...args) => handlers.get(ch)({}, ...args) };
}

test('registration: every channel uses the winext: prefix and goes through guardedHandle', () => {
  const { handlers } = makeHarness();
  // 29 winext channels; bump deliberately when adding one.
  assert.equal(handlers.size, 29);
  for (const ch of handlers.keys()) assert.match(ch, /^winext:/);
});

test('non-win32 platform: PowerShell-backed channels return not_supported without spawning', async () => {
  const h = makeHarness({ platform: 'darwin' });
  assert.deepEqual(await h.invoke('winext:processes'), { ok: false, error: 'not_supported' });
  assert.deepEqual(await h.invoke('winext:set-mute', true), { ok: false, error: 'not_supported' });
  assert.equal(h.calls.length, 0);
});

test('kill-process: validation rejects before any spawn; valid pid spawns Stop-Process', async () => {
  const h = makeHarness({ psOutput: '' });
  const bad = await h.invoke('winext:kill-process', 4);
  assert.equal(bad.ok, false);
  assert.equal(h.calls.length, 0);
  const self = await h.invoke('winext:kill-process', 4242);
  assert.equal(self.ok, false);
  const good = await h.invoke('winext:kill-process', 5555);
  assert.deepEqual(good, { ok: true, pid: 5555 });
  assert.equal(h.calls[0].bin, 'powershell.exe');
  assert.match(h.calls[0].args.at(-1), /Stop-Process -Id 5555/);
});

test('launch-app: only allowlisted ids reach Start-Process', async () => {
  const h = makeHarness();
  assert.equal((await h.invoke('winext:launch-app', 'cmd')).ok, false);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.invoke('winext:launch-app', 'notepad')).ok, true);
  assert.match(h.calls[0].args.at(-1), /Start-Process -FilePath 'notepad.exe'/);
});

test('ping: validated host passed as last arg, output parsed', async () => {
  const h = makeHarness({ psOutput: PING_OK });
  const res = await h.invoke('winext:ping', '8.8.8.8');
  assert.equal(res.ok, true);
  assert.equal(res.avgMs, 13);
  assert.equal(h.calls[0].bin, 'ping.exe');
  assert.equal(h.calls[0].args.at(-1), '8.8.8.8');
  assert.equal((await h.invoke('winext:ping', '-t evil')).ok, false);
});

test('rate limiter blocks process-spawning channels', async () => {
  const handlers = new Map();
  registerWindowsBridgeExtended({
    guardedHandle: (c, f) => handlers.set(c, f),
    execFileAsync: async () => { throw new Error('should not spawn'); },
    electron: { app: { getPath: () => 'x' } },
    checkRateLimit: () => false,
    log: { error: () => {} },
    platform: 'win32',
  });
  assert.deepEqual(await handlers.get('winext:toggle-wifi')({}, true), { ok: false, error: 'rate_limited' });
});

test('open-folder / recycle-item reject paths outside the user roots', async () => {
  const h = makeHarness();
  assert.equal((await h.invoke('winext:open-folder', path.join(os.tmpdir(), 'elsewhere'))).ok, false);
  assert.equal((await h.invoke('winext:recycle-item', path.join(FAKE_USER_ROOT, '..', 'escape.txt'))).ok, false);
  assert.equal((await h.invoke('winext:open-folder', path.join(fakeGetPath('downloads'), 'reports'))).ok, true);
  assert.equal((await h.invoke('winext:recycle-item', path.join(fakeGetPath('desktop'), 'old.pdf'))).ok, true);
});

test('event-log: query is normalized into the FilterHashtable', async () => {
  const h = makeHarness({ psOutput: '[]' });
  const res = await h.invoke('winext:event-log', { logName: 'Application', level: 'error', maxEvents: 10 });
  assert.equal(res.ok, true);
  assert.match(h.calls[0].args.at(-1), /LogName='Application'; Level=2/);
  assert.match(h.calls[0].args.at(-1), /-MaxEvents 10/);
});

test('system-performance works without PowerShell', async () => {
  const h = makeHarness();
  const res = await h.invoke('winext:system-performance');
  assert.equal(res.ok, true);
  assert.equal(res.memory.usedPercent, 50);
  assert.equal(res.cpuBusyPercent, 50);
  assert.equal(h.calls.length, 0);
});
