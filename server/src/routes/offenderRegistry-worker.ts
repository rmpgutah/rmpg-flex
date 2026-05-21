import { Hono } from "hono";

export function mountOffenderRegistryRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/offenderregistry", api);
}
