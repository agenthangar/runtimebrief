import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { CLAUDE_MODELS, CLAUDE_PERMISSION_MODES, permissionModes, REASONING_EFFORTS, MODEL_ID, SESSION_PROVIDERS, LaunchError } from "../launches/types.js";
import { parseTerminalInput } from "../launches/terminalInput.js";

const startSchema = z.object({
  requestId: z.uuid().transform(value => value.toLowerCase()),
  model: z.enum(CLAUDE_MODELS).default("default"),
  permissionMode: z.enum(CLAUDE_PERMISSION_MODES).default("manual"),
  remoteControl: z.boolean().optional(),
  prompt: z.string().trim().min(1).max(8_000)
    .refine(value => !value.startsWith("/"), "Describe a task instead of a slash command.")
    .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "The prompt contains unsupported control characters."),
}).strict();

const sessionSchema = startSchema.extend({
  provider: z.enum(SESSION_PROVIDERS).default("claude"),
  model: z.string().regex(MODEL_ID).default("default"),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  permissionMode: z.string().default("manual"),
}).superRefine((body, context) => {
  const modes: readonly string[] = permissionModes(body.provider);
  if (!modes.includes(body.permissionMode)) context.addIssue({ code: "custom", message: "Unsupported permission mode" });
});
const inputSchema = z.object({ requestId: z.uuid().transform(value => value.toLowerCase()), data: z.string().refine(value => parseTerminalInput(value) !== null) }).strict();

const replySchema = z.object({
  requestId: z.uuid().transform(value => value.toLowerCase()), text: z.string().trim().min(1).max(8000).optional(),
  approvalId: z.string().min(1).max(128).optional(), optionId: z.string().min(1).max(128).optional(),
  answers: z.record(z.string().max(128), z.array(z.string().max(2000)).min(1).max(20)).optional(),
}).strict().refine(body => (!!body.text !== !!body.approvalId) && (!body.text || (!body.optionId && !body.answers)), "Send one message or one decision.");

// One app warms every project, then keeps the visible conversation current.
// Reserve enough read capacity for a portfolio without relaxing mutation limits.
const pollOptions = { config: { rateLimit: { max: 600, timeWindow: 60000 } } };

export function registerLaunchRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.register(async routes => {
    routes.setErrorHandler((error, _req, reply) => {
      if (error instanceof LaunchError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : null;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return reply.code(status).send({ error: "invalid_request", message: "The launch request could not be read. Check the task description and try again." });
      }
      return reply.code(503).send({ error: "launch_unavailable", message: "Session control is unavailable. Check your Mac." });
    });
    routes.get("/v1/providers", pollOptions, async (_req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      reply.header("Cache-Control", "no-store");
      return deps.launches.providers();
    });
    routes.get<{ Params: { id: string; provider: string } }>("/v1/projects/:id/providers/:provider", pollOptions, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      const provider = z.enum(SESSION_PROVIDERS).safeParse(req.params.provider);
      if (!provider.success) return reply.code(400).send({ error: "invalid_request" });
      reply.header("Cache-Control", "no-store");
      return deps.launches.models(req.params.id, provider.data);
    });
    routes.get<{ Params: { id: string; launchId: string } }>("/v1/projects/:id/sessions/:launchId/conversation", pollOptions, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      reply.header("Cache-Control", "no-store");
      return deps.launches.conversation(req.params.id, req.params.launchId);
    });
    routes.post<{ Params: { id: string; launchId: string } }>("/v1/projects/:id/sessions/:launchId/reply", { bodyLimit: 40000 }, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      const body = replySchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_request", message: "Check the message or decision." });
      return reply.code(202).send(await deps.launches.reply(req.params.id, req.params.launchId, body.data));
    });
    routes.get<{ Params: { id: string } }>("/v1/projects/:id/sessions", pollOptions, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      reply.header("Cache-Control", "no-store");
      return deps.launches.list(req.params.id);
    });
    routes.post<{ Params: { id: string } }>("/v1/projects/:id/sessions", { bodyLimit: 40000 }, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      const body = sessionSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_request", message: "Check the agent, model, permissions, and task description." });
      return reply.code(202).send(await deps.launches.start(req.params.id, body.data.requestId, body.data.prompt, { provider: body.data.provider, model: body.data.model, permissionMode: body.data.permissionMode, ...(body.data.reasoningEffort ? { reasoningEffort: body.data.reasoningEffort } : {}), remoteControl: body.data.remoteControl !== false }));
    });
    routes.get<{ Params: { id: string; launchId: string } }>("/v1/projects/:id/sessions/:launchId/terminal", pollOptions, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      reply.header("Cache-Control", "no-store");
      return deps.launches.terminal(req.params.id, req.params.launchId);
    });
    routes.post<{ Params: { id: string; launchId: string } }>("/v1/projects/:id/sessions/:launchId/input", { bodyLimit: 40000 }, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      const body = inputSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_request", message: "Use bounded terminal input and a unique request ID." });
      return reply.code(202).send(await deps.launches.input(req.params.id, req.params.launchId, body.data.requestId, body.data.data));
    });
    routes.get<{ Params: { id: string } }>("/v1/projects/:id/claude-launches", pollOptions, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      reply.header("Cache-Control", "no-store");
      return deps.launches.list(req.params.id);
    });
    routes.post<{ Params: { id: string } }>("/v1/projects/:id/claude-launches", { bodyLimit: 40_000 }, async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      const body = startSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_request", message: "Use a non-empty task description of up to 8,000 characters and a unique request ID." });
      const receipt = await deps.launches.start(req.params.id, body.data.requestId, body.data.prompt, {
        model: body.data.model, permissionMode: body.data.permissionMode,
        ...(body.data.remoteControl === undefined ? {} : { remoteControl: body.data.remoteControl }),
      });
      return reply.code(202).send(receipt);
    });
    routes.post<{ Params: { id: string; launchId: string } }>("/v1/projects/:id/claude-launches/:launchId/open", async (req, reply) => {
      if (!deps.launches) return reply.code(503).send({ error: "launch_unavailable" });
      return deps.launches.open(req.params.id, req.params.launchId);
    });
  });
}
