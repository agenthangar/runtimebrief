import { describe, expect, it } from "vitest";
import { makeMemoryStore } from "../src/lib/storage";
import { ClaudeLaunchDraft, SessionLaunchDraft } from "../src/networking/drafts";

// Parity with ios/RuntimeBriefTests/ClaudeLaunchTests.swift retry-identity cases
describe("ClaudeLaunchDraft", () => {
  it("keeps the same request ID for the same task until cleared", async () => {
    const store = makeMemoryStore();
    const first = await ClaudeLaunchDraft.request("p", "scope", "Fix tests", "default", "manual", true, store);
    const again = await ClaudeLaunchDraft.request("p", "scope", "Fix tests", "default", "manual", true, store);
    expect(again.requestId).toBe(first.requestId);
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    await ClaudeLaunchDraft.clear("p", "scope", "Fix tests", "default", "manual", true, store);
    const fresh = await ClaudeLaunchDraft.request("p", "scope", "Fix tests", "default", "manual", true, store);
    expect(fresh.requestId).not.toBe(first.requestId);
  });

  it("treats model, permission mode, remote control, project and connection as part of the identity", async () => {
    const store = makeMemoryStore();
    const base = await ClaudeLaunchDraft.request("p", "scope", "Fix tests", "default", "manual", true, store);
    const variants = await Promise.all([
      ClaudeLaunchDraft.request("p", "scope", "Fix tests", "opus", "manual", true, store),
      ClaudeLaunchDraft.request("p", "scope", "Fix tests", "default", "plan", true, store),
      ClaudeLaunchDraft.request("p", "scope", "Fix tests", "default", "manual", false, store),
      ClaudeLaunchDraft.request("other", "scope", "Fix tests", "default", "manual", true, store),
      ClaudeLaunchDraft.request("p", "other-mac", "Fix tests", "default", "manual", true, store),
      ClaudeLaunchDraft.request("p", "scope", "Fix tests!", "default", "manual", true, store),
    ]);
    for (const variant of variants) expect(variant.requestId).not.toBe(base.requestId);
    expect(new Set(variants.map((variant) => variant.requestId)).size).toBe(variants.length);
  });

  it("uses the build-15 compatible key for default settings", async () => {
    // ["scope","p","Fix tests"] encoded like Foundation's JSONEncoder (slashes escaped).
    const key = await ClaudeLaunchDraft.key("p", "scope", "Fix tests", "default", "manual", true);
    expect(key).toMatch(/^runtimebrief\.claude\.request\.[0-9a-f]{64}$/);
    const withSlash = await ClaudeLaunchDraft.key("p", "scope", "a/b", "default", "manual", true);
    expect(withSlash).not.toBe(key);
  });
});

describe("SessionLaunchDraft", () => {
  const identity = {
    projectID: "p",
    scope: "scope",
    prompt: "Ship it",
    provider: "codex" as const,
    model: "default",
    permissionMode: "manual",
    reasoningEffort: "default",
    remoteControl: true,
  };

  it("produces a stable native request and omits default reasoning", async () => {
    const store = makeMemoryStore();
    const first = await SessionLaunchDraft.request(identity, store);
    expect(first.reasoningEffort).toBeNull();
    expect(first.provider).toBe("codex");
    const again = await SessionLaunchDraft.request(identity, store);
    expect(again.requestId).toBe(first.requestId);
    const high = await SessionLaunchDraft.request({ ...identity, reasoningEffort: "high" }, store);
    expect(high.requestId).not.toBe(first.requestId);
    expect(high.reasoningEffort).toBe("high");
    await SessionLaunchDraft.clear(identity, store);
    expect((await SessionLaunchDraft.request(identity, store)).requestId).not.toBe(first.requestId);
  });

  it("shares the legacy Claude identity so a retried Claude task keeps its ID", async () => {
    const store = makeMemoryStore();
    const legacy = await ClaudeLaunchDraft.request("p", "scope", "Ship it", "opus", "plan", true, store);
    const native = await SessionLaunchDraft.request(
      { ...identity, provider: "claude", model: "opus", permissionMode: "plan" },
      store,
    );
    expect(native.requestId).toBe(legacy.requestId);
    await SessionLaunchDraft.clear({ ...identity, provider: "claude", model: "opus", permissionMode: "plan" }, store);
    expect((await ClaudeLaunchDraft.request("p", "scope", "Ship it", "opus", "plan", true, store)).requestId).not.toBe(
      legacy.requestId,
    );
  });

  it("uses its own identity for Claude requests with explicit reasoning", async () => {
    const store = makeMemoryStore();
    const legacy = await ClaudeLaunchDraft.request("p", "scope", "Ship it", "opus", "plan", true, store);
    const reasoning = await SessionLaunchDraft.request(
      { ...identity, provider: "claude", model: "opus", permissionMode: "plan", reasoningEffort: "high" },
      store,
    );
    expect(reasoning.requestId).not.toBe(legacy.requestId);
  });
});
