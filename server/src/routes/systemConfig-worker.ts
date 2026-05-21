import { Hono } from "hono";

export function mountSystemConfigRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/systemconfig", api);
}
