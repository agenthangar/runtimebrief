import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ServerDeps } from "../server.js";
import { ProjectNotFoundError } from "../analyst/service.js";

// Action proposals and decisions live in routes/decisions.ts. The analyst
// remains read-only and never creates or executes an action implicitly.

const askBodySchema = z.object({
  question: z.string().min(1).max(4000),
});

function wantsSSE(req: FastifyRequest): boolean {
  return (req.headers.accept ?? "").includes("text/event-stream");
}

export function registerAnalystRoutes(app: FastifyInstance, deps: ServerDeps) {
  const answerRequest = async (
    req: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
    question: string,
  ) => {
    const clientAbort = new AbortController();
    const abortOnDisconnect = () => {
      if (!reply.raw.writableEnded) clientAbort.abort();
    };
    reply.raw.once("close", abortOnDisconnect);
    let stream;
    try {
      stream = deps.analyst.ask(projectId, question, clientAbort.signal);
    } catch (err) {
      reply.raw.off("close", abortOnDisconnect);
      if (err instanceof ProjectNotFoundError) {
        return reply.code(404).send({ error: "not_found" });
      }
      throw err;
    }

    if (wantsSSE(req)) {
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      try {
        for await (const chunk of stream) {
          if (reply.raw.destroyed) break;
          if (chunk.type === "text") {
            reply.raw.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`);
          } else {
            reply.raw.write(
              `event: done\ndata: ${JSON.stringify({
                answer: chunk.answer,
                costUsd: chunk.costUsd,
                cached: chunk.cached,
                truncated: chunk.truncated,
                evidence: chunk.evidence,
              })}\n\n`,
            );
          }
        }
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: "not_found" })}\n\n`);
        } else {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: "analyst_failed" })}\n\n`);
        }
      } finally {
        reply.raw.off("close", abortOnDisconnect);
        reply.raw.end();
      }
      return reply;
    }

    // Plain JSON: collect the full answer.
    try {
      for await (const chunk of stream) {
        if (chunk.type === "done") {
          return reply.send({
            answer: chunk.answer,
            costUsd: chunk.costUsd,
            cached: chunk.cached,
            truncated: chunk.truncated,
            evidence: chunk.evidence,
          });
        }
      }
      return reply.code(500).send({ error: "analyst_failed" });
    } catch (err) {
      if (err instanceof ProjectNotFoundError) {
        return reply.code(404).send({ error: "not_found" });
      }
      req.log?.error?.(err);
      return reply.code(500).send({ error: "analyst_failed" });
    } finally {
      reply.raw.off("close", abortOnDisconnect);
    }
  };

  app.get<{ Params: { id: string } }>("/v1/projects/:id/status", async (req, reply) => {
    return answerRequest(req, reply, req.params.id, deps.analyst.statusQuestion);
  });

  app.post<{ Params: { id: string } }>("/v1/projects/:id/ask", async (req, reply) => {
    const parsed = askBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    return answerRequest(req, reply, req.params.id, parsed.data.question);
  });
}
