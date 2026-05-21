import { Hono } from "hono";

export function mountTraccarRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/traccar", api);
}
