import { Hono } from "hono";

export function mountCrmProposalsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/crmproposals", api);
}
