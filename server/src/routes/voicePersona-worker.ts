import { Hono } from "hono";

export function mountVoicePersonaRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/voicepersona", api);
}
