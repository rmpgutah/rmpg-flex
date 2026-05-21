import { Hono } from "hono";

export function mountWebAuthnRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/webauthn", api);
}
