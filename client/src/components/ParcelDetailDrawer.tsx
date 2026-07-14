// client/src/components/ParcelDetailDrawer.tsx
// "Advanced data" expandable view — every typed Parcel field the assessor
// scrape captured, plus the raw_data_json catch-all for anything not
// promoted to a typed column yet. Tokens-only — no hex.

import { useState } from 'react';
import { useParcelDetail } from '../hooks/useParcelDetail';

interface Props {
  parcelNumber: string | null | undefined;
}

const FIELD_LABELS: Record<string, string> = {
  account_number: 'Account #', serial_number: 'Serial #', tax_district: 'Tax District',
  owner_of_record: 'Owner', owner_type: 'Owner Type', owner_mailing_address: 'Mailing Address',
  situs_address: 'Situs Address', situs_city: 'City', situs_zip: 'Zip', subdivision: 'Subdivision',
  land_acres: 'Land Acres', land_sqft: 'Land Sqft', land_value: 'Land Value', zoning: 'Zoning',
  year_built: 'Year Built', effective_year_built: 'Effective Year Built',
  total_bldg_sqft: 'Total Building Sqft', finished_sqft: 'Finished Sqft',
  basement_sqft: 'Basement Sqft', garage_sqft: 'Garage Sqft', stories: 'Stories',
  bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', construction_type: 'Construction Type',
  improvement_class: 'Improvement Class', improvement_value: 'Improvement Value',
  market_value_total: 'Total Market Value', market_value_land: 'Land Market Value',
  market_value_improvement: 'Improvement Market Value', taxable_value: 'Taxable Value',
  assessed_value: 'Assessed Value', tax_year: 'Tax Year', legal_description: 'Legal Description',
  plat: 'Plat', lot: 'Lot', block: 'Block',
};

function fmtValue(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

export function ParcelDetailDrawer({ parcelNumber }: Props) {
  const { parcel, loading, error, fetchDetail } = useParcelDetail();
  const [open, setOpen] = useState(false);

  if (!parcelNumber) return null;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !parcel) fetchDetail(parcelNumber);
  };

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={handleToggle}
        className="px-2 py-1 bg-surface-raised text-rmpg-200 border border-surface-raised hover:bg-surface-base">
        {open ? '▾' : '▸'} Full Parcel Detail
      </button>
      {open && (
        <div className="mt-1 p-2 border border-surface-raised bg-surface-base max-h-96 overflow-y-auto">
          {loading && <div className="text-rmpg-400">Loading…</div>}
          {error && <div className="text-red-400">{error}</div>}
          {parcel && (
            <>
              <table className="w-full">
                <tbody>
                  {Object.entries(FIELD_LABELS).map(([key, label]) => (
                    <tr key={key}>
                      <td className="text-rmpg-500 pr-2 align-top">{label}</td>
                      <td className="text-rmpg-200">{fmtValue(parcel[key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {Object.keys(parcel.raw_data_json ?? {}).length > 0 && (
                <>
                  <div className="mt-2 mb-1 font-semibold text-rmpg-300">
                    Raw scraped fields (unmapped)
                  </div>
                  <table className="w-full">
                    <tbody>
                      {Object.entries(parcel.raw_data_json).map(([k, v]) => (
                        <tr key={k}>
                          <td className="text-rmpg-500 pr-2 align-top">{k}</td>
                          <td className="text-rmpg-200">{fmtValue(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ParcelDetailDrawer;
