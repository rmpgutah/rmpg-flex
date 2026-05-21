import { Hono } from "hono";

export function mountCompanyDocumentsRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/companydocuments", api);
}
