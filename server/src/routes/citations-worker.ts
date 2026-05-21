import { Hono } from "hono";

export function mountCitationRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/citation", api);
}
