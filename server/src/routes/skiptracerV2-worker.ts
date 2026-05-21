import { Hono } from "hono";

export function mountSkipTracerV2Routes(app: any): void {
  const api = new Hono();
  app.route("/api/skiptracerv2", api);
}
