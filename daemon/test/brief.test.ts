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
      startedAt: new Date("2026-07-30T10:00:00.000Z"),
      endedAt: new Date("2026-07-30T10:30:00.000Z"),
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

  it.each(["cursor", "codex", "claude-code"])(
    "does not repeat weeks-old %s stops ahead of current changes",
    (source) => {
      const stopped = session({
        source, state: "interrupted",
        startedAt: new Date("2026-07-16T10:00:00Z"),
        endedAt: new Date("2026-07-16T10:30:00Z"),
      });
      const brief = buildProjectBrief("Fixture", git(), [stopped], now);
      expect(brief.state).toBe("recent");
      expect(brief.claims[0]?.text).toBe("Latest commit: Add portfolio brief.");
      expect(brief.claims.some((claim) => claim.id.startsWith("interrupted-"))).toBe(false);
      expect(brief.headlineEvidence[0]?.kind).toBe("commit");
      expect(brief.headlineEvidence[0]?.timestamp).toBe(git().lastCommitAt);
    },
  );

  it.each(["interrupted", "active"] as const)(
    "expires %s lifecycle notices after 24 hours on subsequent scans",
    (state) => {
      const recorded = session({ state });
      const recent = buildProjectBrief("Fixture", null, [recorded], now);
      expect(recent.claims[0]?.id).toMatch(/^(interrupted|active)-/);
      const later = buildProjectBrief(
        "Fixture", null, [recorded], new Date("2026-07-31T20:00:00Z"),
      );
      expect(later.state).toBe("quiet");
      expect(later.claims[0]?.text).toContain("Earlier sessions are available in session history");
      expect(later.claims.some((claim) => /^(interrupted|stale)-/.test(claim.id))).toBe(false);
      expect(recorded.state).toBe(state);
    },
  );

  it("puts meaningful work ahead of recent stopped-session context", () => {
    const stopped = session({ source: "cursor", state: "interrupted" });
    const finished = session({
      id: "finished", state: "completed", endedAt: new Date("2026-07-30T19:59:00Z"),
    });
    const brief = buildProjectBrief("Fixture", git({ dirty: true, dirtyFileCount: 2 }), [stopped, finished], now);
    expect(brief.claims.map((claim) => claim.id)).toEqual([
      "dirty-working-tree", "completed-codex-finished", `commit-${"a".repeat(40)}`,
      "interrupted-cursor-session-123",
    ]);
    expect(brief.headlineEvidence[0]?.id).toBe("session-codex-finished");
  });

  it("chooses the newest completed session even when input is unordered", () => {
    const older = session({ id: "older", state: "completed", endedAt: new Date("2026-07-30T19:00:00Z") });
    const newer = session({ id: "newer", state: "completed" });
    const sessions = [older, newer];
    const brief = buildProjectBrief("Fixture", git(), sessions, now);
    expect(brief.claims[0]?.id).toBe("completed-codex-newer");
    expect(brief.headlineEvidence[0]?.id).toBe("session-codex-newer");
    expect(sessions).toEqual([older, newer]);
  });

  it("does not expire unresolved input requests along with old stops", () => {
    const waiting = session({ state: "waiting", endedAt: new Date("2026-07-16T10:30:00Z") });
    const brief = buildProjectBrief("Fixture", git(), [waiting], now);
    expect(brief.state).toBe("attention");
    expect(brief.claims[0]?.category).toBe("attention");
  });

  it("does not present undated or future-dated stops as recent events", () => {
    const brief = buildProjectBrief("Fixture", git(), [
      session({ state: "interrupted", startedAt: undefined, endedAt: undefined }),
      session({ id: "future", state: "interrupted", endedAt: new Date("2026-08-01T10:00:00Z") }),
    ], now);
    expect(brief.claims.some((claim) => claim.id.startsWith("interrupted-"))).toBe(false);
  });

  it("returns an evidence-backed unavailable state for unreadable projects", () => {
    const brief = buildProjectBrief("Ghost", null, [], now);
    expect(brief.state).toBe("unavailable");
    expect(brief.claims).toHaveLength(1);
    expect(brief.claims[0]?.evidence[0]?.kind).toBe("project-scan");
  });
});
