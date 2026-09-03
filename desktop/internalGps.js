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

/** Parse $GPVTG: $GPVTG,track,T,magTrack,M,speedKnots,N,speedKmh,K,mode */
function parseVTG(fields) {
  if (!fields || fields.length < 9) return null;
  const mode = fields[9]; // 'A'=autonomous, 'D'=DGPS, 'E'=DR, 'V'=no fix
  if (mode === 'V' || mode === 'N') return null;
  const heading = parseFloat(fields[1]);
  const speedKnots = parseFloat(fields[5]);
  return {
    heading: Number.isFinite(heading) ? heading : null,
    speedMs: Number.isFinite(speedKnots) ? speedKnots * 0.514444 : null,
  };
}

/** Parse $GPGLL: $GPGLL,lat,N/S,lng,E/W,time,status */
function parseGLL(fields) {
  if (!fields || fields.length < 7) return null;
  if (fields[6] !== 'A') return null; // V = void
  const lat = nmeaToDecimal(fields[1], fields[2]);
  const lng = nmeaToDecimal(fields[3], fields[4]);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

/** Parse $GPGSV: $GPGSV,totalMsgs,msgNum,satsInView,[prn,elev,azim,snr x4] */
function parseGSV(fields) {
  if (!fields || fields.length < 4) return null;
  const satsInView = parseInt(fields[3], 10);
  if (!Number.isFinite(satsInView)) return null;
  const sats = [];
  for (let i = 4; i + 3 < fields.length; i += 4) {
    const prn = parseInt(fields[i], 10);
    const snr = parseInt(fields[i + 3], 10);
    if (Number.isFinite(prn)) {
      sats.push({ prn, snr: Number.isFinite(snr) ? snr : 0 });
    }
  }
  return { satsInView, sats };
}

/**
 * Classifies a GPS fix into a quality tier based on HDOP and satellite count.
 * 'excellent': HDOP < 1 and sats >= 8
 * 'good':      HDOP < 2 and sats >= 5
 * 'degraded':  HDOP < 5
 * 'poor':      any valid fix with HDOP >= 5
 * 'none':      no fix data
 */
function classifyFixQuality(hdop, satCount) {
  if (!Number.isFinite(hdop) || !Number.isFinite(satCount)) return 'none';
  if (hdop < 1 && satCount >= 8) return 'excellent';
  if (hdop < 2 && satCount >= 5) return 'good';
  if (hdop < 5) return 'degraded';
  return 'poor';
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Great-circle dead reckoning: project a position forward from lat/lng
 * at the given heading (degrees true) and speed (m/s) over elapsedMs ms.
 * Pure function — no side effects, fully unit-testable.
 */
function projectPosition(lat, lng, headingDeg, speedMs, elapsedMs) {
  const distM = speedMs * (elapsedMs / 1000);
  if (distM === 0) return { lat, lng };
  const bearingRad = (headingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angDist = distM / EARTH_RADIUS_M;
  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angDist) +
    Math.cos(latRad) * Math.sin(angDist) * Math.cos(bearingRad)
  );
  const newLngRad = lngRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angDist) * Math.cos(latRad),
    Math.cos(angDist) - Math.sin(latRad) * Math.sin(newLatRad)
  );
  return {
    lat: (newLatRad * 180) / Math.PI,
    lng: (newLngRad * 180) / Math.PI,
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
    this.pending = { lat: null, lng: null, accuracy: null, heading: null, speed: null, sats: 0 };
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
    this._lastFixAt = null;       // timestamp of last real fix (ms)
    this._drTimer = null;         // dead reckoning interval
    this.DR_MAX_MS = 30_000;      // stop projecting after 30s
    this.DR_INTERVAL_MS = 1_000;  // emit estimated position every 1s
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
      // UBX-CFG-RATE: set measurement period to 200 ms (5 Hz).
      // Fire-and-forget — if the chip ignores it (pre-M8 firmware) it stays at
      // 1 Hz; if it accepts, fixes arrive 5× more often, cutting lag from ~6 s
      // (1 Hz + 5 s batch) to ~1.2 s (5 Hz + 1 s batch).
      // Checksum DE 6A is Fletcher over Class+ID+Length+Payload (not sync header).
      if (this.port && this.port.isOpen) {
        this.port.write(
          Buffer.from([0xB5,0x62,0x06,0x08,0x06,0x00,0xC8,0x00,0x01,0x00,0x01,0x00,0xDE,0x6A]),
          (err) => {
            if (err) console.warn('[INTERNAL-GPS] UBX-CFG-RATE write failed (non-fatal):', err.message);
            else console.log('[INTERNAL-GPS] Sent UBX-CFG-RATE 5Hz');
          }
        );
      }
      // Schedule dead reckoning to begin if fixes stop arriving (checked 3s later)
      setTimeout(() => {
        if (this._lastFixAt && (Date.now() - this._lastFixAt) > 2000) {
          this._startDeadReckoning();
        }
      }, 3000);
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
        this.pending.sats = r.sats;
        updated = true;
      } else if (this._lastFixAt && (Date.now() - this._lastFixAt) > 2000 && !this._drTimer) {
        this._startDeadReckoning();
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
    } else if (sentence === 'VTG') {
      const r = parseVTG(fields);
      if (r) {
        if (r.speedMs !== null) this.pending.speed = r.speedMs;
        if (r.heading !== null) this.pending.heading = r.heading;
        updated = true;
      }
    } else if (sentence === 'GLL') {
      const r = parseGLL(fields);
      if (r && this.pending.lat === null) {
        this.pending.lat = r.lat;
        this.pending.lng = r.lng;
        updated = true;
      }
    } else if (sentence === 'GSV') {
      const r = parseGSV(fields);
      if (r) {
        this.emit('gps:constellation', {
          satsInView: r.satsInView,
          satsTracked: r.sats.filter((s) => s.snr > 0).length,
          avgSnr: r.sats.length > 0
            ? Math.round(r.sats.reduce((s, sat) => s + sat.snr, 0) / r.sats.length)
            : 0,
        });
      }
    }

    if (updated && this.pending.lat !== null && this.pending.lng !== null) {
      this.emit('position', {
        latitude: this.pending.lat,
        longitude: this.pending.lng,
        accuracy: this.pending.accuracy ?? 10, // assume 10m if HDOP missing
        heading: this.pending.heading,
        speed: this.pending.speed,
        fixQuality: classifyFixQuality(
          this.pending.accuracy ? this.pending.accuracy / 5 : null, // reverse HDOP estimate
          this.pending.sats ?? null
        ),
        timestamp: new Date().toISOString(),
      });
      this._lastFixAt = Date.now();
      this._stopDeadReckoning(); // real fix arrived — cancel DR
    }
  }

  _startDeadReckoning() {
    this._stopDeadReckoning();
    this._drTimer = setInterval(() => {
      if (!this.pending.lat || !this.pending.heading || !this.pending.speed) return;
      const elapsed = Date.now() - (this._lastFixAt || Date.now());
      if (elapsed > this.DR_MAX_MS) { this._stopDeadReckoning(); return; }
      const projected = projectPosition(
        this.pending.lat, this.pending.lng,
        this.pending.heading, this.pending.speed,
        this.DR_INTERVAL_MS
      );
      this.pending.lat = projected.lat;
      this.pending.lng = projected.lng;
      this.emit('position', {
        latitude: projected.lat,
        longitude: projected.lng,
        accuracy: Math.min(50 + elapsed / 1000 * 5, 300), // grows with age
        heading: this.pending.heading,
        speed: this.pending.speed,
        fixQuality: 'poor',
        estimated: true,
        timestamp: new Date().toISOString(),
      });
    }, this.DR_INTERVAL_MS);
  }

  _stopDeadReckoning() {
    if (this._drTimer) { clearInterval(this._drTimer); this._drTimer = null; }
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
    this._stopDeadReckoning();
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
//
// Returns { path, score } for the best-matching port, or null if none looked
// like a GNSS device. The score lets callers distinguish a HARDWARE-DEFINITIVE
// match (u-blox VID → 100, or a GNSS-named bridge → 70) from a weak name-only
// guess (50). A definitive match is trustworthy even when the host's WMI
// manufacturer string doesn't say "Panasonic" (some FZ-55 SKUs report a blank
// or OEM manufacturer), so detection should NOT be gated on that string.
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
      return { path: ranked[0].p.path, score: ranked[0].s };
    }
    console.warn('[INTERNAL-GPS] No GPS COM port matched among', ports.length, 'enumerated port(s)');
    return null;
  } catch (err) {
    console.warn('[INTERNAL-GPS] Port enumeration failed:', err.message);
    return null;
  }
}

// General-purpose serial port listing (Group D, device:serial-ports) —
// reuses this file's lazily-loaded SerialPort so there's one source of
// truth for the `require('serialport')` call, not a second one elsewhere.
async function listSerialPorts() {
  if (!SerialPort) return [];
  try {
    return await SerialPort.list();
  } catch (err) {
    console.warn('[INTERNAL-GPS] listSerialPorts failed:', err.message);
    return [];
  }
}

// Attempts a throwaway open+close against portPath to distinguish "no GPS
// hardware enumerated" from "hardware enumerated, but its port is currently
// unopenable" (device:gps-present, Group D). OS-level exclusive-lock
// semantics mean this correctly reports busy without disturbing an
// already-open InternalGps connection on the same path — it never touches
// `this.port` on any InternalGps instance, only a fresh, separate handle.
// Resolves `null` on a successful open (immediately closed), or the Error
// on failure. SerialPortCtor is injectable for tests; defaults to the
// lazily-loaded module-level SerialPort.
function probeGpsPortOpen(portPath, SerialPortCtor = SerialPort) {
  return new Promise((resolve) => {
    if (!SerialPortCtor) {
      resolve(new Error('serialport module unavailable on this platform'));
      return;
    }
    let probePort;
    try {
      probePort = new SerialPortCtor({ path: portPath, baudRate: 9600, autoOpen: false });
    } catch (err) {
      resolve(err);
      return;
    }
    probePort.open((openErr) => {
      if (openErr) {
        resolve(openErr);
        return;
      }
      probePort.close(() => resolve(null));
    });
  });
}

module.exports = { InternalGps, findGpsPort, listSerialPorts, probeGpsPortOpen, parseVTG, parseGLL, parseGSV, classifyFixQuality, projectPosition };
