// src/utils/sl-assessor/types.ts
// Salt Lake County re-exports the shared parcel-lookup types so existing
// call sites (40+ files) don't need import-path churn. New code should
// import directly from '../parcel-lookup/types'.
export type {
  OwnerType,
  ParcelSource,
  ParcelSummary,
  ParcelSale,
  Parcel,
} from '../parcel-lookup/types';
export {
  AssessorError,
  AssessorConfigError,
  AssessorTimeoutError,
  AssessorHttpError,
  AssessorParseError,
} from '../parcel-lookup/types';
