import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { LaunchError } from "../launches/types.js";

const startSchema = z.object({
  requestId: z.uuid().transform(value => value.toLowerCase()),
  prompt: z.string().trim().min(10).max(8_000)
    .refine(value => !value.startsWith("/"), "Describe a task instead of a slash command.")
    .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "The prompt contains unsupported control characters."),
}).strict();

export function registerLaunchRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.register(async routes => {
    routes.setErrorHandler((error, _req, reply) => {
      if (error instanceof LaunchError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : null;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return reply.code(status).send({ error: "invalid_request", message: "The launch request could not be read. Check the task description and try again." });
      }
      return reply.code(503).send({ error: "launch_unavailable", message: "Claude session control is unavailable. Check your Mac." });
    });
    routes.get<{ Params: { id: string } }>("/v1/projects/:id/claude-launches", async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      return deps.launches.list(req.params.id);
    });
    routes.post<{ Params: { id: string } }>("/v1/projects/:id/claude-launches", { bodyLimit: 40_000 }, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      const body = startSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_request", message: "Use a task description between 10 and 8,000 characters and a unique request ID." });
      const receipt = await deps.launches.start(req.params.id, body.data.requestId, body.data.prompt);
      return reply.code(202).send(receipt);
    });
    routes.post<{ Params: { id: string; launchId: string } }>("/v1/projects/:id/claude-launches/:launchId/open", async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      return deps.launches.open(req.params.id, req.params.launchId);
    });
  });
}
