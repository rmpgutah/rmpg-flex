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
    this.baudRate = 4800; // u-blox default; some Toughbooks use 9600
  }

  async start(portPath, baudRate = 4800) {
    if (!SerialPort) {
      this.emit('error', new Error('serialport module unavailable on this platform'));
      return false;
    }
    this.portPath = portPath;
    this.baudRate = baudRate;
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

  _handleLine(line) {
    if (!line || !line.startsWith('$')) return;
    if (!checksumOk(line)) return;
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
    const candidates = ports.filter((p) => {
      const mfg = (p.manufacturer || '').toLowerCase();
      const friendly = (p.friendlyName || '').toLowerCase();
      const vid = (p.vendorId || '').toLowerCase();
      return (
        mfg.includes('u-blox') ||
        mfg.includes('ublox') ||
        friendly.includes('gps') ||
        friendly.includes('gnss') ||
        vid === '1546'
      );
    });
    if (candidates.length > 0) return candidates[0].path;
    return null;
  } catch (err) {
    console.warn('[INTERNAL-GPS] Port enumeration failed:', err.message);
    return null;
  }
}

module.exports = { InternalGps, findGpsPort };
