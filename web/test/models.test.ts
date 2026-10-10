import { describe, expect, it } from "vitest";
import {
  decodeClaudeLaunch,
  launchSettingsLabel,
  launchStateLabel,
  providerPermissionExplanation,
  providerPermissionLabel,
  remoteControlLabel,
  remoteControlNativeURL,
  type ClaudeLaunch,
} from "../src/models/claudeLaunch";
import { decodeProjectSummaries } from "../src/models/decoders";
import { SessionTaskPrompt } from "../src/models/sessionTaskPrompt";
import { parseDate } from "../src/models/types";
import { formatRelative } from "../src/lib/relativeTime";

function launch(overrides: Partial<ClaudeLaunch> = {}): ClaudeLaunch {
  return {
    id: "r1",
    projectId: "p",
    name: "Task",
    createdAt: new Date(),
    state: "completed",
    message: "Done",
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
    ...overrides,
  };
}

// Parity with ios/RuntimeBriefTests/ClaudeLaunchTests.swift and SessionTaskPromptTests.swift
describe("ClaudeLaunch labels", () => {
  it("describes states the way the receipt card does", () => {
    expect(launchStateLabel(launch({ state: "starting" }))).toBe("Starting");
    expect(launchStateLabel(launch({ state: "running" }))).toBe("Running");
    expect(launchStateLabel(launch({ state: "needs_input", message: "Claude asked a question" }))).toBe("Needs a reply");
    expect(launchStateLabel(launch({ state: "needs_input", message: "Approval required" }))).toBe("Needs approval");
    expect(launchStateLabel(launch({ state: "completed" }))).toBe("Ready to review");
    expect(launchStateLabel(launch({ state: "failed" }))).toBe("Failed");
    expect(launchStateLabel(launch({ state: "stopped" }))).toBe("Stopped");
    expect(launchStateLabel(launch({ state: "in_desktop" }))).toBe("In Claude Desktop");
    expect(launchStateLabel(launch({ state: "mystery" }))).toBe("Status unavailable");
  });

  it("summarizes the original model and permission choices", () => {
    expect(launchSettingsLabel(launch())).toBe("Claude default · Manual");
    expect(launchSettingsLabel(launch({ model: "opus", permissionMode: "bypassPermissions" }))).toBe("Opus · Bypass");
    expect(launchSettingsLabel(launch({ model: "unknown-model" }))).toBe("Claude · Manual");
    expect(launchSettingsLabel(launch({ provider: "codex", model: "default" }))).toBe("Codex default · Manual");
    expect(launchSettingsLabel(launch({ provider: "codex", model: "gpt-6-luna", permissionMode: "auto" }))).toBe(
      "gpt-6-luna · Auto",
    );
    expect(launchSettingsLabel(launch({ provider: "cursor", permissionMode: "ask" }))).toBe("Cursor default · Ask");
  });

  it("only trusts claude.ai session links for Remote Control", () => {
    expect(remoteControlNativeURL({ state: "ready", url: "https://claude.ai/code/session_abc-123" })?.toString()).toBe(
      "https://claude.ai/code/session_abc-123",
    );
    expect(remoteControlNativeURL({ state: "ready", url: "https://evil.example/claude.ai/code/session_abc" })).toBeNull();
    expect(remoteControlNativeURL({ state: "ready", url: "https://claude.ai/code/session_abc?x=1" })).toBeNull();
    expect(remoteControlNativeURL({ state: "ready", url: null })).toBeNull();
    expect(remoteControlLabel({ state: "ready", url: null })).toBe("Remote Control connected");
    expect(remoteControlLabel({ state: "unavailable", url: null })).toBe("Remote Control needs setup in Claude");
    expect(remoteControlLabel({ state: "weird", url: null })).toBe("Remote Control connection unconfirmed");
  });

  it("explains native permission modes per provider", () => {
    expect(providerPermissionLabel("cursor", "ask")).toBe("Ask");
    expect(providerPermissionLabel("codex", "dontAsk")).toBe("Pre-approved Only");
    expect(providerPermissionLabel("codex", "custom")).toBe("Custom");
    expect(providerPermissionExplanation("codex", "manual")).toContain("Codex uses its workspace sandbox");
    expect(providerPermissionExplanation("cursor", "ask")).toBe("Cursor answers questions without making changes.");
    expect(providerPermissionExplanation("claude", "plan")).toBe("Claude explores and plans before making changes.");
  });

  it("decodes a receipt and rejects unknown providers", () => {
    const raw = {
      id: "r1",
      projectId: "p",
      name: "Task",
      createdAt: "2026-07-09T10:00:00.000Z",
      state: "running",
      message: "Working",
      nativeId: "n1",
      sessionId: null,
      cwd: "/dev",
      openedAt: null,
      provider: "codex",
      backend: "native-codex",
      remoteControl: { state: "ready", url: null },
    };
    const decoded = decodeClaudeLaunch(raw);
    expect(decoded.provider).toBe("codex");
    expect(decoded.createdAt.toISOString()).toBe("2026-07-09T10:00:00.000Z");
    expect(decoded.remoteControl?.state).toBe("ready");
    expect(() => decodeClaudeLaunch({ ...raw, provider: "gemini" })).toThrow();
    expect(() => decodeClaudeLaunch({ ...raw, createdAt: "yesterday" })).toThrow();
  });
});

describe("SessionTaskPrompt", () => {
  it("allows any non-empty task without slash commands or control characters", () => {
    expect(SessionTaskPrompt.isValid("Fix the flaky test")).toBe(true);
    expect(SessionTaskPrompt.isValid("ok")).toBe(true);
    expect(SessionTaskPrompt.isValid("  spaced  ")).toBe(true);
    expect(SessionTaskPrompt.isValid("line one\nline two\twith tab")).toBe(true);
    expect(SessionTaskPrompt.isValid("")).toBe(false);
    expect(SessionTaskPrompt.isValid("   ")).toBe(false);
    expect(SessionTaskPrompt.isValid("/clear")).toBe(false);
    expect(SessionTaskPrompt.isValid("bad\u0007bell")).toBe(false);
    expect(SessionTaskPrompt.isValid("bad\u007fdel")).toBe(false);
    expect(SessionTaskPrompt.isValid("a".repeat(8000))).toBe(true);
    expect(SessionTaskPrompt.isValid("a".repeat(8001))).toBe(false);
  });
});

describe("decoders", () => {
  it("accepts missing optional fields and rejects wrong shapes", () => {
    const projects = decodeProjectSummaries([{ id: "fixture", name: "Fixture" }]);
    expect(projects[0]).toEqual({ id: "fixture", name: "Fixture", lastActivityAt: null, branch: null, dirty: null, brief: null });
    expect(() => decodeProjectSummaries("nope")).toThrow();
    expect(() => decodeProjectSummaries([{ id: 1, name: "x" }])).toThrow();
    expect(() => decodeProjectSummaries([{ id: "x", name: "x", brief: { state: "bogus" } }])).toThrow();
  });

  it("parses fractional and plain ISO-8601 timestamps and rejects others", () => {
    expect(parseDate("2026-07-09T10:00:00.000Z")?.toISOString()).toBe("2026-07-09T10:00:00.000Z");
    expect(parseDate("2026-07-09T10:00:00Z")?.toISOString()).toBe("2026-07-09T10:00:00.000Z");
    expect(parseDate("2026-07-09T12:00:00+02:00")?.toISOString()).toBe("2026-07-09T10:00:00.000Z");
    expect(parseDate(null)).toBeNull();
    expect(() => parseDate("July 9")).toThrow();
    expect(() => parseDate(12345)).toThrow();
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  it("reads like SwiftUI's named relative presentation", () => {
    expect(formatRelative(new Date(now.getTime() - 10_000), now)).toBe("now");
    expect(formatRelative(new Date(now.getTime() - 35 * 60_000), now)).toBe("35 minutes ago");
    expect(formatRelative(new Date(now.getTime() - 22 * 3_600_000), now)).toBe("22 hours ago");
    expect(formatRelative(new Date(now.getTime() - 24 * 3_600_000), now)).toBe("yesterday");
    expect(formatRelative(new Date(now.getTime() - 6 * 86_400_000), now)).toBe("6 days ago");
    expect(formatRelative(new Date(now.getTime() - 7 * 86_400_000), now)).toBe("last week");
    expect(formatRelative(new Date(now.getTime() + 2 * 3_600_000), now)).toBe("in 2 hours");
  });
});
