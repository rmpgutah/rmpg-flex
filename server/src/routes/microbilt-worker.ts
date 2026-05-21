import { Hono } from "hono";

export function mountMicrobiltRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/microbilt", api);
}
