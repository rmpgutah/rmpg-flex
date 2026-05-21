import { Hono } from "hono";

export function mountDashcamVideoRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/dashcamvideo", api);
}
