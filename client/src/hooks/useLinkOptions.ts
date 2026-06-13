import { useEffect, useState } from 'react';
import { apiFetch } from './useApi';
import {
  DEFAULT_LINK_OPTIONS, mergeLinkOptions,
  type LinkCategory, type LinkOption,
} from '../constants/linkOptions';

export type MergedLinkOptions = Record<LinkCategory, LinkOption[]>;

const CATEGORIES: LinkCategory[] = ['person_role', 'vehicle_role', 'caller_relationship', 'business_role'];

function defaultsAll(): MergedLinkOptions {
  return {
    person_role: DEFAULT_LINK_OPTIONS.person_role,
    vehicle_role: DEFAULT_LINK_OPTIONS.vehicle_role,
    caller_relationship: DEFAULT_LINK_OPTIONS.caller_relationship,
    business_role: DEFAULT_LINK_OPTIONS.business_role,
  };
}

// Module-level cache so every consumer shares one network round-trip.
let cache: MergedLinkOptions | null = null;
let inflight: Promise<MergedLinkOptions> | null = null;

/** Test-only: clear the shared cache between cases. */
export function __resetLinkOptionsCache(): void { cache = null; inflight = null; }

async function load(): Promise<MergedLinkOptions> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const raw = await apiFetch<Partial<Record<LinkCategory, LinkOption[]>>>('/dispatch/link-options');
      const merged = defaultsAll();
      for (const cat of CATEGORIES) {
        merged[cat] = mergeLinkOptions(cat, Array.isArray(raw?.[cat]) ? raw![cat]! : []);
      }
      cache = merged;
      return merged;
    } catch {
      // Network/endpoint failure → hardcoded defaults (logged once).
      console.warn('[useLinkOptions] falling back to default link options');
      cache = defaultsAll();
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Returns merged-over-defaults linkage option lists. Never empty. */
export function useLinkOptions(): { options: MergedLinkOptions; loading: boolean } {
  const [options, setOptions] = useState<MergedLinkOptions>(() => cache ?? defaultsAll());
  const [loading, setLoading] = useState<boolean>(!cache);

  useEffect(() => {
    let alive = true;
    if (cache) { setOptions(cache); setLoading(false); return; }
    load().then((m) => { if (alive) { setOptions(m); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  return { options, loading };
}
