import { Hono } from "hono";

export function mountAiRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/ai", api);
}
