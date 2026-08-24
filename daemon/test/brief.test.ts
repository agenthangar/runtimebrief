import { describe, expect, it } from "vitest";
import { buildProjectBrief } from "../src/brief.js";
import type { GitSummary } from "../src/adapters/filesystemGit.js";
import type { TranscriptRef } from "../src/types.js";

const now = new Date("2026-07-30T20:00:00.000Z");

function git(overrides: Partial<GitSummary> = {}): GitSummary {
  return {
    branch: "feature/brief",
    dirty: false,
    dirtyFileCount: 0,
    commits: [
      {
        hash: "a".repeat(40),
        author: "Dev",
        timestamp: "2026-07-30T19:30:00.000Z",
        message: "Add portfolio brief",
      },
    ],
    diffstatVsDefault: "3 files changed, 40 insertions(+)",
    defaultBranch: "main",
    todoCount: 0,
    fixmeCount: 0,
    recentlyModifiedFiles: [],
    lastCommitAt: "2026-07-30T19:30:00.000Z",
    ...overrides,
  };
}

function session(overrides: Partial<TranscriptRef> = {}): TranscriptRef {
  return {
    source: "codex",
    id: "session-123",
    path: "/private/session.jsonl",
    startedAt: new Date("2026-07-30T19:50:00.000Z"),
    endedAt: new Date("2026-07-30T19:58:00.000Z"),
    summary: "Build the evidence-backed dashboard",
    state: "active",
    stateReason: "Codex recorded in-progress commentary.",
    model: "gpt-5.6-sol",
    filesTouched: ["ios/ProjectsListView.swift"],
    toolUseCount: 4,
    ...overrides,
  };
}

describe("deterministic project briefs", () => {
  it("surfaces active work without invoking an analyst and cites every claim", () => {
    const brief = buildProjectBrief("RuntimeBrief", git(), [session()], now);
    expect(brief.state).toBe("active");
    expect(brief.headline).toBe("Agent work is in progress");
    expect(brief.activeSessionCount).toBe(1);
    expect(brief.headlineEvidence[0]?.kind).toBe("session");
    expect(brief.claims.some((claim) => claim.category === "progress")).toBe(true);
    expect(brief.claims.every((claim) => claim.evidence.length > 0)).toBe(true);
    expect(JSON.stringify(brief)).not.toContain("/private/session.jsonl");
  });

  it("reserves attention for sessions waiting on user input", () => {
    const waiting = session({
      state: "waiting",
      stateReason: "Codex requested user input.",
    });
    const brief = buildProjectBrief("RuntimeBrief", git(), [waiting], now);
    expect(brief.state).toBe("attention");
    expect(brief.headline).toBe("Waiting for your input");
    expect(brief.activeSessionCount).toBe(0);
    expect(brief.claims).toContainEqual(
      expect.objectContaining({
        id: "waiting-codex-session-123",
        category: "attention",
        text: expect.stringContaining("waiting for your input"),
      }),
    );
  });

  it("does not mark stale work or a dirty tree as attention", () => {
    const old = session({
      startedAt: new Date("2026-07-29T10:00:00.000Z"),
      endedAt: new Date("2026-07-29T10:30:00.000Z"),
    });
    const brief = buildProjectBrief("RuntimeBrief", git({ dirty: true, dirtyFileCount: 2 }), [old], now);
    expect(brief.state).toBe("recent");
    expect(brief.activeSessionCount).toBe(0);
    expect(brief.claims.some((claim) => claim.category === "attention")).toBe(false);
    expect(brief.claims.map((claim) => claim.text).join(" ")).toContain(
      "no completion event",
    );
    expect(brief.claims.map((claim) => claim.text).join(" ")).toContain(
      "2 uncommitted files",
    );
    const workingTree = brief.claims
      .flatMap((claim) => claim.evidence)
      .find((evidence) => evidence.id === "git-working-tree");
    expect(workingTree?.timestamp).toBe(now.toISOString());
  });

  it("treats a user-stopped session as recent context, not attention", () => {
    const stopped = session({
      state: "interrupted",
      stateReason: "The user stopped the Codex turn.",
    });
    const brief = buildProjectBrief(
      "RuntimeBrief",
      git({ dirty: true, dirtyFileCount: 1 }),
      [stopped],
      now,
    );
    expect(brief.state).toBe("recent");
    expect(brief.headline).toBe("Recent work is ready to review");
    expect(brief.headlineEvidence[0]?.detail).toContain("state: interrupted");
    expect(brief.claims.some((claim) => claim.category === "attention")).toBe(false);
    expect(brief.claims.map((claim) => claim.text).join(" ")).toContain(
      "recorded a stopped session",
    );
  });

  it("shows the latest completed session from every detected agent source", () => {
    const sessions = [
      session({
        source: "codex",
        id: "codex-desktop",
        summary: "Finish the desktop task",
        state: "completed",
        endedAt: new Date("2026-07-30T19:59:00.000Z"),
      }),
      session({
        source: "claude-code",
        id: "claude-desktop",
        summary: "Finish the Claude desktop task",
        state: "completed",
        endedAt: new Date("2026-07-30T19:58:00.000Z"),
      }),
      session({
        source: "cursor",
        id: "cursor-cli",
        summary: "Finish the Cursor CLI task",
        state: "completed",
        endedAt: new Date("2026-07-30T19:57:00.000Z"),
      }),
      session({
        source: "codex",
        id: "older-codex-cli",
        summary: "Older Codex CLI task",
        state: "completed",
        endedAt: new Date("2026-07-30T19:40:00.000Z"),
      }),
    ];

    const brief = buildProjectBrief("RuntimeBrief", git(), sessions, now);
    const completedSources = brief.claims
      .filter((claim) => claim.category === "completed")
      .flatMap((claim) => claim.evidence.map((evidence) => evidence.source))
      .filter((source) => source !== "git");

    expect(completedSources).toEqual(["codex", "claude-code", "cursor"]);
    expect(brief.claims.map((claim) => claim.text).join(" ")).not.toContain(
      "Older Codex CLI task",
    );
  });

  it("returns an evidence-backed unavailable state for unreadable projects", () => {
    const brief = buildProjectBrief("Ghost", null, [], now);
    expect(brief.state).toBe("unavailable");
    expect(brief.claims).toHaveLength(1);
    expect(brief.claims[0]?.evidence[0]?.kind).toBe("project-scan");
  });
});
