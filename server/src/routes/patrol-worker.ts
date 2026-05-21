import { Hono } from "hono";

export function mountPatrolRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/patrol", api);
}
