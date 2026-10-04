import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { resolveWebRoot } from "../src/routes/web.js";
import { configSchema } from "../src/config.js";
import { authHeaders, testConfig, tmpdir } from "./helpers.js";

function makeDist(): string {
  const root = tmpdir("web-dist");
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>RuntimeBrief</title>");
  fs.writeFileSync(path.join(root, "assets", "index-abc123.js"), "console.log('app')");
  fs.writeFileSync(path.join(root, "assets", "index-abc123.css"), "body{}");
  fs.writeFileSync(path.join(root, "manifest.webmanifest"), '{"name":"RuntimeBrief"}');
  fs.writeFileSync(path.join(root, "icon-192.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(root, "secret.yaml"), "token: nope");
  return root;
}

function makeApp(webRoot: string | null): FastifyInstance {
  return buildServer({
    config: testConfig(),
    adapters: [],
    analyst: { answer: async () => ({}) } as never,
    webRoot,
  });
}

describe("web app routes", () => {
  let app: FastifyInstance;
  afterEach(async () => app?.close());

  it("serves the shell and assets without a token", async () => {
    const root = makeDist();
    app = makeApp(root);

    const shell = await app.inject({ method: "GET", url: "/" });
    expect(shell.statusCode).toBe(200);
    expect(shell.headers["content-type"]).toContain("text/html");
    expect(shell.headers["cache-control"]).toBe("no-cache");
    expect(shell.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(shell.headers["content-security-policy"]).toContain("connect-src 'self'");
    expect(shell.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(shell.headers["x-content-type-options"]).toBe("nosniff");
    expect(shell.body).toContain("RuntimeBrief");

    const index = await app.inject({ method: "GET", url: "/index.html" });
    expect(index.statusCode).toBe(200);

    const script = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(script.statusCode).toBe(200);
    expect(script.headers["content-type"]).toContain("text/javascript");
    expect(script.headers["cache-control"]).toContain("immutable");
    expect(script.body).toBe("console.log('app')");

    const stylesheet = await app.inject({ method: "GET", url: "/assets/index-abc123.css" });
    expect(stylesheet.headers["content-type"]).toContain("text/css");

    const manifest = await app.inject({ method: "GET", url: "/manifest.webmanifest" });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers["content-type"]).toContain("application/manifest+json");

    const icon = await app.inject({ method: "GET", url: "/icon-192.png" });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers["content-type"]).toBe("image/png");
  });

  it("keeps the API behind the bearer token", async () => {
    app = makeApp(makeDist());
    const health = await app.inject({ method: "GET", url: "/v1/health" });
    expect(health.statusCode).toBe(401);
    expect(health.json()).toEqual({ error: "unauthorized" });
    const authorized = await app.inject({ method: "GET", url: "/v1/health", headers: authHeaders() });
    expect(authorized.statusCode).toBe(200);
  });

  it("answers 401 for unknown paths and never lists or escapes the build directory", async () => {
    const root = makeDist();
    app = makeApp(root);
    for (const url of ["/projects/demo", "/app", "/assets", "/v1", "/.env"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
    const emptyAsset = await app.inject({ method: "GET", url: "/assets/" });
    expect(emptyAsset.statusCode).toBe(404);
    const traversal = await app.inject({ method: "GET", url: "/assets/..%2Findex.html" });
    expect(traversal.statusCode).toBe(404);
    const nested = await app.inject({ method: "GET", url: "/assets/nested/file.js" });
    expect(nested.statusCode).toBe(404);
    const missing = await app.inject({ method: "GET", url: "/assets/missing.js" });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["content-type"]).not.toContain("text/html");
  });

  it("only exposes files allowed by name, not every top-level file", async () => {
    const root = makeDist();
    app = makeApp(root);
    await app.ready();
    // Routes are fixed at startup: a file added later has no route and stays behind auth.
    fs.writeFileSync(path.join(root, "later.txt"), "added after boot");
    const later = await app.inject({ method: "GET", url: "/later.txt" });
    expect(later.statusCode).toBe(401);
  });

  it("does not count static requests against the API rate limit", async () => {
    app = makeApp(makeDist());
    for (let i = 0; i < 40; i++) {
      const res = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
      expect(res.statusCode).toBe(200);
    }
    const api = await app.inject({ method: "GET", url: "/v1/health", headers: authHeaders() });
    expect(api.statusCode).toBe(200);
  });

  it("stays API-only when no web root is configured", async () => {
    app = makeApp(null);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("resolveWebRoot", () => {
  it("returns the directory only when it contains index.html", () => {
    const root = makeDist();
    expect(resolveWebRoot(root)).toBe(path.resolve(root));
    const empty = tmpdir("web-empty");
    expect(resolveWebRoot(empty)).toBeNull();
    expect(resolveWebRoot(path.join(empty, "missing"))).toBeNull();
  });

  it("reads the web_app setting from server config", () => {
    expect(configSchema.parse({ auth: { token_hash: "x" } }).server.web_app).toBe(true);
    expect(configSchema.parse({ auth: { token_hash: "x" }, server: { web_app: false } }).server.web_app).toBe(false);
    expect(
      configSchema.parse({ auth: { token_hash: "x" }, server: { web_app: "/srv/runtimebrief-web" } }).server.web_app,
    ).toBe("/srv/runtimebrief-web");
    expect(() => configSchema.parse({ auth: { token_hash: "x" }, server: { web_app: "" } })).toThrow();
  });
});
