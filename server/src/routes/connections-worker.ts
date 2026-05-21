import { Hono } from "hono";

export function mountConnectionsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/connections", api);
}
