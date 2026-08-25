import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { FilesystemGitAdapter } from "../src/adapters/filesystemGit.js";
import { ClaudeCodeSessionsAdapter } from "../src/adapters/claudeCodeSessions.js";
import { AnswerCache } from "../src/analyst/cache.js";
import { createAnalystService } from "../src/analyst/service.js";
import type {
  AnalystBackendEvent,
  AnalystBackendRunner,
} from "../src/analyst/codexCli.js";
import { DecisionStore } from "../src/decisions/store.js";
import { VERSION } from "../src/version.js";
import { authHeaders, git, makeFixtureRepo, testConfig, tmpdir, TEST_TOKEN } from "./helpers.js";

/**
 * Boots the real server on a random port against a fixture project and hits
 * every endpoint over real HTTP, with and without the token. The Codex CLI
 * child process is mocked at the service boundary.
 */
describe("daemon integration", () => {
  let app: FastifyInstance;
  let base: string;
  let repo: string;
  let cacheDir: string;
  let trustedRoot: string;
  let backendCalls: { evidencePacket: string; systemPrompt: string }[];

  beforeAll(async () => {
    repo = makeFixtureRepo({ dirty: true });
    cacheDir = tmpdir("integ-cache");
    trustedRoot = tmpdir("integ-trusted-root");
    backendCalls = [];
    const config = testConfig({
      project_roots: [trustedRoot],
      projects: [
        {
          id: "fixture",
          name: "Fixture App",
          path: repo,
          allowed_actions: ["run-tests"],
        },
      ],
    });
    const adapters = [new FilesystemGitAdapter(), new ClaudeCodeSessionsAdapter(tmpdir("no-claude"))];
    const fakeRunner: AnalystBackendRunner = async function* (params) {
      backendCalls.push({
        evidencePacket: params.evidencePacket,
        systemPrompt: params.systemPrompt,
      });
      yield {
        type: "result",
        costUsd: 0,
        finalText: "Feature branch in progress, tests green. [git-working-tree]",
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    const analyst = createAnalystService(config, adapters, {
      runner: fakeRunner,
      cache: new AnswerCache(path.join(cacheDir, "cache.db")),
    });
    app = buildServer({
      config,
      adapters,
      analyst,
      decisions: new DecisionStore(path.join(cacheDir, "decisions.db")),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (typeof address === "object" && address) base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(trustedRoot, { recursive: true, force: true });
  });

  it("rejects every endpoint without a token", async () => {
    const endpoints = [
      ["GET", "/v1/health"],
      ["GET", "/v1/projects"],
      ["GET", "/v1/projects/fixture"],
      ["GET", "/v1/projects/fixture/status"],
      ["POST", "/v1/projects/fixture/ask"],
      ["GET", "/v1/actions"],
      ["POST", "/v1/projects/fixture/actions"],
      ["POST", "/v1/actions/x/decision"],
    ] as const;
    for (const [method, url] of endpoints) {
      const res = await fetch(base + url, {
        method,
        ...(method === "POST"
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "x" }) }
          : {}),
      });
      expect(res.status, `${method} ${url}`).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("GET /v1/health", async () => {
    const res = await fetch(`${base}/v1/health`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(VERSION);
  });

  it("GET /v1/projects and /v1/projects/:id", async () => {
    const list = await (await fetch(`${base}/v1/projects`, { headers: authHeaders() })).json();
    expect(list[0]).toMatchObject({ id: "fixture", branch: "feature/test-branch", dirty: true });

    const card = await (
      await fetch(`${base}/v1/projects/fixture`, { headers: authHeaders() })
    ).json();
    expect(card.git.commits.length).toBeGreaterThan(0);

    const missing = await fetch(`${base}/v1/projects/nope`, { headers: authHeaders() });
    expect(missing.status).toBe(404);
  });

  it("GET /v1/projects/:id/status returns JSON by default", async () => {
    const res = await fetch(`${base}/v1/projects/fixture/status`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toBe("Feature branch in progress, tests green. [git-working-tree]");
    expect(body.cached).toBe(false);
    expect(body.costUsd).toBe(0);
    expect(body.evidence.some((item: { id: string }) => item.id === "git-working-tree")).toBe(true);
    // Only the filtered evidence packet and system prompt reach the backend.
    expect(backendCalls.at(-1)!.systemPrompt).toContain("project-state analyst");
    expect(backendCalls.at(-1)!.evidencePacket).toContain("feature/test-branch");
  });

  it("second status hit is served from cache", async () => {
    const before = backendCalls.length;
    const res = await fetch(`${base}/v1/projects/fixture/status`, { headers: authHeaders() });
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(backendCalls.length).toBe(before);
  });

  it("POST /v1/projects/:id/ask returns the enforced answer over SSE", async () => {
    const res = await fetch(`${base}/v1/projects/fixture/ask`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ question: "What changed today?" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const raw = await res.text();
    const events = raw.split("\n\n").filter((e) => e.trim().length > 0);
    const chunkEvents = events.filter((e) => e.startsWith("event: chunk"));
    expect(chunkEvents).toHaveLength(1);
    const doneEvent = events.find((e) => e.startsWith("event: done"));
    expect(doneEvent).toBeTruthy();
    const done = JSON.parse(doneEvent!.split("data: ")[1]!);
    expect(done.answer).toContain("tests green");
    const chunk = JSON.parse(chunkEvents[0]!.split("data: ")[1]!);
    expect(chunk.text).toBe(done.answer);
  });

  it("aborts the provider when a real HTTP client disconnects", async () => {
    const disconnectDir = tmpdir("disconnect");
    const disconnectConfig = testConfig({
      projects: [{ id: "fixture", name: "Fixture App", path: repo }],
    });
    let observedSignal: AbortSignal | undefined;
    let markBackendStarted!: () => void;
    let markProviderAborted!: () => void;
    const backendStarted = new Promise<void>((resolve) => {
      markBackendStarted = resolve;
    });
    const providerAborted = new Promise<void>((resolve) => {
      markProviderAborted = resolve;
    });
    const blockingRunner: AnalystBackendRunner = async function* (params) {
      observedSignal = params.signal;
      markBackendStarted();
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          markProviderAborted();
          resolve();
        };
        if (params.signal.aborted) onAbort();
        else params.signal.addEventListener("abort", onAbort, { once: true });
      });
    };
    const cache = new AnswerCache(path.join(disconnectDir, "cache.db"));
    const disconnectApp = buildServer({
      config: disconnectConfig,
      adapters: [new FilesystemGitAdapter()],
      analyst: createAnalystService(
        disconnectConfig,
        [new FilesystemGitAdapter()],
        { runner: blockingRunner, cache },
      ),
    });
    let request: http.ClientRequest | undefined;
    try {
      await disconnectApp.listen({ host: "127.0.0.1", port: 0 });
      const address = disconnectApp.server.address();
      if (typeof address !== "object" || !address) throw new Error("No test server address");
      request = http.request({
        host: "127.0.0.1",
        port: address.port,
        path: "/v1/projects/fixture/ask",
        method: "POST",
        headers: {
          ...authHeaders(),
          accept: "text/event-stream",
          "content-type": "application/json",
        },
      });
      // Destroying a client request intentionally produces ECONNRESET on some
      // Node versions. It is expected and must not become an unhandled error.
      request.on("error", () => {});
      request.end(JSON.stringify({ question: "Wait for disconnect" }));

      await backendStarted;
      request.destroy();
      await providerAborted;
      expect(observedSignal?.aborted).toBe(true);
    } finally {
      request?.destroy();
      await disconnectApp.close();
      cache.close();
      fs.rmSync(disconnectDir, { recursive: true, force: true });
    }
  });

  it("POST /v1/projects/:id/ask validates the body", async () => {
    const res = await fetch(`${base}/v1/projects/fixture/ask`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  it("analyst routes 404 on unknown projects", async () => {
    const res = await fetch(`${base}/v1/projects/ghost/status`, { headers: authHeaders() });
    expect(res.status).toBe(404);
  });

  it("records an allowlisted decision without executing it", async () => {
    const forbidden = await fetch(`${base}/v1/projects/fixture/actions`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ kind: "deploy", description: "Deploy now" }),
    });
    expect(forbidden.status).toBe(403);

    const proposed = await fetch(`${base}/v1/projects/fixture/actions`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "run-tests",
        description: "Run release tests",
        params: { suite: "release" },
      }),
    });
    expect(proposed.status).toBe(201);
    const action = await proposed.json();
    expect(action).toMatchObject({
      status: "pending",
      kind: "run-tests",
      execution: "not-supported",
    });

    const listed = await (
      await fetch(`${base}/v1/actions`, { headers: authHeaders() })
    ).json();
    expect(listed).toHaveLength(1);

    const resolved = await fetch(`${base}/v1/actions/${action.id}/decision`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ approved: true, nonce: "integration-decision-1" }),
    });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      status: "approved",
      execution: "not-supported",
    });
  });

  it("discovers new trusted-root projects and denies their actions by default", async () => {
    const discovered = path.join(trustedRoot, "new-fixture");
    fs.mkdirSync(discovered);
    git(discovered, "init", "-b", "main");

    const card = await fetch(`${base}/v1/projects/new-fixture`, {
      headers: authHeaders(),
    });
    expect(card.status).toBe(200);

    const proposed = await fetch(`${base}/v1/projects/new-fixture/actions`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ kind: "run-tests", description: "Run tests" }),
    });
    expect(proposed.status).toBe(403);

    const listed = await fetch(`${base}/v1/actions?projectId=new-fixture`, {
      headers: authHeaders(),
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([]);
  });

  it("still exposes no project mutation or execution endpoints", async () => {
    for (const [method, url] of [
      ["DELETE", "/v1/projects/fixture"],
      ["PUT", "/v1/projects/fixture"],
      ["POST", "/v1/actions/x/execute"],
    ] as const) {
      const res = await fetch(base + url, {
        method,
        headers: { ...authHeaders(TEST_TOKEN), "content-type": "application/json" },
        body: "{}",
      });
      expect([404, 405]).toContain(res.status);
    }
  });
});
