// ============================================================
// RMPG Flex — Mock Data Interceptor for Contract Managers
// When a user with role 'contract_manager' makes API requests,
// this middleware intercepts and returns mock data instead of
// querying the real database. Write operations are blocked.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import {
  MOCK_CLIENT,
  MOCK_PROPERTIES,
  MOCK_UNITS,
  MOCK_PERSONS,
  MOCK_VEHICLES,
  MOCK_INCIDENTS,
  getMockCalls,
  getMockDashboardStats,
} from '../utils/mockContractData';

/**
 * Intercepts API requests for contract_manager role users.
 * Self-decodes the JWT to check the role (works regardless of
 * whether route-level authenticateToken has run yet).
 * Returns mock data for read operations, blocks write operations.
 */
export function mockInterceptor(req: Request, res: Response, next: NextFunction) {
  // Quick-decode JWT to check role (non-blocking — falls through on failure)
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (!token) return next();

  let role: string;
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as any;
    role = decoded.role;
  } catch {
    return next(); // Invalid/expired token — let route-level auth handle it
  }

  if (role !== 'contract_manager') return next();

  // Block all write operations
  if (req.method !== 'GET') {
    // Allow auth endpoints (login, refresh, me)
    if (req.path.startsWith('/api/auth')) {
      return next();
    }
    return res.status(403).json({
      error: 'Contract manager accounts are read-only. Contact ICU Investigations for changes.',
    });
  }

  const path = req.path;

  // ── Dashboard Stats ──────────────────────────────────────
  if (path === '/api/dashboard/stats' || path === '/api/dashboard') {
    return res.json(getMockDashboardStats());
  }

  // ── Dispatch Calls ───────────────────────────────────────
  if (path === '/api/dispatch/calls') {
    const calls = getMockCalls();
    const status = req.query.status as string;
    const filtered = status
      ? calls.filter(c => c.status === status)
      : calls;
    return res.json({
      calls: filtered,
      total: filtered.length,
      page: 1,
      limit: 50,
    });
  }

  // Single call detail
  const callMatch = path.match(/^\/api\/dispatch\/calls\/(-?\d+)$/);
  if (callMatch) {
    const callId = parseInt(callMatch[1]);
    const call = getMockCalls().find(c => c.id === callId);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    return res.json(call);
  }

  // ── Dispatch Units ───────────────────────────────────────
  if (path === '/api/dispatch/units') {
    return res.json(MOCK_UNITS);
  }

  // ── GPS positions (return unit locations) ─────────────────
  if (path === '/api/dispatch/gps') {
    return res.json(MOCK_UNITS.map(u => ({
      unit_id: u.id,
      unit_number: u.unit_number,
      lat: u.lat,
      lng: u.lng,
      timestamp: u.last_gps,
      speed: 0,
      heading: 0,
    })));
  }

  // ── Incidents ────────────────────────────────────────────
  if (path === '/api/incidents') {
    return res.json({
      incidents: MOCK_INCIDENTS,
      total: MOCK_INCIDENTS.length,
      page: 1,
      limit: 50,
    });
  }

  const incidentMatch = path.match(/^\/api\/incidents\/(-?\d+)$/);
  if (incidentMatch) {
    const incId = parseInt(incidentMatch[1]);
    const inc = MOCK_INCIDENTS.find(i => i.id === incId);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });
    return res.json(inc);
  }

  // ── Persons ──────────────────────────────────────────────
  if (path === '/api/records/persons') {
    return res.json({
      persons: MOCK_PERSONS,
      total: MOCK_PERSONS.length,
      page: 1,
      limit: 50,
    });
  }

  if (path === '/api/records/persons/search') {
    const q = ((req.query.q as string) || '').toLowerCase();
    const filtered = MOCK_PERSONS.filter(p =>
      p.first_name.toLowerCase().includes(q) ||
      p.last_name.toLowerCase().includes(q) ||
      (p.phone && p.phone.includes(q))
    );
    return res.json(filtered);
  }

  const personMatch = path.match(/^\/api\/records\/persons\/(-?\d+)$/);
  if (personMatch) {
    const pId = parseInt(personMatch[1]);
    const person = MOCK_PERSONS.find(p => p.id === pId);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    return res.json(person);
  }

  // ── Vehicles ─────────────────────────────────────────────
  if (path === '/api/records/vehicles') {
    return res.json({
      vehicles: MOCK_VEHICLES,
      total: MOCK_VEHICLES.length,
      page: 1,
      limit: 50,
    });
  }

  if (path === '/api/records/vehicles/search') {
    const q = ((req.query.q as string) || '').toLowerCase();
    const filtered = MOCK_VEHICLES.filter(v =>
      v.plate_number.toLowerCase().includes(q) ||
      v.vin.toLowerCase().includes(q) ||
      v.make.toLowerCase().includes(q) ||
      v.model.toLowerCase().includes(q)
    );
    return res.json(filtered);
  }

  // ── Clients ──────────────────────────────────────────────
  if (path === '/api/clients' || path === '/api/admin/clients') {
    return res.json({ clients: [MOCK_CLIENT], total: 1 });
  }

  // ── Properties ───────────────────────────────────────────
  if (path === '/api/properties' || path === '/api/admin/properties') {
    return res.json({
      properties: MOCK_PROPERTIES,
      total: MOCK_PROPERTIES.length,
    });
  }

  // ── NCIC Queries (return mock person/vehicle/warrant data) ──
  if (path === '/api/records/ncic-query') {
    const type = req.query.type as string;
    const query = ((req.query.query as string) || '').toLowerCase();

    if (type === 'person') {
      const matches = MOCK_PERSONS.filter(p =>
        p.first_name.toLowerCase().includes(query) ||
        p.last_name.toLowerCase().includes(query)
      );
      return res.json({
        type: 'person',
        query,
        results: matches.map(p => ({
          person: {
            id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            dob: p.dob,
            gender: p.gender,
            race: p.race,
            height: p.height,
            weight: p.weight,
            hair_color: p.hair_color,
            eye_color: p.eye_color,
            address: p.address,
            phone: p.phone,
            dl_number: p.dl_number,
            dl_state: p.dl_state,
            caution_flags: p.caution_flags,
          },
          criminalHistory: [],
          warrants: [],
        })),
      });
    }

    if (type === 'vehicle') {
      const matches = MOCK_VEHICLES.filter(v =>
        v.plate_number.toLowerCase().replace(/\s/g, '').includes(query.replace(/\s/g, '')) ||
        v.vin.toLowerCase().includes(query)
      );
      return res.json({
        type: 'vehicle',
        query,
        results: matches.map(v => ({
          ...v,
          registration_status: v.is_stolen ? 'STOLEN' : 'VALID',
        })),
      });
    }

    if (type === 'warrant') {
      return res.json({ type: 'warrant', query, results: [] });
    }

    return res.json({ type, query, results: [] });
  }

  // ── Warrants (empty for mock) ────────────────────────────
  if (path === '/api/warrants') {
    return res.json({ warrants: [], total: 0, page: 1, limit: 50 });
  }

  // ── Reports / Stats endpoints ────────────────────────────
  if (path.startsWith('/api/reports') || path.startsWith('/api/stats')) {
    return res.json({ data: [], total: 0 });
  }

  // ── Auth endpoints — always pass through ─────────────────
  if (path.startsWith('/api/auth')) {
    return next();
  }

  // ── Users endpoint (return minimal info) ─────────────────
  if (path === '/api/admin/users') {
    return res.json({ users: [], total: 0 });
  }

  // ── Announcements ────────────────────────────────────────
  if (path === '/api/announcements') {
    return res.json([]);
  }

  // ── Fallback: return empty data for unknown GET routes ───
  // This prevents contract managers from ever seeing real data
  return res.json({ data: [], total: 0, message: 'No data available for this view' });
}
