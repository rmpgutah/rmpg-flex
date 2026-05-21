import { Hono } from "hono";

export function mountDarRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/dar", api);
}
