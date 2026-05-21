import { Hono } from "hono";

export function mountCrmRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/crm", api);
}
