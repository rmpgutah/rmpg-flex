import { Hono } from "hono";

export function mountJailRosterRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/jailroster", api);
}
