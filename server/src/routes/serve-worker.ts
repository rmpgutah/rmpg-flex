import { Hono } from "hono";

export function mountServeRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/serve", api);
}
