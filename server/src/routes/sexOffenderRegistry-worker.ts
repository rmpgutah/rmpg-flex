import { Hono } from "hono";

export function mountSexOffenderRegistryRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/sexoffenderregistry", api);
}
