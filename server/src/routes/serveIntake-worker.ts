import { Hono } from "hono";

export function mountServeIntakeRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/serveintake", api);
}
