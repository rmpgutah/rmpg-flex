import { Hono } from "hono";

export function mountTrespassOrderRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/trespassorder", api);
}
