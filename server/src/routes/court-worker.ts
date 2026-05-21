import { Hono } from "hono";

export function mountCourtRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/court", api);
}
