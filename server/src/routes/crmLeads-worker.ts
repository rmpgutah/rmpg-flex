import { Hono } from "hono";

export function mountCrmLeadsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/crmleads", api);
}
