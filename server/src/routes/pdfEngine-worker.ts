import { Hono } from "hono";

export function mountPdfEngineRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/pdfengine", api);
}
