export interface V2Location {
  name: string;
  coordinates: [number, number]; // [lng, lat]
}

export interface V2Vehicle {
  name: string;
  routing_profile?: string;
  start_location?: string;
  end_location?: string;
  earliest_start?: string;
  latest_end?: string;
  capabilities?: string[];
  capacities?: Record<string, number>;
  loading_policy?: 'any' | 'fifo' | 'lifo';
  breaks?: { earliest_start: string; latest_end: string; duration: number }[];
}

export interface V2ServiceTime {
  earliest: string;
  latest: string;
  type?: 'strict' | 'soft' | 'soft_start' | 'soft_end';
}

export interface V2Service {
  name: string;
  location: string;
  duration?: number;
  requirements?: string[];
  service_times?: V2ServiceTime[];
}

export interface V2ProblemDocument {
  version: 1;
  locations: V2Location[];
  vehicles: V2Vehicle[];
  services: V2Service[];
  shipments?: { name: string; from: string; to: string; size?: Record<string, number>; requirements?: string[];
    pickup_duration?: number; dropoff_duration?: number; pickup_times?: V2ServiceTime[]; dropoff_times?: V2ServiceTime[] }[];
  options?: {
    objectives?: ('min-schedule-completion-time' | 'min-total-travel-duration')[];
    avg_mpg?: number | null;
  };
}

export interface V2Stop {
  type: 'start' | 'service' | 'pickup' | 'dropoff' | 'break' | 'end';
  location: string;
  eta: string;
  odometer?: number;
  wait?: number;
  duration?: number;
  services?: string[];
}

export interface V2Route {
  vehicle: string;
  stops: V2Stop[];
  distance?: number;  // meters, from Mapbox V2 route summary
  duration?: number;  // seconds, from Mapbox V2 route summary
}

export interface V2Solution {
  dropped: { services: string[]; shipments: string[] };
  routes: V2Route[];
}

