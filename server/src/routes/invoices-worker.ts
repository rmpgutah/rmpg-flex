import { Hono } from "hono";

export function mountInvoicesRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/invoices", api);
}
