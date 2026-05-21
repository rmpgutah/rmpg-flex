import { Hono } from "hono";

export function mountMapSafetyRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/mapsafety", api);
}
