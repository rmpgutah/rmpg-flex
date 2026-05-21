import { Hono } from "hono";

export function mountDispatchAggregatesRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/dispatchaggregates", api);
}
