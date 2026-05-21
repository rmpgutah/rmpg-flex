import { Hono } from "hono";

export function mountUploadRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/upload", api);
}
