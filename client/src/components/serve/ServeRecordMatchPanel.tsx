import { useEffect, useRef, useState } from 'react';
import { Building2, Home, KeyRound, AlertTriangle, Phone, User } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface PropertyMatch {
  id: number;
  name: string | null;
  address: string;
  gate_code: string | null;
  alarm_code: string | null;
  alarm_account: string | null;
  alarm_company: string | null;
  key_holder_name: string | null;
  key_holder_phone: string | null;
  post_orders: string | null;
  access_instructions: string | null;
  hazard_notes: string | null;
}

interface BusinessMatch {
  id: number;
  name: string;
  address: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  phone: string | null;
  notes: string | null;
}

interface LookupResult {
  property: PropertyMatch | null;
  business: BusinessMatch | null;
}

interface Props {
  address: string;
  businessName: string;
}

// Debounce hook: fires `value` only after `ms` of silence.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function ServeRecordMatchPanel({ address, businessName }: Props) {
  const [result, setResult] = useState<LookupResult | null>(null);
  const lastQuery = useRef('');

  const debouncedAddress = useDebounced(address, 700);
  const debouncedName = useDebounced(businessName, 700);

  useEffect(() => {
    const q = `${debouncedAddress}|${debouncedName}`;
    if (!debouncedAddress && !debouncedName) { setResult(null); return; }
    if (q === lastQuery.current) return;
    lastQuery.current = q;

    const params = new URLSearchParams();
    if (debouncedAddress) params.set('address', debouncedAddress);
    if (debouncedName) params.set('business_name', debouncedName);

    apiFetch<LookupResult>(`/serve-intake/record-lookup?${params}`).then((r) => {
      if (`${debouncedAddress}|${debouncedName}` === lastQuery.current) setResult(r);
    }).catch(() => {});
  }, [debouncedAddress, debouncedName]);

  const { property, business } = result ?? {};
  const hasPropData = property && (property.gate_code || property.alarm_code || property.key_holder_name
    || property.access_instructions || property.hazard_notes);
  const hasBizData = business && (business.owner_name || business.contact_name || business.phone);

  if (!hasPropData && !hasBizData) return null;

  return (
    <div className="panel-beveled bg-surface-raised border border-[#d4a017]/30">
      <div className="flex items-center gap-2 px-3 py-[5px] border-b border-[#d4a017]/20">
        <KeyRound className="w-3 h-3 text-[#d4a017]" />
        <span className="text-[10px] uppercase font-bold tracking-wider text-[#d4a017]">Records Match</span>
        <span className="text-[9px] text-rmpg-500 ml-1">— existing record found for this {hasPropData ? 'address' : 'business'}</span>
      </div>

      <div className="p-3 space-y-3">
        {hasPropData && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Home className="w-3 h-3 text-rmpg-400" />
              <span className="text-[9px] uppercase font-bold tracking-wider text-rmpg-400">Property Record</span>
              <span className="text-[9px] text-rmpg-600 truncate">{property.name || property.address}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
              {property.gate_code && (
                <div className="flex items-center gap-1">
                  <span className="text-rmpg-500">Gate:</span>
                  <span className="font-mono text-[#d4a017] font-bold">{property.gate_code}</span>
                </div>
              )}
              {property.alarm_code && (
                <div className="flex items-center gap-1">
                  <span className="text-rmpg-500">Alarm:</span>
                  <span className="font-mono text-[#d4a017] font-bold">{property.alarm_code}</span>
                  {property.alarm_company && <span className="text-rmpg-600">({property.alarm_company})</span>}
                </div>
              )}
              {property.key_holder_name && (
                <div className="flex items-center gap-1 col-span-2">
                  <User className="w-3 h-3 text-rmpg-500" />
                  <span className="text-rmpg-500">Key holder:</span>
                  <span className="text-rmpg-200">{property.key_holder_name}</span>
                  {property.key_holder_phone && (
                    <span className="text-rmpg-400 flex items-center gap-0.5">
                      <Phone className="w-2.5 h-2.5" />{property.key_holder_phone}
                    </span>
                  )}
                </div>
              )}
              {property.access_instructions && (
                <div className="col-span-2 text-rmpg-400 leading-tight">{property.access_instructions}</div>
              )}
              {property.hazard_notes && (
                <div className="col-span-2 flex items-start gap-1 text-amber-400">
                  <AlertTriangle className="w-3 h-3 mt-px flex-shrink-0" />
                  <span>{property.hazard_notes}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {hasBizData && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Building2 className="w-3 h-3 text-rmpg-400" />
              <span className="text-[9px] uppercase font-bold tracking-wider text-rmpg-400">Business Record</span>
              <span className="text-[9px] text-rmpg-600 truncate">{business.name}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
              {business.owner_name && (
                <div className="flex items-center gap-1">
                  <span className="text-rmpg-500">Owner:</span>
                  <span className="text-rmpg-200">{business.owner_name}</span>
                  {business.owner_phone && <span className="text-rmpg-400">{business.owner_phone}</span>}
                </div>
              )}
              {business.contact_name && (
                <div className="flex items-center gap-1">
                  <span className="text-rmpg-500">Contact:</span>
                  <span className="text-rmpg-200">{business.contact_name}</span>
                  {business.contact_phone && <span className="text-rmpg-400">{business.contact_phone}</span>}
                </div>
              )}
              {business.phone && business.phone !== business.owner_phone && business.phone !== business.contact_phone && (
                <div className="flex items-center gap-1">
                  <Phone className="w-2.5 h-2.5 text-rmpg-500" />
                  <span className="text-rmpg-400">{business.phone}</span>
                </div>
              )}
              {business.notes && !business.notes.startsWith('Auto-created') && (
                <div className="col-span-2 text-rmpg-400 leading-tight truncate">{business.notes}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
