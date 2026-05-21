import { Hono } from "hono";

export function mountCasesRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/cases", api);
}
