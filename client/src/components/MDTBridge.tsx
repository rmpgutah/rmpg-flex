import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';
import { useToast } from './ToastProvider';
import { useAuth } from '../context/AuthContext';
import { describeSignal, routeForSignal, severityForSignal, type MDTMsg } from '../utils/mdtSignal';

/**
 * Desktop side of the MDT link. This in-vehicle terminal polls
 * /api/mdt/inbox?endpoint=mdt and surfaces items the officer's phone pushed
 * (subject, plate, location, report-in-progress, text, ALPR hits, vehicle-OOS,
 * shift summary, call actions, evidence) as toasts. Mounted once, app-wide,
 * while signed in. Polling matches the phone end and the server channel (the
 * rewrite WebSocket is dead — see project memory). Signal → toast/route/severity
 * mapping lives in utils/mdtSignal (unit-tested).
 */
export default function MDTBridge() {
  const { addToast } = useToast();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!isAuthenticated) return;
    const poll = async () => {
      try {
        const res = await apiFetch<{ messages: MDTMsg[] }>('/mdt/inbox?endpoint=mdt');
        for (const m of res?.messages ?? []) {
          if (seen.current.has(m.id)) continue;
          seen.current.add(m.id);
          addToast(describeSignal(m), severityForSignal(m.type), 9000);
          const dest = routeForSignal(m.type, m.payload);
          if (dest) navigate(dest);
        }
      } catch {
        /* WAF challenge / offline / pre-deploy — stay silent */
      }
    };
    poll();
    const timer = setInterval(poll, 8000);
    return () => clearInterval(timer);
  }, [isAuthenticated, addToast, navigate]);

  return null;
}
