// ============================================================
// RMPG Flex — Record Type Icons
// ------------------------------------------------------------
// Maps a record's *type* to a lucide glyph for the no-photo tile
// (RecordAvatar). One isolated, well-commented decision table per
// record family so the list/hero tiles read at a glance:
//   • vehicleIcon()  — body_style → car/truck/bike/…
//   • propertyIcon() — property/structure/business type → home/store/…
//   • businessIcon() — industry / entity type → store/factory/scale/…
//
// DECISION POINT — Christopher, tune the keyword buckets below to match
// how RMPG classifies vehicles / properties / businesses. Matching is
// case-insensitive + substring-based, so "Pickup Truck", "pickup", and
// "TRUCK" all resolve the same. Unmatched values fall through to a sane
// default (never a blank tile).
// ============================================================

import {
  User, Car, Truck, Bus, Bike, Caravan, Tractor,
  Building2, Home, Store, Warehouse, Factory, Hotel, School,
  Church, Landmark, Fuel, Utensils, Hospital,
  Briefcase, Scale, GraduationCap, HardHat, Stethoscope, Laptop, Banknote,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Default person glyph — exported so callers don't re-import lucide. */
export const PersonIcon: LucideIcon = User;

const lc = (s?: string | null) => (s || '').toLowerCase();
const hasAny = (hay: string, needles: string[]) => needles.some((n) => hay.includes(n));

// ── VEHICLES (body_style) ───────────────────────────────────
export function vehicleIcon(bodyStyle?: string | null): LucideIcon {
  const s = lc(bodyStyle);
  if (!s) return Car;
  if (hasAny(s, ['motorcycle', 'scooter', 'moped', 'bike'])) return Bike;
  if (hasAny(s, ['bus'])) return Bus;
  if (hasAny(s, ['semi', 'tractor'])) return Tractor;
  if (hasAny(s, ['trailer', 'caravan', 'rv', 'camper'])) return Caravan;
  if (hasAny(s, ['truck', 'pickup', 'flatbed', 'dump', 'tow', 'cargo van', 'box truck', 'atv', 'utv'])) return Truck;
  if (hasAny(s, ['van', 'minivan'])) return Truck;
  // sedan / coupe / hatchback / wagon / convertible / suv / crossover / other
  return Car;
}

// ── PROPERTIES (property_type / structure_type / business_type) ──
export function propertyIcon(p: {
  property_type?: string | null;
  structure_type?: string | null;
  business_type?: string | null;
}): LucideIcon {
  const s = `${lc(p.property_type)} ${lc(p.structure_type)} ${lc(p.business_type)}`;
  if (hasAny(s, ['restaurant', 'cafe', 'food', 'bar', 'diner', 'grill', 'eatery'])) return Utensils;
  if (hasAny(s, ['retail', 'store', 'shop', 'mall', 'market', 'boutique'])) return Store;
  if (hasAny(s, ['gas', 'fuel', 'station'])) return Fuel;
  if (hasAny(s, ['warehouse', 'storage', 'distribution', 'depot'])) return Warehouse;
  if (hasAny(s, ['industrial', 'factory', 'manufactur', 'plant', 'mill'])) return Factory;
  if (hasAny(s, ['hotel', 'motel', 'lodging', 'inn', 'hospitality'])) return Hotel;
  if (hasAny(s, ['school', 'education', 'university', 'college', 'academy', 'campus'])) return School;
  if (hasAny(s, ['hospital', 'clinic', 'medical', 'health', 'urgent care'])) return Hospital;
  if (hasAny(s, ['church', 'temple', 'mosque', 'worship', 'synagogue', 'religious'])) return Church;
  if (hasAny(s, ['bank', 'government', 'civic', 'municipal', 'court', 'library'])) return Landmark;
  if (hasAny(s, ['residential', 'home', 'house', 'apartment', 'condo', 'dwelling', 'duplex'])) return Home;
  // commercial / office / other → generic building
  return Building2;
}

// ── BUSINESSES (industry first, then entity type) ───────────
export function businessIcon(b: {
  industry?: string | null;
  business_type?: string | null;
}): LucideIcon {
  const s = `${lc(b.industry)} ${lc(b.business_type)}`;
  if (hasAny(s, ['restaurant', 'food', 'cafe', 'bar', 'hospitality', 'catering'])) return Utensils;
  if (hasAny(s, ['retail', 'store', 'shop', 'commerce', 'sales'])) return Store;
  if (hasAny(s, ['tech', 'software', 'it ', 'saas', 'computer', 'digital'])) return Laptop;
  if (hasAny(s, ['finance', 'bank', 'accounting', 'investment', 'insurance'])) return Banknote;
  if (hasAny(s, ['legal', 'law', 'attorney', 'paralegal'])) return Scale;
  if (hasAny(s, ['health', 'medical', 'clinic', 'dental', 'pharma'])) return Stethoscope;
  if (hasAny(s, ['construction', 'contractor', 'roofing', 'plumbing', 'electrical', 'hvac'])) return HardHat;
  if (hasAny(s, ['auto', 'vehicle', 'mechanic', 'dealership', 'garage'])) return Car;
  if (hasAny(s, ['education', 'school', 'training', 'tutoring'])) return GraduationCap;
  if (hasAny(s, ['manufactur', 'industrial', 'factory', 'production'])) return Factory;
  if (hasAny(s, ['logistics', 'transport', 'shipping', 'freight', 'trucking', 'delivery'])) return Truck;
  if (hasAny(s, ['real estate', 'property', 'realty'])) return Building2;
  if (hasAny(s, ['warehouse', 'storage', 'distribution'])) return Warehouse;
  // generic / entity-type only (LLC, Corp, Sole Prop) → briefcase
  return Briefcase;
}
