import { Hono } from "hono";

export function mountStatuteRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/statute", api);
}
