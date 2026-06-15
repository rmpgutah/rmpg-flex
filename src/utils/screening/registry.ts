import type { ScreeningAdapter } from './types';
import { interpolAdapter } from './interpolAdapter';
import { ofacAdapter } from './ofacAdapter';
import { utahSorAdapter } from './utahSorAdapter';
import { udcAdapter } from './udcAdapter';

const ADAPTERS: ScreeningAdapter[] = [
  interpolAdapter('red'),
  interpolAdapter('yellow'),
  interpolAdapter('un'),
  ofacAdapter,
  utahSorAdapter,
  udcAdapter,
];

export function getAdapters(): ScreeningAdapter[] { return ADAPTERS; }
export function getAdapter(sourceKey: string): ScreeningAdapter | undefined {
  return ADAPTERS.find((a) => a.sourceKey === sourceKey);
}
