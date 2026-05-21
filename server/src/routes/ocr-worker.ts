import { Hono } from "hono";

export function mountOcrRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/ocr", api);
}
