import type { SorEnrichmentAdapter } from './types';
import { utahAdapter } from './adapters/utah';
import { idahoAdapter } from './adapters/idaho';
import { nevadaAdapter } from './adapters/nevada';
import { wyomingAdapter } from './adapters/wyoming';
import { coloradoAdapter } from './adapters/colorado';
import { arizonaAdapter } from './adapters/arizona';

/** Fixed 6-state set for this pass. Adding a 7th state = one new adapter
 *  file + one new entry here — nothing else changes. */
export const ADAPTERS: Record<string, SorEnrichmentAdapter> = {
  UT: utahAdapter,
  ID: idahoAdapter,
  NV: nevadaAdapter,
  WY: wyomingAdapter,
  CO: coloradoAdapter,
  AZ: arizonaAdapter,
};

export function getAdapterForJurisdiction(jurisdiction: string): SorEnrichmentAdapter | undefined {
  return ADAPTERS[jurisdiction.toUpperCase()];
}
