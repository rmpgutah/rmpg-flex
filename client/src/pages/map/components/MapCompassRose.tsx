import React, { useEffect, useState, useRef } from 'react';

interface MapCompassRoseProps {
  mapInstance: google.maps.Map | null;
}

export default function MapCompassRose({ mapInstance }: MapCompassRoseProps) {
  const [heading, setHeading] = useState(0);
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);

  useEffect(() => {
    if (!mapInstance) return;

    const update = () => {
      const h = mapInstance.getHeading?.() || 0;
      setHeading(h);
    };

    update();

    // heading_changed fires when the user rotates the map (tilt mode or 45-degree imagery)
    listenerRef.current = google.maps.event.addListener(mapInstance, 'heading_changed', update);

    return () => {
      if (listenerRef.current) {
        google.maps.event.removeListener(listenerRef.current);
        listenerRef.current = null;
      }
    };
  }, [mapInstance]);

  if (!mapInstance) return null;

  // SVG rotates opposite to map heading so north always points to geographic north
  const rotation = -heading;

  return (
    <div
      aria-label="Compass rose"
      className="backdrop-blur-md shadow-xl"
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: 'rgba(13, 21, 32, 0.88)',
        border: '1px solid #1e3048',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        role="img"
        aria-label="Compass pointing north"
        width="36"
        height="36"
        viewBox="0 0 36 36"
        style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s ease-out' }}
      >
        {/* Cross lines (E-W and N-S subtle lines) */}
        <line x1="18" y1="6" x2="18" y2="30" stroke="#3a4f66" strokeWidth="0.5" />
        <line x1="6" y1="18" x2="30" y2="18" stroke="#3a4f66" strokeWidth="0.5" />

        {/* North arrow (gold) */}
        <polygon points="18,4 15.5,16 18,14 20.5,16" fill="#d4a017" />
        {/* South arrow (dim white) */}
        <polygon points="18,32 15.5,20 18,22 20.5,20" fill="#5a6e80" />
        {/* East arrow */}
        <polygon points="32,18 20,15.5 22,18 20,20.5" fill="#5a6e80" />
        {/* West arrow */}
        <polygon points="4,18 16,15.5 14,18 16,20.5" fill="#5a6e80" />

        {/* Cardinal letters */}
        <text x="18" y="3.5" textAnchor="middle" fill="#d4a017" fontSize="5" fontFamily="monospace" fontWeight="bold">N</text>
        <text x="18" y="35.5" textAnchor="middle" fill="#5a6e80" fontSize="4.5" fontFamily="monospace" fontWeight="bold">S</text>
        <text x="35" y="19.5" textAnchor="middle" fill="#5a6e80" fontSize="4.5" fontFamily="monospace" fontWeight="bold">E</text>
        <text x="1" y="19.5" textAnchor="middle" fill="#5a6e80" fontSize="4.5" fontFamily="monospace" fontWeight="bold">W</text>

        {/* Center dot */}
        <circle cx="18" cy="18" r="1.5" fill="#d4a017" opacity="0.6" />
      </svg>
    </div>
  );
}
