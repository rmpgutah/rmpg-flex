import { Hono } from "hono";

export function mountShiftPlanRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/shiftplan", api);
}
