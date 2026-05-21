import { Hono } from "hono";

export function mountIntegrationsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/integrations", api);
}
