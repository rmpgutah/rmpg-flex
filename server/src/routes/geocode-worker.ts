import { Hono } from "hono";

export function mountGeocodeRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/geocode", api);
}
