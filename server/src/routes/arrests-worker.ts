import { Hono } from "hono";

export function mountArrestsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/arrests", api);
}
