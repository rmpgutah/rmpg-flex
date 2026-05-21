import { Hono } from "hono";

export function mountDispatchMessagesRoutes(app: any): void {
  const api = new Hono();
  app.route("/api/dispatchmessages", api);
}
