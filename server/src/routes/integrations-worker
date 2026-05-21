import { Hono } from "hono";
import type { Env } from "../worker";
import type { JwtPayload } from "../worker-middleware/auth";

export function mountIntegrationsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  app.route("/api/integrations", api);
}
