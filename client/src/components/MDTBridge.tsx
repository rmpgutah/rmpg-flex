import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';
import { useToast } from './ToastProvider';
import { useAuth } from '../context/AuthContext';

interface MDTMsg {
  id: number;
  type: string;
  payload: Record<string, any>;
  created_at: string;
}

function describe(m: MDTMsg): string {
  const p = m.payload || {};
  switch (m.type) {
    case 'person':
      return `📱 Phone → subject: ${p.name ?? ''}${p.dob ? ' · DOB ' + p.dob : ''}`.trim();
    case 'plate':
      return `📱 Phone → plate: ${p.plate ?? p.vehicle_plate ?? ''}`;
    case 'location':
      return `📱 Officer location received${p.label ? ': ' + p.label : ''}`;
    case 'nav':
      return '📱 Navigation point from phone';
    case 'draft':
      return `📱 Officer is filing: ${p.title ?? p.workflow ?? 'a report'}`;
    case 'text':
      return `📱 ${p.text ?? 'Message from phone'}`;
    case 'scan':
      return '📱 Phone sent a scan — open DL Search';
    default:
      return `📱 MDT message (${m.type})`;
  }
}

/**
 * Desktop side of the MDT link. This in-vehicle terminal polls
 * /api/mdt/inbox?endpoint=mdt and surfaces items the officer's phone pushed
 * (subject, plate, location, report-in-progress, text) as toasts. Mounted once,
 * app-wide, while signed in. Polling matches the phone end and the server
 * channel (the rewrite WebSocket is dead — see project memory).
 */
// The desktop view a phone push should jump to. Same-user channel: the officer
// scanned/looked something up on their phone and wants it on the big screen.
function routeFor(type: string): string | null {
  switch (type) {
    case 'scan':
    case 'person':
      return '/dl-search';
    case 'plate':
      return '/ncic';
    case 'location':
    case 'nav':
      return '/map';
    default:
      return null;
  }
}

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
          addToast(describe(m), 'info', 9000);
          const dest = routeFor(m.type);
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
