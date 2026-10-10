import { describe, expect, it } from "vitest";
import { RuntimeBriefClient, type AnalystStreamEvent } from "../src/networking/client";
import { RuntimeBriefError } from "../src/networking/errors";
import { normalizeURL } from "../src/networking/serverSettings";
import { mockSettings, mockTransport } from "./mockTransport";

function client(stubs: Parameters<typeof mockTransport>[0]) {
  const { transport, requests } = mockTransport(stubs);
  return { client: new RuntimeBriefClient({ settings: mockSettings, transport }), requests };
}

// Parity with ios/RuntimeBriefTests/APIClientTests.swift and ConnectionCheckTests.swift
describe("RuntimeBriefClient", () => {
  it("decodes the project list and attaches the bearer token", async () => {
    const json = `[{"id":"meal","name":"Sample Tracker App","lastActivityAt":"2026-07-09T10:00:00.000Z",
      "branch":"main","dirty":true,
      "brief":{"state":"recent","headline":"Recent work is ready to review",
        "headlineEvidence":[{"id":"git-working-tree","kind":"working-tree",
          "label":"Working tree · main","detail":"2 uncommitted files on main",
          "source":"git","timestamp":"2026-07-09T10:00:00.000Z"}],
        "updatedAt":"2026-07-09T10:00:00.000Z","activeSessionCount":0,
        "claims":[{"id":"dirty-working-tree","category":"context",
          "text":"2 uncommitted files in the working tree.",
          "evidence":[{"id":"git-working-tree","kind":"working-tree",
            "label":"Working tree · main","detail":"2 uncommitted files on main",
            "source":"git","timestamp":"2026-07-09T10:00:00.000Z"}]}]}},
     {"id":"ghost","name":"Ghost","lastActivityAt":null,"branch":null,"dirty":null}]`;
    const { client: c, requests } = client({ "/v1/projects": { body: json } });
    const projects = await c.projects();
    expect(projects).toHaveLength(2);
    expect(projects[0]?.id).toBe("meal");
    expect(projects[0]?.dirty).toBe(true);
    expect(projects[0]?.lastActivityAt).toBeInstanceOf(Date);
    expect(projects[0]?.brief?.state).toBe("recent");
    expect(projects[0]?.brief?.claims[0]?.evidence[0]?.id).toBe("git-working-tree");
    expect(projects[1]?.branch).toBeNull();
    expect(requests[0]?.headers.Authorization).toBe("Bearer test-token");
    expect(requests[0]?.path).toBe("/v1/projects");
  });

  it("reads voice status as a fast read of the last completed analysis", async () => {
    const json = `{"answer":"Done: Export checks passed. [git-working-tree]", "analyzedAt":"2026-09-30T12:00:00.000Z",
      "model":"gpt-6-luna","evidence":[],"refreshing":true,"unavailable":false}`;
    const { client: c, requests } = client({ "/v1/projects/sample/voice-status": { body: json } });
    const status = await c.voiceStatus("sample");
    expect(status.answer).toContain("Export checks passed");
    expect(status.model).toBe("gpt-6-luna");
    expect(status.refreshing).toBe(true);
    expect(requests[0]?.method).toBe("GET");
  });

  it("decodes the project card without touching the analyst", async () => {
    const json = `{"id":"meal","name":"Sample Tracker App","path":"/dev/meal",
      "lastActivityAt":"2026-07-09T10:03:00.000Z","git":null,
      "brief":{"state":"attention","headline":"Waiting for your input","headlineEvidence":[],
        "updatedAt":"2026-07-09T10:03:00.000Z","activeSessionCount":0,"claims":[]},
      "sessions":[{"source":"codex","id":"s1","startedAt":"2026-07-09T10:00:00.000Z",
        "endedAt":"2026-07-09T10:03:00.000Z","summary":"Build the dashboard","state":"waiting",
        "stateReason":"Codex requested user input.","gitBranch":"feature/brief","model":"gpt-5.6-sol",
        "filesTouched":["ios/ProjectsListView.swift"],"toolUseCount":4,"conclusion":"The dashboard is in progress."}]}`;
    const { client: c, requests } = client({ "/v1/projects/meal": { body: json } });
    const card = await c.project("meal");
    expect(card.brief?.state).toBe("attention");
    expect(card.sessions[0]?.state).toBe("waiting");
    expect(card.sessions[0]?.filesTouched).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("/v1/projects/meal");
  });

  it("decodes Xcode, TestFlight and App Store summaries", async () => {
    const json = `{"id":"ios-app","name":"iOS App","path":"/tmp/ios-app","lastActivityAt":null,
      "git":null,"brief":null,"sessions":[],
      "iosRelease":{
        "xcode":{"source":"xcodegen","projectFile":"project.yml","scheme":"Example",
          "bundleId":"com.example.app","marketingVersion":"1.4.0","buildNumber":"42"},
        "appStoreConnect":{"status":"available","checkedAt":"2026-07-31T10:00:00Z","message":null,"appId":"123",
          "latestTestFlightBuild":{"id":"build-42","marketingVersion":"1.4.0","buildNumber":"42",
            "uploadedAt":"2026-07-30T10:00:00Z","expiresAt":null,"expired":false,"processingState":"VALID",
            "audienceType":"APP_STORE_ELIGIBLE"},
          "appStoreVersion":{"id":"store-1.4","version":"1.4.0","buildNumber":"42",
            "state":"WAITING_FOR_REVIEW","createdAt":"2026-07-30T12:00:00Z"}}}}`;
    const { client: c } = client({ "/v1/projects/ios-app": { body: json } });
    const card = await c.project("ios-app");
    expect(card.iosRelease?.xcode.bundleId).toBe("com.example.app");
    expect(card.iosRelease?.appStoreConnect.latestTestFlightBuild?.processingState).toBe("VALID");
    expect(card.iosRelease?.appStoreConnect.appStoreVersion?.state).toBe("WAITING_FOR_REVIEW");
  });

  it("maps HTTP status to typed errors", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
      [404, "notFound"],
      [429, "rateLimited"],
      [500, "serverError"],
    ];
    for (const [status, kind] of cases) {
      const { client: c } = client({ "/v1/projects": { status, body: "{}" } });
      await expect(c.projects()).rejects.toMatchObject({ kind });
    }
    const { client: c } = client({ "/v1/projects": { status: 500, body: "{}" } });
    await expect(c.projects()).rejects.toThrow("The daemon returned an error (HTTP 500).");
  });

  it("throws notConfigured without settings and sends nothing", async () => {
    const { transport, requests } = mockTransport({});
    const c = new RuntimeBriefClient({ settings: { baseURL: null, token: null }, transport });
    await expect(c.projects()).rejects.toMatchObject({ kind: "notConfigured" });
    expect(requests).toHaveLength(0);
  });

  it("surfaces launch failure messages from 403/409/503 bodies", async () => {
    const { client: c } = client({
      "/sessions": { status: 409, body: JSON.stringify({ message: "Another Codex app owns this conversation." }) },
    });
    await expect(
      c.startSession("meal", {
        requestId: "r1",
        prompt: "Do it",
        provider: "codex",
        model: "default",
        reasoningEffort: null,
        permissionMode: "manual",
        remoteControl: true,
      }),
    ).rejects.toThrow("Another Codex app owns this conversation.");
  });

  it("falls back to claude-launches when the sessions route is missing", async () => {
    const list = `{"capability":{"available":true,"message":"Ready"},"launches":[]}`;
    const { client: c, requests } = client({
      "/sessions": { status: 404, body: "" },
      "/claude-launches": { body: list },
    });
    const result = await c.sessions("meal");
    expect(result.capability.available).toBe(true);
    expect(requests.map((request) => request.path)).toEqual([
      "/v1/projects/meal/sessions",
      "/v1/projects/meal/claude-launches",
    ]);
  });

  it("falls back to the legacy Claude launch route for Claude requests only", async () => {
    const launch = `{"id":"r1","projectId":"meal","name":"Task","createdAt":"2026-07-09T10:00:00.000Z",
      "state":"starting","message":"Starting","nativeId":null,"sessionId":null,"cwd":"/dev/meal","openedAt":null}`;
    const { client: c, requests } = client({ "/sessions": { status: 404, body: "" }, "/claude-launches": { body: launch } });
    const receipt = await c.startSession("meal", {
      requestId: "r1",
      prompt: "Do it",
      provider: "claude",
      model: "opus",
      reasoningEffort: null,
      permissionMode: "plan",
      remoteControl: false,
    });
    expect(receipt.id).toBe("r1");
    const legacy = requests[1];
    expect(legacy?.path).toBe("/v1/projects/meal/claude-launches");
    expect(JSON.parse(legacy?.body ?? "{}")).toEqual({
      requestId: "r1",
      prompt: "Do it",
      model: "opus",
      permissionMode: "plan",
      remoteControl: false,
    });

    const { client: codex } = client({ "/sessions": { status: 404, body: "" } });
    await expect(
      codex.startSession("meal", {
        requestId: "r2",
        prompt: "Do it",
        provider: "codex",
        model: "default",
        reasoningEffort: null,
        permissionMode: "manual",
        remoteControl: true,
      }),
    ).rejects.toMatchObject({ kind: "notFound" });
  });

  it("omits null optionals from POST bodies like Codable", async () => {
    const { client: c, requests } = client({ "/reply": { body: '{"accepted":true}' } });
    const result = await c.reply("meal", "launch-1", { requestId: "r9", text: "Go ahead", approvalId: null, optionId: null, answers: null });
    expect(result.accepted).toBe(true);
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ requestId: "r9", text: "Go ahead" });
  });

  it("posts the question and decodes the answer", async () => {
    const json = `{"answer":"All tests pass.","costUsd":0.03,"cached":false,"truncated":false}`;
    const { client: c, requests } = client({ "/v1/projects/meal/ask": { body: json } });
    const answer = await c.ask("meal", "Did tests pass?");
    expect(answer.answer).toBe("All tests pass.");
    expect(requests[0]?.method).toBe("POST");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ question: "Did tests pass?" });
  });

  it("streams SSE chunks and done", async () => {
    const sse = [
      'event: chunk\ndata: {"text":"The project "}\n\n',
      'event: chunk\ndata: {"text":"is fine."}\n\n',
      'event: done\ndata: {"answer":"The project is fine.","costUsd":0.01,"cached":false,"truncated":false}\n\n',
    ];
    const { client: c } = client({
      "/v1/projects/meal/status": { chunks: sse, headers: { "Content-Type": "text/event-stream" } },
    });
    const events: AnalystStreamEvent[] = [];
    for await (const event of c.streamStatus("meal")) events.push(event);
    expect(events.map((event) => (event.type === "chunk" ? event.text : event.type))).toEqual([
      "The project ",
      "is fine.",
      "done",
    ]);
    const done = events.at(-1);
    expect(done?.type === "done" && done.answer.answer).toBe("The project is fine.");
  });

  it("accepts a buffered JSON answer where the daemon does not stream", async () => {
    const { client: c } = client({
      "/v1/projects/meal/ask": {
        body: '{"answer":"Buffered.","costUsd":0,"cached":true,"truncated":false}',
        headers: { "Content-Type": "application/json" },
      },
    });
    const events: AnalystStreamEvent[] = [];
    for await (const event of c.streamAsk("meal", "q")) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0]?.type === "done" && events[0].answer.answer).toBe("Buffered.");
  });

  it("surfaces unauthorized from a stream", async () => {
    const { client: c } = client({ "/v1/projects/meal/status": { status: 401, body: "" } });
    await expect(async () => {
      for await (const _event of c.streamStatus("meal")) {
        /* drain */
      }
    }).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("maps transport failures to network errors", async () => {
    const { client: c } = client({ "/v1/projects": { throws: new TypeError("Failed to fetch") } });
    await expect(c.projects()).rejects.toMatchObject({ kind: "network" });
    await expect(c.projects()).rejects.toThrow("Couldn't reach your Mac: Failed to fetch");
  });

  it("reports a decoding failure for malformed JSON", async () => {
    const { client: c } = client({ "/v1/projects": { body: "not project JSON" } });
    await expect(c.projects()).rejects.toMatchObject({ kind: "decoding" });
  });
});

describe("checkConnection", () => {
  const health = '{"version":"1.0.0","uptime":12}';

  it("loads and decodes projects before reporting success", async () => {
    const { client: c, requests } = client({
      "/health": { body: health },
      "/projects": { body: '[{"id":"fixture","name":"Fixture"}]' },
    });
    const result = await c.checkConnection();
    expect(result.projectCount).toBe(1);
    expect(requests.map((request) => request.path)).toEqual(["/v1/health", "/v1/projects"]);
  });

  it("does not report connected when project data is unusable", async () => {
    for (const stub of [{ status: 503, body: "" }, { body: "not project JSON" }]) {
      const { client: c } = client({ "/health": { body: health }, "/projects": stub });
      const error = await c.checkConnection().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RuntimeBriefError);
      expect((error as RuntimeBriefError).kind).toBe("projectRefresh");
      expect((error as RuntimeBriefError).message).toContain("Connected to your Mac, but project data couldn't load.");
    }
  });
});

describe("normalizeURL", () => {
  it("normalizes bare hosts and ports like the iOS app", () => {
    expect(normalizeURL("192.168.1.5:8484")).toBe("http://192.168.1.5:8484");
    expect(normalizeURL("mini.tail1234.ts.net")).toBe("https://mini.tail1234.ts.net:443");
    expect(normalizeURL("https://mini.tail1234.ts.net")).toBe("https://mini.tail1234.ts.net:443");
    expect(normalizeURL("https://mini.example.com:9000")).toBe("https://mini.example.com:9000");
    expect(normalizeURL("http://localhost:5173/some/path")).toBe("http://localhost:5173");
    expect(normalizeURL("")).toBeNull();
    expect(normalizeURL("   ")).toBeNull();
    expect(normalizeURL("ftp://example.com")).toBeNull();
  });
});
