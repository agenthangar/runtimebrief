import type { FastifyInstance, FastifyReply } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serve the built RuntimeBrief web app from the daemon's own origin.
 *
 * Only the static files that exist in the build directory at startup are
 * exposed, each on an explicit public route. The bearer-token check still
 * guards every `/v1` route, and unknown paths still answer 401 so the daemon
 * reveals nothing new. The browser app reads `/v1` on the same origin, so no
 * CORS exposure is needed. Hashed `/assets` files are immutable; the HTML
 * shell is revalidated on each load and carries a strict CSP.
 */
export interface WebAppOptions {
  /** Directory containing `index.html` and `assets/`. */
  root: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

/** Default location of the sibling `web/dist` build in a source checkout. */
export function defaultWebRoot(): string {
  return fileURLToPath(new URL("../../../web/dist/", import.meta.url));
}

/** Resolve the directory to serve, or null when no build is present. */
export function resolveWebRoot(configured?: string): string | null {
  const root = path.resolve(configured ?? defaultWebRoot());
  try {
    if (!fs.statSync(path.join(root, "index.html")).isFile()) return null;
  } catch {
    return null;
  }
  return root;
}

export const PUBLIC_ROUTE = { public: true, rateLimit: false } as const;

function sendFile(reply: FastifyReply, root: string, relative: string, cacheControl: string): FastifyReply {
  const resolved = path.resolve(root, relative);
  const relativeToRoot = path.relative(root, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot) || relativeToRoot.length === 0) {
    return reply.code(404).send({ error: "not_found" });
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return reply.code(404).send({ error: "not_found" });
  }
  if (!stat.isFile()) return reply.code(404).send({ error: "not_found" });
  const type = CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
  reply.header("Content-Type", type);
  reply.header("Content-Length", stat.size);
  reply.header("Cache-Control", cacheControl);
  reply.header("X-Content-Type-Options", "nosniff");
  if (type.startsWith("text/html")) {
    reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    reply.header("Referrer-Policy", "no-referrer");
  }
  return reply.send(fs.createReadStream(resolved));
}

export function registerWebRoutes(app: FastifyInstance, options: WebAppOptions): void {
  const root = path.resolve(options.root);
  const shell = (reply: FastifyReply) => sendFile(reply, root, "index.html", "no-cache");

  app.get("/", { config: PUBLIC_ROUTE }, async (_request, reply) => shell(reply));
  app.get("/index.html", { config: PUBLIC_ROUTE }, async (_request, reply) => shell(reply));

  // Vite emits content-hashed filenames under assets/, so they can be immutable.
  app.get<{ Params: { "*": string } }>("/assets/*", { config: PUBLIC_ROUTE }, async (request, reply) => {
    const name = request.params["*"];
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return reply.code(404).send({ error: "not_found" });
    return sendFile(reply, root, path.join("assets", name), "public, max-age=31536000, immutable");
  });

  // Top-level files such as the manifest and icons: register only what exists now.
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === "index.html" || entry.name.startsWith(".")) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(entry.name)) continue;
    const name = entry.name;
    app.get(`/${name}`, { config: PUBLIC_ROUTE }, async (_request, reply) =>
      sendFile(reply, root, name, "public, max-age=3600"),
    );
  }
}
