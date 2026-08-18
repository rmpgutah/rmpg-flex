import React from 'react';
import { useAuth } from '../../../context/AuthContext';
export default function FieldMapLayout() {
  const { user } = useAuth();
  const isReadOnly = user?.role === 'client_viewer';

  return (
    <div data-testid="field-map-layout" className="absolute inset-0 pointer-events-none z-10">
      {/* GPS HUD — personal position (props wired in Task 10) */}
      <div className="pointer-events-auto absolute bottom-4 left-4">
        {/* GpsHud receives live gps/nav/callbacks from useMapGps in Task 10 */}
      </div>
      {/* Field controls hidden for client_viewer */}
      {!isReadOnly && (
        <div className="pointer-events-auto absolute top-4 right-4">
          {/* Beat panel button and nav controls go here */}
        </div>
      )}
    </div>
  );
}
