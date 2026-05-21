import { Hono } from "hono";

export function mountMapGeofencesRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/mapgeofences", api);
}
