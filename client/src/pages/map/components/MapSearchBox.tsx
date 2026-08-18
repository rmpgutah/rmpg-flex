import React, { useCallback } from 'react';
// @ts-expect-error — @mapbox/search-js-react types may be incomplete
import { SearchBox } from '@mapbox/search-js-react';
import { useMapContext } from '../MapContext';

interface MapSearchBoxProps {
  accessToken: string;
}

export default function MapSearchBox({ accessToken }: MapSearchBoxProps) {
  const { map } = useMapContext();

  const handleRetrieve = useCallback((result: any) => {
    if (!map) return;
    const coords = result?.features?.[0]?.geometry?.coordinates;
    if (!coords) return;
    const bbox = result?.features?.[0]?.properties?.bbox;
    if (bbox) {
      map.fitBounds(bbox as [number, number, number, number], { padding: 60, maxZoom: 16, duration: 800 });
    } else {
      map.flyTo({ center: coords, zoom: 15, duration: 800 });
    }
  }, [map]);

  return (
    <div className="absolute top-3 left-12 z-10 w-72">
      <SearchBox
        accessToken={accessToken}
        onRetrieve={handleRetrieve}
        proximity={map ? {
          lng: map.getCenter().lng,
          lat: map.getCenter().lat,
        } : undefined}
        options={{ language: 'en', country: 'US' }}
        theme={{
          variables: {
            colorBackground: 'var(--surface-raised)',
            colorBackgroundHover: 'var(--surface-sunken)',
            colorText: 'var(--text-primary)',
            colorSecondary: 'var(--text-secondary)',
            borderRadius: '2px',
          },
        }}
      />
    </div>
  );
}
