export type UnitCategory = 'distance' | 'speed' | 'weight' | 'temperature' | 'area' | 'volume' | 'time';

export interface UnitDef {
  label: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

export const UNITS: Record<UnitCategory, UnitDef[]> = {
  distance: [
    { label: 'Miles', toBase: (v) => v * 1609.344, fromBase: (v) => v / 1609.344 },
    { label: 'Kilometers', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
    { label: 'Yards', toBase: (v) => v * 0.9144, fromBase: (v) => v / 0.9144 },
    { label: 'Feet', toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
    { label: 'Meters', toBase: (v) => v, fromBase: (v) => v },
    { label: 'Nautical miles', toBase: (v) => v * 1852, fromBase: (v) => v / 1852 },
  ],
  speed: [
    { label: 'MPH', toBase: (v) => v * 0.44704, fromBase: (v) => v / 0.44704 },
    { label: 'km/h', toBase: (v) => v / 3.6, fromBase: (v) => v * 3.6 },
    { label: 'm/s', toBase: (v) => v, fromBase: (v) => v },
    { label: 'Knots', toBase: (v) => v * 0.514444, fromBase: (v) => v / 0.514444 },
    { label: 'ft/s', toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
  ],
  weight: [
    { label: 'Pounds', toBase: (v) => v * 0.453592, fromBase: (v) => v / 0.453592 },
    { label: 'Kilograms', toBase: (v) => v, fromBase: (v) => v },
    { label: 'Ounces', toBase: (v) => v * 0.0283495, fromBase: (v) => v / 0.0283495 },
    { label: 'Grams', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  ],
  temperature: [
    { label: '°F', toBase: (v) => (v - 32) * 5 / 9, fromBase: (v) => v * 9 / 5 + 32 },
    { label: '°C', toBase: (v) => v, fromBase: (v) => v },
    { label: 'K', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
  ],
  area: [
    { label: 'sq ft', toBase: (v) => v * 0.092903, fromBase: (v) => v / 0.092903 },
    { label: 'sq m', toBase: (v) => v, fromBase: (v) => v },
    { label: 'acres', toBase: (v) => v * 4046.86, fromBase: (v) => v / 4046.86 },
  ],
  volume: [
    { label: 'Gallons', toBase: (v) => v * 3.78541, fromBase: (v) => v / 3.78541 },
    { label: 'Liters', toBase: (v) => v, fromBase: (v) => v },
    { label: 'fl oz', toBase: (v) => v * 0.0295735, fromBase: (v) => v / 0.0295735 },
  ],
  time: [
    { label: 'Hours', toBase: (v) => v * 3600, fromBase: (v) => v / 3600 },
    { label: 'Minutes', toBase: (v) => v * 60, fromBase: (v) => v / 60 },
    { label: 'Seconds', toBase: (v) => v, fromBase: (v) => v },
  ],
};

export const CATEGORIES: UnitCategory[] = ['distance', 'speed', 'weight', 'temperature', 'area', 'volume', 'time'];

export function convertValue(cat: UnitCategory, fromIdx: number, toIdx: number, value: number): number {
  const units = UNITS[cat];
  const from = units[fromIdx];
  const to = units[toIdx];
  if (!from || !to || !Number.isFinite(value)) return NaN;
  return to.fromBase(from.toBase(value));
}

export function formatConverted(n: number, precision = 8): string {
  if (!Number.isFinite(n)) return '';
  return String(parseFloat(n.toFixed(precision)));
}

export function convertAll(cat: UnitCategory, fromIdx: number, value: number): { label: string; value: string }[] {
  const units = UNITS[cat];
  return units.map((u, i) => ({
    label: u.label,
    value: i === fromIdx ? formatConverted(value, 8) : formatConverted(convertValue(cat, fromIdx, i, value)),
  }));
}

export interface CadPreset {
  id: string;
  label: string;
  cat: UnitCategory;
  fromIdx: number;
  toIdx: number;
  value: string;
}

export const CAD_PRESETS: CadPreset[] = [
  { id: 'pursuit-60', label: '60 mph → ft/s', cat: 'speed', fromIdx: 0, toIdx: 4, value: '60' },
  { id: 'block-5280', label: '1 mile → feet', cat: 'distance', fromIdx: 0, toIdx: 3, value: '1' },
  { id: 'welfare-15', label: '15 min → hours', cat: 'time', fromIdx: 1, toIdx: 0, value: '15' },
];
