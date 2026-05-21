import { Hono } from "hono";

export function mountForensicsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/forensics", api);
}
