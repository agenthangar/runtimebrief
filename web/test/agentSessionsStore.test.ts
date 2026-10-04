import { describe, expect, it } from "vitest";
import { makeMemoryStore } from "../src/lib/storage";
import { AgentSessionsStore, cyrb53 } from "../src/networking/agentSessionsStore";
import { RuntimeBriefClient } from "../src/networking/client";
import { LiveRuntimeBriefDataSource } from "../src/networking/dataSource";
import { SessionReplyDraft } from "../src/networking/drafts";
import type { ProjectSummary } from "../src/models/types";
import { mockSettings, mockTransport } from "./mockTransport";

function source(stubs: Parameters<typeof mockTransport>[0]) {
  const { transport, requests } = mockTransport(stubs);
  return { source: new LiveRuntimeBriefDataSource(new RuntimeBriefClient({ settings: mockSettings, transport })), requests };
}

function project(id: string): ProjectSummary {
  return { id, name: "Fixture", lastActivityAt: null, branch: null, dirty: null, brief: null };
}

const emptyList = '{"capability":{"available":true,"message":"Ready"},"launches":[]}';

// Parity with ios/RuntimeBriefTests/AgentSessionsStoreTests.swift
describe("AgentSessionsStore", () => {
  it("background prefetch reuses fresh projects across repeated foreground refreshes", async () => {
    const { source: live, requests } = source({ "/sessions": { body: emptyList } });
    let now = Date.now();
    const store = new AgentSessionsStore({ identity: () => "fixture", source: () => live, cache: null, now: () => now });
    const projects = Array.from({ length: 28 }, (_, index) => project(`fixture-${index}`));
    await store.prefetch(projects);
    await store.prefetch(projects);
    await store.prefetch(projects);
    expect(requests).toHaveLength(28);
    await store.refresh(projects[0]!.id);
    expect(requests).toHaveLength(29);
    now += 61_000;
    await store.prefetch(projects);
    expect(requests).toHaveLength(57);
  });

  it("waits a minute after a rate limit instead of polling every three seconds", async () => {
    const { source: live, requests } = source({ "/sessions": { status: 429, body: "" } });
    let now = Date.now();
    const store = new AgentSessionsStore({ identity: () => "fixture", source: () => live, cache: null, now: () => now });
    await store.refresh("fixture");
    await store.refresh("fixture");
    expect(requests).toHaveLength(1);
    expect(store.errors.fixture).toBeDefined();
    now += 61_000;
    await store.refresh("fixture");
    expect(requests).toHaveLength(2);
  });

  it("warms provider health once without loading project models", async () => {
    const { source: live, requests } = source({
      "/v1/providers": { body: '{"providers":[{"id":"codex","available":true,"message":"Ready","checking":false}]}' },
    });
    const store = new AgentSessionsStore({ identity: () => "fixture", source: () => live, cache: null });
    await store.warm();
    await store.warm();
    expect(store.providers[0]?.available).toBe(true);
    expect(requests.map((request) => request.path)).toEqual(["/v1/providers"]);
  });

  it("keeps polling providers while they report checking", async () => {
    let calls = 0;
    const { transport } = mockTransport({});
    const live = new LiveRuntimeBriefDataSource(
      new RuntimeBriefClient({
        settings: mockSettings,
        transport: async (url, init) => {
          calls += 1;
          const checking = calls < 3;
          return new Response(
            JSON.stringify({ providers: [{ id: "codex", available: checking ? false : true, message: "x", checking }] }),
            { status: 200 },
          );
          void transport;
          void url;
          void init;
        },
      }),
    );
    const store = new AgentSessionsStore({ identity: () => "fixture", source: () => live, cache: null, sleep: async () => {} });
    await store.warm();
    expect(calls).toBe(3);
    expect(store.providers[0]?.available).toBe(true);
  });

  it("does not let a project opt-out contaminate other projects and clears on connection change", async () => {
    const disabled =
      '{"capability":{"available":false,"message":"Starting tasks is disabled for this project."},"launches":[],"providers":[{"id":"codex","available":false,"message":"Starting tasks is disabled for this project."}]}';
    const { source: live } = source({
      "/v1/providers": { body: '{"providers":[{"id":"codex","available":true,"message":"Ready"}]}' },
      "/sessions": { body: disabled },
    });
    let identity = "mac-one";
    const store = new AgentSessionsStore({ identity: () => identity, source: () => live, cache: null });
    await store.warm();
    await store.refresh("disabled");
    expect(store.providers[0]?.available).toBe(true);
    expect(store.cached("disabled")?.capability.available).toBe(false);
    identity = "mac-two";
    expect(store.cached("disabled")).toBeNull();
    expect(store.providers).toHaveLength(0);
  });

  it("loads saved cards before networking and keeps them visible on refresh failure", async () => {
    const cache = makeMemoryStore();
    const { source: live } = source({ "/sessions": { body: emptyList } });
    const first = new AgentSessionsStore({ identity: () => "fixture", source: () => live, cache });
    await first.refresh("fixture");
    expect(cache.keys().some((key) => key.startsWith("runtimebrief.agent-sessions."))).toBe(true);

    const { source: failing } = source({ "/sessions": { status: 503, body: "" } });
    const second = new AgentSessionsStore({ identity: () => "fixture", source: () => failing, cache });
    expect(second.cached("fixture")).not.toBeNull();
    expect(second.savedProjects.has("fixture")).toBe(true);
    await second.refresh("fixture");
    expect(second.cached("fixture")).not.toBeNull();
    expect(second.errors.fixture).toBeDefined();
  });

  it("does not persist demo or unconfigured scopes", async () => {
    const cache = makeMemoryStore();
    const { source: live } = source({ "/sessions": { body: emptyList } });
    const store = new AgentSessionsStore({ identity: () => "demo", source: () => live, cache });
    await store.refresh("demo-sample-tracker");
    expect(cache.keys()).toHaveLength(0);
  });

  it("notifies subscribers and exposes a stable snapshot", async () => {
    const { source: live } = source({ "/sessions": { body: emptyList } });
    const store = new AgentSessionsStore({ identity: () => "fixture", source: () => live, cache: null });
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    await store.refresh("fixture");
    expect(notifications).toBeGreaterThan(0);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().lists.fixture?.capability.message).toBe("Ready");
    unsubscribe();
  });

  it("remember() puts a fresh receipt first only for the expected connection", async () => {
    const { source: live } = source({ "/sessions": { body: emptyList } });
    const store = new AgentSessionsStore({ identity: () => "fixture", source: () => live, cache: null });
    const scope = store.connectionScope();
    const launch = {
      id: "r1",
      projectId: "fixture",
      name: "Task",
      createdAt: new Date(),
      state: "starting",
      message: "Starting",
      nativeId: null,
      sessionId: null,
      cwd: "/dev",
      openedAt: null,
      model: null,
      reasoningEffort: null,
      effectiveReasoningEffort: null,
      permissionMode: null,
      backend: null,
      tmuxTarget: null,
      launchState: null,
      activity: null,
      requestedRemoteControl: null,
      remoteControl: null,
      provider: null,
    };
    store.remember(launch, "someone-else");
    expect(store.cached("fixture")).toBeNull();
    store.remember(launch, scope);
    expect(store.cached("fixture")?.launches[0]?.id).toBe("r1");
    store.remember({ ...launch, state: "running" }, scope);
    expect(store.cached("fixture")?.launches).toHaveLength(1);
    expect(store.cached("fixture")?.launches[0]?.state).toBe("running");
  });
});

describe("cyrb53", () => {
  it("is deterministic and sensitive to the token", () => {
    expect(cyrb53("http://a|token-1")).toBe(cyrb53("http://a|token-1"));
    expect(cyrb53("http://a|token-1")).not.toBe(cyrb53("http://a|token-2"));
    expect(cyrb53("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("SessionReplyDraft", () => {
  it("reply IDs survive retries without storing text and are connection scoped", async () => {
    const store = makeMemoryStore();
    const body = { requestId: "ignored", text: "PRIVATE-REPLY-SENTINEL" };
    const first = await SessionReplyDraft.request("mac-one", "fixture", body, store);
    expect((await SessionReplyDraft.request("mac-one", "fixture", body, store)).requestId).toBe(first.requestId);
    expect((await SessionReplyDraft.request("mac-two", "fixture", body, store)).requestId).not.toBe(first.requestId);
    const persisted = store.keys().map((key) => `${key}=${store.get(key)}`).join("\n");
    expect(persisted).not.toContain("PRIVATE-REPLY-SENTINEL");
    await SessionReplyDraft.clear("mac-one", "fixture", body, store);
    expect((await SessionReplyDraft.request("mac-one", "fixture", body, store)).requestId).not.toBe(first.requestId);
  });
});
