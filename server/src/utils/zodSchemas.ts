// ============================================================
// RMPG Flex — Zod Validation Schemas
// ============================================================
// Runtime validation schemas for API inputs using Zod.
// Provides TypeScript-inferred types and CJIS-compliant
// data integrity enforcement on criminal justice records.
// ============================================================

import { z } from 'zod';

// ── Common primitives ─────────────────────────────────────

export const IdParam = z.coerce.number().int().positive();

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export const DateRange = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const Coordinates = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

// ── Person schema (MNI — Master Name Index) ───────────────

export const PersonSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  middle_name: z.string().max(100).optional(),
  date_of_birth: z.string().date().optional(),
  ssn: z.string().regex(/^\d{3}-?\d{2}-?\d{4}$/).optional(),
  gender: z.enum(['M', 'F', 'X', 'U']).optional(),
  race: z.string().max(50).optional(),
  height: z.string().max(10).optional(),
  weight: z.coerce.number().int().min(0).max(1000).optional(),
  hair_color: z.string().max(30).optional(),
  eye_color: z.string().max(30).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(25).optional(),
  email: z.string().email().max(254).optional(),
  drivers_license: z.string().max(30).optional(),
  dl_state: z.string().max(2).optional(),
});

// ── Incident schema ───────────────────────────────────────

export const IncidentSchema = z.object({
  incident_type: z.string().min(1).max(100),
  status: z.enum(['OPEN', 'ACTIVE', 'CLOSED', 'SUSPENDED', 'UNFOUNDED', 'CLEARED', 'EXCEPTIONALLY_CLEARED']).default('OPEN'),
  priority: z.enum(['1', '2', '3', '4', '5']).optional(),
  location: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  reporting_officer_id: z.coerce.number().int().positive().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

// ── Call for Service schema ───────────────────────────────

export const CallForServiceSchema = z.object({
  incident_type: z.string().min(1).max(200),
  priority: z.enum(['1', '2', '3', '4', '5']).default('3'),
  location: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  caller_name: z.string().max(200).optional(),
  caller_phone: z.string().max(25).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

// ── Citation schema ───────────────────────────────────────

export const CitationSchema = z.object({
  citation_number: z.string().min(1).max(50),
  violator_first_name: z.string().min(1).max(100),
  violator_last_name: z.string().min(1).max(100),
  violation_date: z.string().min(1),
  location: z.string().max(500).optional(),
  vehicle_plate: z.string().max(20).optional(),
  vehicle_state: z.string().max(2).optional(),
  vehicle_make: z.string().max(50).optional(),
  vehicle_model: z.string().max(50).optional(),
  vehicle_year: z.coerce.number().int().min(1900).max(2100).optional(),
  vehicle_color: z.string().max(30).optional(),
  fine_amount: z.coerce.number().min(0).optional(),
  court_date: z.string().optional(),
});

// ── Warrant schema ────────────────────────────────────────

export const WarrantSchema = z.object({
  warrant_number: z.string().min(1).max(50),
  warrant_type: z.enum(['ARREST', 'SEARCH', 'BENCH', 'CIVIL', 'OTHER']).default('ARREST'),
  status: z.enum(['ACTIVE', 'SERVED', 'RECALLED', 'EXPIRED', 'QUASHED']).default('ACTIVE'),
  subject_first_name: z.string().max(100).optional(),
  subject_last_name: z.string().max(100).optional(),
  charge: z.string().max(500).optional(),
  issuing_court: z.string().max(200).optional(),
  issued_date: z.string().optional(),
  expiration_date: z.string().optional(),
  bail_amount: z.coerce.number().min(0).optional(),
});

// ── Field Interview schema ────────────────────────────────

export const FieldInterviewSchema = z.object({
  subject_first_name: z.string().min(1).max(100),
  subject_last_name: z.string().min(1).max(100),
  date_time: z.string().min(1),
  location: z.string().min(1).max(500),
  contact_reason: z.string().max(1000).optional(),
  description: z.string().max(5000).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

// ── Fleet Vehicle schema ──────────────────────────────────

export const FleetVehicleSchema = z.object({
  unit_number: z.string().min(1).max(20),
  make: z.string().max(50).optional(),
  model: z.string().max(50).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  vin: z.string().max(17).optional(),
  plate: z.string().max(20).optional(),
  plate_state: z.string().max(2).optional(),
  color: z.string().max(30).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'DECOMMISSIONED']).default('ACTIVE'),
  mileage: z.coerce.number().int().min(0).optional(),
});

// ── Authentication schemas ────────────────────────────────

export const LoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

// ── Search schemas ────────────────────────────────────────

export const UniversalSearchSchema = z.object({
  query: z.string().min(1).max(500),
  types: z.array(z.string()).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const CompoundSearchSchema = z.object({
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  dob_from: z.string().date().optional(),
  dob_to: z.string().date().optional(),
  address: z.string().max(500).optional(),
  plate: z.string().max(20).optional(),
  radius_miles: z.coerce.number().min(0).max(100).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

// ── Trespass Order schema ─────────────────────────────────

export const TrespassOrderSchema = z.object({
  subject_first_name: z.string().min(1).max(100),
  subject_last_name: z.string().min(1).max(100),
  property_name: z.string().min(1).max(200),
  property_address: z.string().max(500).optional(),
  issued_date: z.string().min(1),
  expiration_date: z.string().optional(),
  description: z.string().max(5000).optional(),
});

// ── Serve Queue schema ────────────────────────────────────

export const ServeQueueSchema = z.object({
  recipient_name: z.string().min(1).max(200),
  recipient_address: z.string().max(500).optional(),
  document_type: z.string().max(100).optional(),
  court_case_number: z.string().max(100).optional(),
  deadline: z.string().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  notes: z.string().max(5000).optional(),
});

// ── Utility: validate request body with Zod ───────────────

import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware factory — validates req.body against a Zod schema.
 * On success, replaces req.body with the parsed (coerced, defaulted) value.
 * On failure, responds 400 with structured error details.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Express middleware factory — validates req.query against a Zod schema.
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = result.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      res.status(400).json({ error: 'Invalid query parameters', details: errors });
      return;
    }
    // Merge parsed values back into req.query
    Object.assign(req.query, result.data);
    next();
  };
}

/**
 * Express middleware factory — validates req.params.id as a positive integer.
 */
export function validateId(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = IdParam.safeParse(req.params[paramName]);
    if (!result.success) {
      res.status(400).json({ error: `Invalid ${paramName} parameter` });
      return;
    }
    next();
  };
}

// ── Type exports ──────────────────────────────────────────

export type PersonInput = z.infer<typeof PersonSchema>;
export type IncidentInput = z.infer<typeof IncidentSchema>;
export type CallForServiceInput = z.infer<typeof CallForServiceSchema>;
export type CitationInput = z.infer<typeof CitationSchema>;
export type WarrantInput = z.infer<typeof WarrantSchema>;
export type FieldInterviewInput = z.infer<typeof FieldInterviewSchema>;
export type FleetVehicleInput = z.infer<typeof FleetVehicleSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type SearchInput = z.infer<typeof UniversalSearchSchema>;
