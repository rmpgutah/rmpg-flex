// ============================================================
// Internal GPS Reader — NMEA over Serial (Panasonic Toughbook)
//
// Reads NMEA-0183 sentences directly from the Toughbook's
// internal GPS module (typically a u-blox NEO-M8N exposed as
// a virtual COM port on Windows). Bypasses the OS Location API
// to get raw hardware GPS fixes (3-5m accuracy) instead of
// Windows' WiFi-triangulation fallback.
//
// Emits 'position' events with the same shape as the IP fallback:
//   { latitude, longitude, accuracy, heading, speed, timestamp }
// ============================================================

const { EventEmitter } = require('events');

let SerialPort;
let ReadlineParser;
try {
  // Loaded lazily — serialport ships native bindings and we don't want
  // to crash macOS/Linux dev builds where it isn't built for the host arch.
  ({ SerialPort } = require('serialport'));
  ({ ReadlineParser } = require('@serialport/parser-readline'));
} catch (err) {
  console.warn('[INTERNAL-GPS] serialport not available on this platform:', err.message);
}

// ─── NMEA Parsing ───────────────────────────────────────────
// We care about two sentences:
//   $GPGGA — fix data: lat, lng, fix quality, # of sats, HDOP, altitude
//   $GPRMC — recommended minimum: lat, lng, speed (knots), course (heading)
// Either one alone is enough for a position; together they give us speed/heading.

/** Convert NMEA DDMM.MMMM to decimal degrees. Returns null on bad input. */
function nmeaToDecimal(value, hemi) {
  if (!value || !hemi) return null;
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return null;
  const degrees = Math.floor(num / 100);
  const minutes = num - degrees * 100;
  let decimal = degrees + minutes / 60;
  if (hemi === 'S' || hemi === 'W') decimal = -decimal;
  return decimal;
}

/** Parse $GPGGA: $GPGGA,time,lat,N/S,lng,E/W,fix,sats,hdop,alt,M,... */
function parseGGA(fields) {
  const fixQuality = parseInt(fields[6], 10);
  if (!fixQuality || fixQuality === 0) return null; // no fix
  const lat = nmeaToDecimal(fields[2], fields[3]);
  const lng = nmeaToDecimal(fields[4], fields[5]);
  if (lat === null || lng === null) return null;
  const hdop = parseFloat(fields[8]);
  // Rough accuracy estimate: HDOP * 5m (u-blox typical UERE)
  const accuracy = Number.isFinite(hdop) ? Math.max(hdop * 5, 2.5) : null;
  return { lat, lng, accuracy, fixQuality, sats: parseInt(fields[7], 10) || 0 };
}

/** Parse $GPRMC: $GPRMC,time,status,lat,N/S,lng,E/W,speedKnots,course,date,... */
function parseRMC(fields) {
  if (fields[2] !== 'A') return null; // 'V' = void/no fix
  const lat = nmeaToDecimal(fields[3], fields[4]);
  const lng = nmeaToDecimal(fields[5], fields[6]);
  if (lat === null || lng === null) return null;
  const speedKnots = parseFloat(fields[7]);
  const speed = Number.isFinite(speedKnots) ? speedKnots * 0.514444 : null; // m/s
  const heading = parseFloat(fields[8]);
  return {
    lat,
    lng,
    speed,
    heading: Number.isFinite(heading) ? heading : null,
  };
}

/** Validate NMEA XOR checksum. Returns true if valid, false otherwise. */
function checksumOk(sentence) {
  const star = sentence.lastIndexOf('*');
  if (star < 0 || star + 3 > sentence.length) return false;
  const expected = parseInt(sentence.slice(star + 1, star + 3), 16);
  let actual = 0;
  for (let i = 1; i < star; i++) actual ^= sentence.charCodeAt(i);
  return expected === actual;
}

// ─── GPS Reader ─────────────────────────────────────────────
class InternalGps extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.parser = null;
    /** Coalesced position state — GGA gives fix, RMC adds heading/speed */
    this.pending = { lat: null, lng: null, accuracy: null, heading: null, speed: null };
    this.reconnectTimer = null;
    this.portPath = null;
    // Baud ladder. The FZ-55's u-blox NEO-M8 module defaults to 9600, NOT 4800
    // — the old hard-coded 4800 produced garbage/no NMEA on stock units, so no
    // fix ever arrived and the renderer silently fell back to WiFi. We probe the
    // common rates (9600 first) and lock onto the first that yields a
    // checksum-valid NMEA sentence (see _startBaudProbe / _tryNextBaud).
    this.baudCandidates = [9600, 4800, 38400, 115200];
    this.baudIndex = 0;
    this.baudRate = this.baudCandidates[0];
    this.gotValidData = false;
    this.baudProbeTimer = null;
  }

  async start(portPath, baudRate) {
    if (!SerialPort) {
      this.emit('error', new Error('serialport module unavailable on this platform'));
      return false;
    }
    this.portPath = portPath;
    // If the caller pins a baud, probe it FIRST, then fall through the rest of
    // the ladder if it yields no valid NMEA. Otherwise use the default ladder.
    if (baudRate) {
      this.baudCandidates = [baudRate, ...this.baudCandidates.filter((b) => b !== baudRate)];
    }
    this.baudIndex = 0;
    this.baudRate = this.baudCandidates[0];
    this.gotValidData = false;
    return this._openPort();
  }

  _openPort() {
    try {
      this.port = new SerialPort({ path: this.portPath, baudRate: this.baudRate, autoOpen: false });
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      this.parser.on('data', (line) => this._handleLine(line));
      this.port.on('error', (err) => {
        console.warn('[INTERNAL-GPS] Serial error:', err.message);
        this.emit('error', err);
        this._scheduleReconnect();
      });
      this.port.on('close', () => {
        console.warn('[INTERNAL-GPS] Port closed unexpectedly, will reconnect');
        this._scheduleReconnect();
      });
      this.port.open((err) => {
        if (err) {
          console.warn('[INTERNAL-GPS] Failed to open', this.portPath, '-', err.message);
          this._scheduleReconnect();
          return;
        }
        console.log('[INTERNAL-GPS] Reading from', this.portPath, '@', this.baudRate);
        this.emit('open');
        this._startBaudProbe();
      });
      return true;
    } catch (err) {
      console.error('[INTERNAL-GPS] Port construction failed:', err.message);
      this._scheduleReconnect();
      return false;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.portPath) this._openPort();
    }, 5000);
  }

  // Baud auto-detect. If no checksum-valid NMEA arrives within the probe window
  // at the current rate, the baud is probably wrong — advance the ladder. Once
  // a good sentence lands, _handleLine clears this and we stay locked.
  _startBaudProbe() {
    if (this.gotValidData) return; // already locked — nothing to probe
    if (this.baudProbeTimer) clearTimeout(this.baudProbeTimer);
    this.baudProbeTimer = setTimeout(() => {
      this.baudProbeTimer = null;
      if (!this.gotValidData) this._tryNextBaud();
    }, 6000);
  }

  _tryNextBaud() {
    if (this.gotValidData || this.baudCandidates.length <= 1) return;
    this.baudIndex = (this.baudIndex + 1) % this.baudCandidates.length;
    const next = this.baudCandidates[this.baudIndex];
    console.log(`[INTERNAL-GPS] No valid NMEA at ${this.baudRate} baud — retrying at ${next}`);
    this.baudRate = next;
    // Close and let the existing close → _scheduleReconnect path reopen at the
    // new baud (no manual reopen here → avoids a double-open race). _openPort
    // re-arms the probe, so the ladder keeps cycling until a sentence locks.
    if (this.port && this.port.isOpen) {
      this.port.close(() => { /* reopen handled by close → _scheduleReconnect */ });
    } else {
      this._scheduleReconnect();
    }
  }

  _handleLine(line) {
    if (!line || !line.startsWith('$')) return;
    if (!checksumOk(line)) return;
    // First checksum-valid sentence means this baud is correct — lock it in and
    // cancel the baud-probe ladder so we don't keep cycling.
    if (!this.gotValidData) {
      this.gotValidData = true;
      if (this.baudProbeTimer) { clearTimeout(this.baudProbeTimer); this.baudProbeTimer = null; }
      console.log('[INTERNAL-GPS] Locked NMEA stream @', this.baudRate, 'baud');
    }
    const body = line.split('*')[0];
    const fields = body.split(',');
    const tag = fields[0];

    // Accept GP* (GPS), GN* (multi-GNSS), GL* (GLONASS) — Toughbooks ship multi-constellation modules
    const sentence = tag.slice(3); // 'GGA', 'RMC', etc.

    let updated = false;
    if (sentence === 'GGA') {
      const r = parseGGA(fields);
      if (r) {
        this.pending.lat = r.lat;
        this.pending.lng = r.lng;
        this.pending.accuracy = r.accuracy;
        updated = true;
      }
    } else if (sentence === 'RMC') {
      const r = parseRMC(fields);
      if (r) {
        // RMC has position too — use it if GGA hasn't fired yet
        if (this.pending.lat === null) {
          this.pending.lat = r.lat;
          this.pending.lng = r.lng;
        }
        this.pending.speed = r.speed;
        this.pending.heading = r.heading;
        updated = true;
      }
    }

    if (updated && this.pending.lat !== null && this.pending.lng !== null) {
      this.emit('position', {
        latitude: this.pending.lat,
        longitude: this.pending.lng,
        accuracy: this.pending.accuracy ?? 10, // assume 10m if HDOP missing
        heading: this.pending.heading,
        speed: this.pending.speed,
        timestamp: new Date().toISOString(),
      });
    }
  }

  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.baudProbeTimer) {
      clearTimeout(this.baudProbeTimer);
      this.baudProbeTimer = null;
    }
    if (this.port && this.port.isOpen) {
      this.port.close(() => { /* swallow — closing on shutdown */ });
    }
    this.port = null;
    this.parser = null;
    this.portPath = null;
  }
}

// ─── COM Port Discovery ─────────────────────────────────────
// Toughbook GPS modules typically register with one of these vendor IDs:
//   u-blox:       VID 1546
//   SiRF/CSR:     VID 067B (Prolific bridge), VID 0E8D
// We list available ports and prefer ones whose manufacturer/vendor matches.
async function findGpsPort() {
  if (!SerialPort) return null;
  try {
    const ports = await SerialPort.list();
    // Log EVERY enumerated port so a field tech can see exactly what the
    // Toughbook exposes when detection still misses — paste this from the
    // Electron console (Ctrl+Shift+I) and the right VID/name can be added.
    try {
      console.log('[INTERNAL-GPS] Serial ports:', JSON.stringify(ports.map((p) => ({
        path: p.path, manufacturer: p.manufacturer, friendlyName: p.friendlyName,
        vendorId: p.vendorId, productId: p.productId, pnpId: p.pnpId,
      }))));
    } catch { /* logging only */ }

    // Known GNSS-module vendor IDs (lowercase hex, no 0x):
    //   1546 u-blox · 067b Prolific (SiRF/GPS bridges) · 0e8d MediaTek ·
    //   1199 Sierra · 10c4 SiLabs CP210x UART bridge · 0403 FTDI
    // CP210x/FTDI/Prolific are also used by plain serial adapters, so those
    // VIDs only qualify when paired with a GNSS-looking name (avoids grabbing
    // an unrelated COM port). A u-blox VID is definitive on its own.
    const GNSS_BRIDGE_VIDS = new Set(['067b', '0e8d', '1199', '10c4', '0403']);
    const looksGnss = (s) => /u-?blox|gnss|gps|nmea|navsat|glonass|location\s*sensor/i.test(s || '');

    const score = (p) => {
      const vid = (p.vendorId || '').toLowerCase();
      const pnp = (p.pnpId || '').toLowerCase();
      const text = `${p.manufacturer || ''} ${p.friendlyName || ''} ${p.pnpId || ''}`;
      const nameGnss = looksGnss(text);
      if (vid === '1546' || pnp.includes('vid_1546')) return 100;      // u-blox — definitive
      if (nameGnss && GNSS_BRIDGE_VIDS.has(vid)) return 70;            // GNSS name + bridge VID
      if (nameGnss) return 50;                                         // GNSS name alone
      return 0;                                                        // bare serial adapter — ignore
    };

    const ranked = ports
      .map((p) => ({ p, s: score(p) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);

    if (ranked.length > 0) {
      console.log('[INTERNAL-GPS] Selected GPS port:', ranked[0].p.path, '(score', ranked[0].s + ')');
      return ranked[0].p.path;
    }
    console.warn('[INTERNAL-GPS] No GPS COM port matched among', ports.length, 'enumerated port(s)');
    return null;
  } catch (err) {
    console.warn('[INTERNAL-GPS] Port enumeration failed:', err.message);
    return null;
  }
}

module.exports = { InternalGps, findGpsPort };
