export interface DispatchCallFilters {
  status?: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  propertyId?: number;
  archived?: 'true' | 'false' | 'all';
  page: number;
  limit: number;
}

export interface DispatchPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateDispatchCallInput {
  incident_type: string;
  priority: string;
  location_address: string;
  property_id?: number | null;
  client_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  notes?: unknown;
  source?: string | null;
  [key: string]: unknown;
}

export interface DispatchCallRecord extends Record<string, unknown> {
  id: number;
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string;
  property_id?: number | null;
  client_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at: string;
}

export interface DispatchDomainEvent {
  type: 'dispatch.call.created' | 'dispatch.call.updated';
  payload: {
    call: DispatchCallRecord;
    [key: string]: unknown;
  };
}

export interface DispatchServiceSuccess<T> {
  ok: true;
  data: T;
}

export interface DispatchServiceFailure {
  ok: false;
  status: number;
  error: string;
}

export type DispatchServiceResult<T> = DispatchServiceSuccess<T> | DispatchServiceFailure;
