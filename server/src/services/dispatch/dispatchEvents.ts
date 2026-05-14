import { broadcastDispatchUpdate } from '../../utils/websocket';
import type { DispatchDomainEvent } from '../../types/dispatch';

export function emitDispatchEvent(event: DispatchDomainEvent): void {
  switch (event.type) {
    case 'dispatch.call.created':
      broadcastDispatchUpdate({ action: 'call_created', call: event.payload.call });
      return;
    case 'dispatch.call.updated':
      broadcastDispatchUpdate({ action: 'call_updated', call: event.payload.call });
      return;
  }
}
