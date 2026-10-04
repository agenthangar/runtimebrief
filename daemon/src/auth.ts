import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyToken } from "./config.js";

/**
 * Bearer-token auth. 401 with no detail on any failure — do not leak whether
 * the header was missing, malformed, or simply wrong.
 *
 * A route may opt out only by declaring `config: { public: true }` explicitly;
 * the static web-app shell and its assets are the sole users. Unknown paths
 * have no route config and therefore still require the token.
 */
export function makeAuthHook(tokenHash: string) {
  return async function authHook(req: FastifyRequest, reply: FastifyReply) {
    const routeConfig = req.routeOptions?.config as { public?: unknown } | undefined;
    if (routeConfig?.public === true) return;
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const presented = header.slice("Bearer ".length).trim();
    if (presented.length === 0 || !verifyToken(presented, tokenHash)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
}
