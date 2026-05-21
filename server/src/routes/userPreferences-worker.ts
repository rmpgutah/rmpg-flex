import { Hono } from "hono";

export function mountUserPreferencesRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/userpreferences", api);
}
