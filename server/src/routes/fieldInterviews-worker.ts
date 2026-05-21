import { Hono } from "hono";

export function mountFieldInterviewRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/fieldinterview", api);
}
