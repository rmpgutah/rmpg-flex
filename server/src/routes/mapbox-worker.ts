import { Hono } from "hono";

export function mountMapboxRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/mapbox", api);
}
