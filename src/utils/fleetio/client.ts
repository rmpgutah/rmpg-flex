// ============================================================
// RMPG Flex — Fleet.io integration: HTTP adapter
// ============================================================
// Worker-safe (no node:*) thin client for the Fleet.io REST API v1.
// Base: https://secure.fleetio.com/api/v1
// Auth: dual headers — `Authorization: Token <API_KEY>` and `Account-Token: <ACCOUNT_TOKEN>`.
// Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
//
// This module NEVER touches D1. Routes (src/routes/fleetio.ts) and the
// sync engine (PR 4) are the only callers. Unit tests stub `fetch`.
// ============================================================

import {
  FleetioConfigError,
  FleetioHttpError,
  FleetioRateLimitError,
  FleetioTimeoutError,
} from './errors';
import type {
  FleetioVehicle,
  FleetioVehicleCreatePayload,
  FleetioListResponse,
} from './types';

export const FLEETIO_API_BASE_DEFAULT = 'https://secure.fleetio.com/api/v1';

export interface FleetioConfig {
  apiKey: string;
  accountToken: string;
  apiBase: string;
}

export interface BuildRequestInput {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  config: FleetioConfig;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

export interface BuiltRequest {
  url: string;
  headers: Headers;
  body?: string;
  method: string;
}

/** Pure: builds the URL + headers + body. No I/O. */
export function buildFleetioRequest(input: BuildRequestInput): BuiltRequest {
  const { method, path, config, query, body } = input;
  const base = config.apiBase.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${base}${cleanPath}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const headers = new Headers({
    'authorization': `Token ${config.apiKey}`,
    'account-token': config.accountToken,
    'accept': 'application/json',
  });
  let serialized: string | undefined;
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    serialized = JSON.stringify(body);
  }
  return { url, headers, body: serialized, method };
}
