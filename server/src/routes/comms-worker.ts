import { Hono } from "hono";

export function mountCommsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/comms", api);
}
