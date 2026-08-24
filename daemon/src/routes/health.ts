import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance, version: string) {
  const startedAt = Date.now();
  app.get("/v1/health", async () => ({
    version,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  }));
}
