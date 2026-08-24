import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Minimal sliding-window rate limiter, in-memory. This daemon serves a single
 * user; no need for a distributed store. TODO(phase2): make limits
 * configurable per route class if action endpoints ever land.
 */
export function makeRateLimitHook(maxPerMinute = 30) {
  const windows = new Map<string, number[]>();

  return async function rateLimitHook(req: FastifyRequest, reply: FastifyReply) {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const cutoff = now - 60_000;
    const hits = (windows.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length >= maxPerMinute) {
      windows.set(key, hits);
      return reply.code(429).send({ error: "rate_limited" });
    }
    hits.push(now);
    windows.set(key, hits);
    // Opportunistic cleanup so the map can't grow unbounded.
    if (windows.size > 1000) {
      for (const [k, v] of windows) {
        if (v.every((t) => t <= cutoff)) windows.delete(k);
      }
    }
  };
}
