import * as net from 'net';
import { getDb } from '../models/database';
import { broadcastUnitUpdate } from './websocket';
import { logger } from './logger';

let tcpServer: net.Server | null = null;
let receiverEnabled = false;
let receiverPort = 33000;

export function getHowenConfig(): { enabled: boolean; port: number; deviceCount: number; uptime: number } {
  const uptime = tcpServer?.listening ? process.uptime() : 0;
  let deviceCount = 0;
  try {
    const db = getDb();
    deviceCount = (db.prepare('SELECT COUNT(*) as cnt FROM howen_devices').get() as any)?.cnt || 0;
  } catch { }
  return { enabled: receiverEnabled, port: receiverPort, deviceCount, uptime };
}

function parseHowenPacket(buffer: Buffer): any | null {
  if (buffer.length < 8) return null;
  if (buffer[0] !== 0x48) return null;

  const packetType = buffer[3];
  const jsonStart = 8;

  let jsonEnd = -1;
  let braceDepth = 0;
  let inString = false;

  for (let i = jsonStart; i < buffer.length; i++) {
    const b = buffer[i];
    if (inString) {
      if (b === 0x5c) { i++; continue; }
      if (b === 0x22) inString = false;
      continue;
    }
    if (b === 0x22) { inString = true; continue; }
    if (b === 0x7b) braceDepth++;
    if (b === 0x7d) {
      braceDepth--;
      if (braceDepth === 0) { jsonEnd = i; break; }
    }
  }

  if (jsonEnd === -1) return null;

  try {
    const jsonStr = buffer.toString('utf8', jsonStart, jsonEnd + 1);
    const data = JSON.parse(jsonStr);

    let deviceId: string | undefined;
    if (data.dn) deviceId = String(data.dn);
    else if (data.imei) deviceId = String(data.imei);

    if (data.mb && !deviceId) deviceId = String(data.mb);

    return {
      raw: data,
      deviceId,
      packetType,
      packetHex: buffer.subarray(0, jsonEnd + 1).toString('hex'),
    };
  } catch {
    return null;
  }
}

function findJsonBoundaries(buffer: Buffer): { start: number; end: number } | null {
  let braceDepth = 0;
  let inString = false;
  let start = -1;

  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if (inString) {
      if (b === 0x5c) { i++; continue; }
      if (b === 0x22) inString = false;
      continue;
    }
    if (b === 0x22) { inString = true; continue; }
    if (b === 0x7b) {
      if (start === -1) start = i;
      braceDepth++;
    }
    if (b === 0x7d) {
      braceDepth--;
      if (braceDepth === 0 && start !== -1) return { start, end: i };
    }
  }

  if (braceDepth > 0 && start !== -1) return null;
  return null;
}

function handleJsonPayload(data: any, deviceId: string, remoteAddr: string): void {
  try {
    const db = getDb();
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const lat = parseFloat(data.lat ?? data.latitude ?? data.lat_wgs84);
    const lng = parseFloat(data.lng ?? data.longitude ?? data.lon ?? data.lon_wgs84);
    const speed = parseFloat(data.speed ?? data.spd ?? data.speed_mph);
    const heading = parseFloat(data.heading ?? data.course ?? data.dir);
    const altitude = parseFloat(data.alt ?? data.altitude);
    const satelliteCount = parseInt(data.sat ?? data.satellites ?? data.satellite_count, 10) || 0;

    const hasPosition = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

    const existing = db.prepare('SELECT id, unit_id, label FROM howen_devices WHERE device_id = ?').get(deviceId) as any;

    if (!existing) {
      db.prepare(`
        INSERT INTO howen_devices (device_id, imei, iccid, fw_version, hw_version, model,
          last_lat, last_lon, last_speed, last_heading, last_gps_at, last_connection_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        deviceId,
        data.imei || null,
        data.iccid || null,
        data.fw || data.ver || data.fw_version || null,
        data.hw || data.hw_version || null,
        data.fw ? data.fw.replace(/^ME/i, 'Hero-') : data.model || null,
        hasPosition ? lat : null,
        hasPosition ? lng : null,
        hasPosition ? speed : null,
        hasPosition ? heading : null,
        hasPosition ? (data.dtu || now) : null,
        now,
        now, now,
      );

      logger.info({ deviceId, remoteAddr, model: data.fw }, 'howen device auto-registered');
    } else {
      const updates: string[] = [];
      const vals: any[] = [];

      if (data.imei) { updates.push('imei = COALESCE(?, imei)'); vals.push(data.imei); }
      if (data.iccid) { updates.push('iccid = COALESCE(?, iccid)'); vals.push(data.iccid); }
      if (data.fw) { updates.push('fw_version = COALESCE(?, fw_version)'); vals.push(data.fw); }

      updates.push('last_connection_at = ?'); vals.push(now);

      if (hasPosition) {
        updates.push('last_lat = ?, last_lon = ?, last_speed = ?, last_heading = ?, last_gps_at = ?');
        vals.push(lat, lng, speed, heading, data.dtu || now);
      }

      updates.push('updated_at = ?'); vals.push(now);
      vals.push(deviceId);

      db.prepare(`UPDATE howen_devices SET ${updates.join(', ')} WHERE device_id = ?`).run(...vals);

      if (hasPosition && existing.unit_id) {
        const source = `howen_${deviceId}`;
        db.prepare('UPDATE units SET latitude = ?, longitude = ?, gps_source = ?, gps_updated_at = ? WHERE id = ?')
          .run(lat, lng, `howen:${deviceId}`, now, existing.unit_id);

        const unit = db.prepare('SELECT id, call_sign, status, officer_name, badge_number FROM units WHERE id = ?').get(existing.unit_id) as any;
        if (unit) {
          broadcastUnitUpdate({
            action: 'unit_position_update',
            unit: {
              id: unit.id,
              call_sign: unit.call_sign,
              status: unit.status,
              officer_name: unit.officer_name,
              badge_number: unit.badge_number,
              latitude: lat,
              longitude: lng,
              speed_mph: speed,
              gps_source: `howen:${deviceId}`,
            },
          });
        }
      }
    }

    if (hasPosition) {
      db.prepare(`
        INSERT INTO howen_gps_breadcrumbs (device_id, latitude, longitude, speed, heading, altitude, satellite_count, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(deviceId, lat, lng, isNaN(speed) ? null : speed, isNaN(heading) ? null : heading,
        isNaN(altitude) ? null : altitude, satelliteCount || null, data.dtu || now);
    }

    handleHowenEvents(data, deviceId, existing?.unit_id || null, lat, lng, speed, heading, now);
  } catch (err: any) {
    logger.warn({ err, deviceId }, 'howen handleJsonPayload error');
  }
}

function handleHowenEvents(
  data: any, deviceId: string, unitId: number | null,
  lat: number, lng: number, speed: number, heading: number, now: string,
): void {
  const hasPosition = !isNaN(lat) && !isNaN(lng);
  const severityMap: Record<string, string> = {
    sos: 'critical', panic: 'critical', impact: 'critical', accident: 'critical',
    tamper: 'warning', tampering: 'warning', power_cut: 'warning', powerCut: 'warning',
    low_battery: 'warning', lowBattery: 'warning', overspeed: 'warning', speeding: 'warning',
    hard_brake: 'warning', hardBraking: 'warning', hard_accel: 'warning', hardAcceleration: 'warning',
    hard_turn: 'warning', hardCornering: 'warning', vibration: 'info', geofence: 'info',
    geofenceEnter: 'info', geofenceExit: 'info', ignition: 'info', idle: 'info',
  };

  const alarmChecks: Array<{ key: string; type: string }> = [];

  for (const eventField of ['alarm', 'alarms', 'event', 'events', 'type', 'event_type', 'status']) {
    const val = data[eventField];
    if (typeof val === 'string' && val.length > 0) {
      alarmChecks.push({ key: eventField, type: val });
    }
    if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === 'string') alarmChecks.push({ key: eventField, type: v });
        if (typeof v === 'object' && v?.type) alarmChecks.push({ key: eventField, type: v.type });
      }
    }
  }

  for (const knownEvent of Object.keys(severityMap)) {
    if (data[knownEvent] !== undefined && data[knownEvent] !== 0 && data[knownEvent] !== false && data[knownEvent] !== '0') {
      alarmChecks.push({ key: knownEvent, type: knownEvent });
    }
    if (data[`${knownEvent}_alarm`] !== undefined && data[`${knownEvent}_alarm`] !== 0) {
      alarmChecks.push({ key: `${knownEvent}_alarm`, type: knownEvent });
    }
  }

  if (data.sos === 1 || data.sos === '1' || data.sos === true || data.panic === 1) {
    alarmChecks.push({ key: 'sos', type: 'sos' });
  }

  const seen = new Set<string>();

  for (const check of alarmChecks) {
    const et = check.type.toLowerCase().replace(/\s+/g, '_');
    if (seen.has(et)) continue;
    seen.add(et);

    if (et === 'normal' || et === '0' || et === 'ok' || et === 'none') continue;

    const db = getDb();
    const eventTime = data.event_at || data.dtu || data.event_timestamp || now;
    let description = `Device ${deviceId}: ${et}`;

    const existing = db.prepare(`
      SELECT id FROM howen_events
      WHERE device_id = ? AND event_type = ? AND event_at = ?
      LIMIT 1
    `).get(deviceId, et, eventTime);

    if (existing) continue;

    db.prepare(`
      INSERT INTO howen_events (device_id, unit_id, event_type, severity, latitude, longitude, speed, heading, description, raw_json, event_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deviceId, unitId, et, severityMap[et] || 'info',
      hasPosition ? lat : null, hasPosition ? lng : null,
      isNaN(speed) ? null : speed, isNaN(heading) ? null : heading,
      description, JSON.stringify(data), eventTime,
    );

    if (et === 'sos' || et === 'panic' || et === 'impact' || et === 'accident') {
      logger.warn({ deviceId, event: et, lat, lng }, 'howen critical event');
    }
  }
}

export function startHowenReceiver(port?: number): void {
  if (tcpServer) return;

  receiverPort = port ?? 33000;

  tcpServer = net.createServer((socket) => {
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info({ remoteAddr }, 'howen device connected');

    let incomingBuffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      incomingBuffer = Buffer.concat([incomingBuffer, chunk]);

      const hPacket = parseHowenPacket(incomingBuffer);
      if (hPacket) {
        handleJsonPayload(hPacket.raw, hPacket.deviceId || 'unknown', remoteAddr);
        incomingBuffer = Buffer.alloc(0);
        return;
      }

      const jsonBounds = findJsonBoundaries(incomingBuffer);
      if (jsonBounds) {
        try {
          const jsonStr = incomingBuffer.toString('utf8', jsonBounds.start, jsonBounds.end + 1);
          const data = JSON.parse(jsonStr);
          const deviceId = String(data.dn || data.imei || data.mb || 'unknown');
          handleJsonPayload(data, deviceId, remoteAddr);
        } catch {
          logger.warn({ remoteAddr, size: incomingBuffer.length }, 'howen unparseable data');
        }
        incomingBuffer = incomingBuffer.subarray(jsonBounds.end + 1);
        return;
      }

      if (incomingBuffer.length > 65536) {
        logger.warn({ remoteAddr, size: incomingBuffer.length }, 'howen buffer overflow, resetting');
        incomingBuffer = Buffer.alloc(0);
      }
    });

    socket.on('close', () => {
      logger.info({ remoteAddr }, 'howen device disconnected');
    });

    socket.on('error', (err: Error) => {
      logger.warn({ err, remoteAddr }, 'howen socket error');
    });

    socket.setTimeout(300000);
    socket.on('timeout', () => {
      logger.info({ remoteAddr }, 'howen socket timeout');
      socket.destroy();
    });
  });

  tcpServer.on('error', (err: Error) => {
    logger.error({ err, port: receiverPort }, 'howen receiver error');
    tcpServer = null;
    receiverEnabled = false;
  });

  tcpServer.listen(receiverPort, '0.0.0.0', () => {
    receiverEnabled = true;
    logger.info({ port: receiverPort }, 'howen receiver listening');
  });
}

export function stopHowenReceiver(): void {
  if (tcpServer) {
    tcpServer.close(() => {
      logger.info('howen receiver stopped');
    });
    tcpServer = null;
  }
  receiverEnabled = false;
}

export function restartHowenReceiver(port?: number): void {
  stopHowenReceiver();
  setTimeout(() => startHowenReceiver(port), 500);
}
