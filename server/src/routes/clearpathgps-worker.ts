import { Hono } from "hono";

export function mountClearpathgpsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/clearpathgps", api);
}
