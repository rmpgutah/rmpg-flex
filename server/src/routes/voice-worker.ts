import { Hono } from "hono";

export function mountVoiceRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/voice", api);
}
