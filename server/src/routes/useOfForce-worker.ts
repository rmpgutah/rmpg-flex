import { Hono } from "hono";

export function mountUseOfForceRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/useofforce", api);
}
