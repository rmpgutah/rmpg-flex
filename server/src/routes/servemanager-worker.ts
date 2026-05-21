import { Hono } from "hono";

export function mountServemanagerRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/servemanager", api);
}
