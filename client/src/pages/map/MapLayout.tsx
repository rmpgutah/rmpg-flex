import React from 'react';
import { useAuth } from '../../context/AuthContext';
import DispatcherMapLayout from './layouts/DispatcherMapLayout';
import FieldMapLayout from './layouts/FieldMapLayout';

const DISPATCHER_ROLES = new Set(['admin', 'manager', 'supervisor', 'dispatcher']);

export default function MapLayout() {
  const { user } = useAuth();
  const role = user?.role ?? '';

  if (DISPATCHER_ROLES.has(role)) return <DispatcherMapLayout />;
  return <FieldMapLayout />;
}
