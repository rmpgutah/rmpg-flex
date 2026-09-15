import { useGpsTracking } from '../hooks/useGpsTracking';

/**
 * Headless GPS uploader — mounts useGpsTracking with upload enabled and renders
 * nothing. Drop this into any route subtree that lives OUTSIDE <Layout> but
 * still needs to POST breadcrumbs to /dispatch/gps (e.g. /mobile, /field-camera).
 *
 * Layout already mounts its own useGpsTracking() for its children, and
 * NavigationPage mounts one with capture: true for the Drive HUD. This component
 * fills the gap for the remaining outside-Layout authenticated routes.
 */
export default function GpsUploader() {
  useGpsTracking({ upload: true });
  return null;
}
