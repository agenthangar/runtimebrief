import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerDeps } from "../server.js";
import {
  ActionAlreadyResolvedError,
  ActionExpiredError,
  ActionNotFoundError,
  DecisionNonceConflictError,
} from "../decisions/store.js";
import { projectsForConfig } from "../projectRegistry.js";
import type { ActionRecord } from "../types.js";

const proposeActionSchema = z.object({
  kind: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-_]*$/),
  description: z.string().min(1).max(1000),
  params: z.record(z.string(), z.unknown()).default({}),
  expiresInMinutes: z.number().int().min(1).max(1440).default(60),
});

const listActionsSchema = z.object({
  projectId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const resolveDecisionSchema = z.object({
  approved: z.boolean(),
  nonce: z.string().min(8).max(128),
});

export function serializeActionRecord(record: ActionRecord) {
  return {
    id: record.action.id,
    projectId: record.action.projectId,
    kind: record.action.kind,
    description: record.action.description,
    params: record.action.params,
    createdAt: record.action.createdAt.toISOString(),
    expiresAt: record.action.expiresAt.toISOString(),
    status: record.status,
    decision: record.decision
      ? {
          approved: record.decision.approved,
          decidedAt: record.decision.decidedAt.toISOString(),
          nonce: record.decision.nonce,
        }
      : null,
    execution: "not-supported" as const,
  };
}

export function registerDecisionRoutes(app: FastifyInstance, deps: ServerDeps) {
  const decisions = deps.decisions;
  if (!decisions) return;

  app.post<{ Params: { id: string } }>("/v1/projects/:id/actions", async (req, reply) => {
    const project = projectsForConfig(deps.config).find(
      (candidate) => candidate.id === req.params.id,
    );
    if (!project) return reply.code(404).send({ error: "not_found" });
    const parsed = proposeActionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    if (!(project.allowed_actions ?? []).includes(parsed.data.kind)) {
      return reply.code(403).send({ error: "action_not_allowed" });
    }
    const action = decisions.propose({
      projectId: project.id,
      kind: parsed.data.kind,
      description: parsed.data.description,
      params: parsed.data.params,
      expiresAt: new Date(Date.now() + parsed.data.expiresInMinutes * 60_000),
    });
    return reply.code(201).send(serializeActionRecord(action));
  });

  app.get("/v1/actions", async (req, reply) => {
    const parsed = listActionsSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    if (
      parsed.data.projectId &&
      !projectsForConfig(deps.config).some(
        (project) => project.id === parsed.data.projectId,
      )
    ) {
      return reply.code(404).send({ error: "not_found" });
    }
    return decisions
      .listPending({
        ...(parsed.data.projectId ? { projectId: parsed.data.projectId } : {}),
        limit: parsed.data.limit,
      })
      .map(serializeActionRecord);
  });

  app.post<{ Params: { actionId: string } }>(
    "/v1/actions/:actionId/decision",
    async (req, reply) => {
      const parsed = resolveDecisionSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
      try {
        const resolved = decisions.resolve(
          req.params.actionId,
          parsed.data.approved,
          parsed.data.nonce,
        );
        return serializeActionRecord(resolved);
      } catch (error) {
        if (error instanceof ActionNotFoundError) {
          return reply.code(404).send({ error: "not_found" });
        }
        if (error instanceof ActionExpiredError) {
          return reply.code(410).send({ error: "expired" });
        }
        if (
          error instanceof ActionAlreadyResolvedError ||
          error instanceof DecisionNonceConflictError
        ) {
          return reply.code(409).send({ error: "conflict" });
        }
        throw error;
      }
    },
  );
}
