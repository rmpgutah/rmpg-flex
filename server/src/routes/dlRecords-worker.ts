import { Hono } from "hono";

export function mountDlRecordsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/dlrecords", api);
}
