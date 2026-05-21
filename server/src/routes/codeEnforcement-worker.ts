import { Hono } from "hono";

export function mountCodeEnforcementRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/codeenforcement", api);
}
