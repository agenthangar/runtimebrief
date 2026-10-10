import { beforeEach, describe, expect, it } from "vitest";
import { DemoClaudeTasks } from "../src/demo/demoClaudeTasks";
import { DemoData } from "../src/demo/demoData";
import { DemoRuntimeBriefDataSource } from "../src/demo/demoDataSource";
import { EvidencePresentation } from "../src/models/evidencePresentation";
import { RuntimeBriefDataSourceFactory, RuntimeBriefModeStore, LiveRuntimeBriefDataSource } from "../src/networking/dataSource";
import { ProjectsStore } from "../src/networking/projectsStore";
import { RuntimeBriefClient } from "../src/networking/client";
import { makeMemoryStore } from "../src/lib/storage";
import { mockSettings, mockTransport } from "./mockTransport";

// Parity with ios/RuntimeBriefTests/DemoDataTests.swift
describe("DemoData", () => {
  beforeEach(() => DemoClaudeTasks.resetForTesting());

  it("ships three fictional projects with matching cards", () => {
    expect(DemoData.projects.map((project) => project.id)).toEqual([
      "demo-sample-tracker",
      "demo-catalog-builder",
      "demo-weather-widget",
    ]);
    for (const project of DemoData.projects) {
      const card = DemoData.card(project.id);
      expect(card.name).toBe(project.name);
      expect(card.brief?.headline).toBe(project.brief?.headline);
    }
    expect(() => DemoData.card("missing")).toThrow("The daemon doesn't know that project.");
  });

  it("sorts by recency and labels the states shown on the portfolio", () => {
    const [tracker, catalog, weather] = DemoData.projects;
    expect(tracker?.brief?.state).toBe("recent");
    expect(catalog?.brief?.state).toBe("attention");
    expect(weather?.brief?.state).toBe("quiet");
    expect(tracker!.lastActivityAt!.getTime()).toBeGreaterThan(catalog!.lastActivityAt!.getTime());
    expect(catalog!.lastActivityAt!.getTime()).toBeGreaterThan(weather!.lastActivityAt!.getTime());
  });

  it("answers with cited fictional evidence that presentation strips", () => {
    const answer = DemoData.analystAnswer(DemoData.projectID);
    expect(answer.cached).toBe(true);
    expect(answer.evidence?.map((ref) => ref.id)).toEqual(["demo-evidence-commit-001", "demo-evidence-session-001"]);
    const text = EvidencePresentation.text(answer.answer, answer.evidence ?? []);
    expect(text).not.toContain("[demo-evidence-");
    expect(text).toBe(
      "This fictional project is ready for review. Its export work is complete, all 24 demo checks pass, and no decision is waiting.",
    );
    const asked = DemoData.analystAnswer(DemoData.projectID, "Did the checks pass?");
    expect(asked.answer).toContain("fictional demo response");
  });

  it("never mentions a real-looking path, account or token", () => {
    const serialized = JSON.stringify(DemoData.cards);
    expect(serialized).not.toMatch(/\/Users\//);
    expect(serialized).not.toMatch(/Bearer /);
    expect(serialized).toContain("/demo/projects/");
  });
});

describe("DemoClaudeTasks", () => {
  beforeEach(() => DemoClaudeTasks.resetForTesting());

  it("creates an idempotent fictional receipt per request ID", () => {
    const tasks = DemoClaudeTasks.shared;
    const request = {
      requestId: "req-1",
      prompt: "Summarize",
      provider: "codex" as const,
      model: "demo-model",
      reasoningEffort: "high",
      permissionMode: "auto",
      remoteControl: true,
    };
    const first = tasks.start(DemoData.projectID, request);
    const again = tasks.start(DemoData.projectID, request);
    expect(again).toBe(first);
    expect(first.provider).toBe("codex");
    expect(first.backend).toBe("native-codex");
    expect(first.state).toBe("completed");
    expect(first.message).toBe("Demo task ready to review. No work was sent to a Mac.");
    expect(tasks.list(DemoData.projectID).launches).toHaveLength(1);
    expect(tasks.list("demo-catalog-builder").launches).toHaveLength(0);
  });

  it("offers every provider with demo models and permission modes", () => {
    const providers = DemoClaudeTasks.shared.list("demo").providers ?? [];
    expect(providers.map((provider) => provider.id)).toEqual(["claude", "codex", "cursor"]);
    const claude = providers.find((provider) => provider.id === "claude")!;
    expect(claude.models?.map((model) => model.id)).toEqual(["fable", "opus", "sonnet", "haiku"]);
    expect(claude.defaultModelLabel).toBe("opus");
    const codex = providers.find((provider) => provider.id === "codex")!;
    expect(codex.permissionModes).toEqual(["manual", "auto", "plan", "bypassPermissions", "dontAsk"]);
    const cursor = providers.find((provider) => provider.id === "cursor")!;
    expect(cursor.permissionModes).toContain("ask");
  });

  it("records conversation replies once per request ID", () => {
    const tasks = DemoClaudeTasks.shared;
    const launch = tasks.start(DemoData.projectID, {
      requestId: "req-2",
      prompt: "Summarize",
      provider: "cursor",
      model: "default",
      reasoningEffort: null,
      permissionMode: "manual",
      remoteControl: true,
    });
    const before = tasks.conversation(DemoData.projectID, launch.id);
    expect(before.writable).toBe(true);
    expect(before.messages).toHaveLength(1);
    tasks.reply(DemoData.projectID, launch.id, { requestId: "reply-1", text: "Thanks" });
    tasks.reply(DemoData.projectID, launch.id, { requestId: "reply-1", text: "Thanks" });
    const after = tasks.conversation(DemoData.projectID, launch.id);
    expect(after.messages.map((message) => message.role)).toEqual(["assistant", "user", "assistant"]);
  });

  it("refuses conversation replies when continuation is off", () => {
    const tasks = DemoClaudeTasks.shared;
    const launch = tasks.start(DemoData.projectID, {
      requestId: "req-3",
      prompt: "Summarize",
      provider: "codex",
      model: "default",
      reasoningEffort: null,
      permissionMode: "manual",
      remoteControl: false,
    });
    expect(tasks.conversation(DemoData.projectID, launch.id).writable).toBe(false);
    expect(() => tasks.reply(DemoData.projectID, launch.id, { requestId: "r", text: "x" })).toThrow();
    expect(() => tasks.terminal(DemoData.projectID, launch.id)).toThrow();
  });

  it("appends terminal input exactly once and keeps Claude out of the terminal", () => {
    const tasks = DemoClaudeTasks.shared;
    const codex = tasks.start(DemoData.projectID, {
      requestId: "req-4",
      prompt: "x",
      provider: "codex",
      model: "default",
      reasoningEffort: null,
      permissionMode: "manual",
      remoteControl: true,
    });
    const initial = tasks.terminal(DemoData.projectID, codex.id);
    expect(initial.writable).toBe(true);
    expect(initial.cols).toBe(60);
    tasks.input(DemoData.projectID, codex.id, { requestId: "in-1", data: "ls\r" });
    tasks.input(DemoData.projectID, codex.id, { requestId: "in-1", data: "ls\r" });
    const after = tasks.terminal(DemoData.projectID, codex.id);
    expect(after.screen.split("Demo received input.").length - 1).toBe(1);

    const claude = tasks.start(DemoData.projectID, {
      requestId: "req-5",
      prompt: "x",
      provider: "claude",
      model: "default",
      reasoningEffort: null,
      permissionMode: "manual",
      remoteControl: true,
    });
    expect(() => tasks.terminal(DemoData.projectID, claude.id)).toThrow();
  });
});

describe("data source boundary", () => {
  it("selects the demo source only when demo mode is enabled", () => {
    expect(RuntimeBriefDataSourceFactory.make(true)).toBeInstanceOf(DemoRuntimeBriefDataSource);
    expect(RuntimeBriefDataSourceFactory.make(false)).toBeInstanceOf(LiveRuntimeBriefDataSource);
    RuntimeBriefModeStore.setDemoEnabled(true);
    expect(RuntimeBriefDataSourceFactory.current()).toBeInstanceOf(DemoRuntimeBriefDataSource);
    RuntimeBriefModeStore.setDemoEnabled(false);
    expect(RuntimeBriefDataSourceFactory.current()).toBeInstanceOf(LiveRuntimeBriefDataSource);
  });

  it("demo voice status is immediate and never networked", async () => {
    const source = new DemoRuntimeBriefDataSource();
    const status = await source.voiceStatus(DemoData.projectID);
    expect(status.refreshing).toBe(false);
    expect(status.unavailable).toBe(false);
    expect(status.model).toBe("fictional demo");
    const events = [];
    for await (const event of source.streamAsk(DemoData.projectID, "q")) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("done");
    await expect(source.project("missing")).rejects.toThrow();
  });
});

describe("ProjectsStore", () => {
  it("caches for a minute, persists a snapshot and clears on connection change", async () => {
    const storage = makeMemoryStore();
    const { transport, requests } = mockTransport({ "/v1/projects": { body: '[{"id":"a","name":"A","lastActivityAt":"2026-07-09T10:00:00Z"}]' } });
    const live = new LiveRuntimeBriefDataSource(new RuntimeBriefClient({ settings: mockSettings, transport }));
    const store = new ProjectsStore(storage, () => false);
    expect(store.cachedSnapshot().projects).toHaveLength(0);
    const fresh = await store.refresh(live);
    expect(fresh[0]?.id).toBe("a");
    expect(await store.projects(live)).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(storage.get("backbrief.projects.snapshot.v1")).toContain('"id":"a"');

    const reloaded = new ProjectsStore(storage, () => false);
    expect(reloaded.cachedSnapshot().projects[0]?.lastActivityAt).toBeInstanceOf(Date);
    reloaded.clear();
    expect(reloaded.cachedSnapshot().projects).toHaveLength(0);
    expect(storage.get("backbrief.projects.snapshot.v1")).toBeNull();
  });

  it("serves the saved brief on network failure but not on auth failure", async () => {
    const storage = makeMemoryStore();
    const ok = mockTransport({ "/v1/projects": { body: '[{"id":"a","name":"A"}]' } });
    const store = new ProjectsStore(storage, () => false);
    await store.refresh(new LiveRuntimeBriefDataSource(new RuntimeBriefClient({ settings: mockSettings, transport: ok.transport })));
    store.invalidate();

    const offline = mockTransport({ "/v1/projects": { throws: new TypeError("Failed to fetch") } });
    const snapshot = await store.briefSnapshot(
      new LiveRuntimeBriefDataSource(new RuntimeBriefClient({ settings: mockSettings, transport: offline.transport })),
    );
    expect(snapshot.isSaved).toBe(true);
    expect(snapshot.projects).toHaveLength(1);

    const unauthorized = mockTransport({ "/v1/projects": { status: 401, body: "" } });
    await expect(
      store.briefSnapshot(
        new LiveRuntimeBriefDataSource(new RuntimeBriefClient({ settings: mockSettings, transport: unauthorized.transport })),
      ),
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("returns demo projects without caching them while demo mode is on", async () => {
    const storage = makeMemoryStore();
    const store = new ProjectsStore(storage, () => true);
    expect(store.cachedSnapshot().projects.map((project) => project.id)).toContain("demo-sample-tracker");
    await store.refresh();
    expect(storage.get("backbrief.projects.snapshot.v1")).toBeNull();
  });
});
