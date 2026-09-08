import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { FilesystemGitAdapter } from "../src/adapters/filesystemGit.js";
import { PortfolioService } from "../src/portfolio.js";
import type { ProjectConfig, RuntimeAdapter, TranscriptRef } from "../src/types.js";
import { makeFixtureRepo } from "./helpers.js";

describe("PortfolioService", () => {
  let repo: string | undefined;

  afterEach(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
    repo = undefined;
  });

  it("returns only unresolved input waits as attention", async () => {
    repo = makeFixtureRepo({ dirty: true });
    const project: ProjectConfig = { id: "fixture", name: "Fixture", path: repo };
    const waiting: TranscriptRef = {
      source: "codex",
      id: "waiting-session",
      path: "/private/not-returned.jsonl",
      startedAt: new Date("2026-07-31T11:59:00.000Z"),
      state: "waiting",
      summary: "Choose the release target",
    };
    const completed = Array.from({ length: 10 }, (_, index): TranscriptRef => ({
      source: "codex",
      id: `completed-${index}`,
      path: `/private/completed-${index}.jsonl`,
      startedAt: new Date(`2026-07-30T10:${String(index).padStart(2, "0")}:00.000Z`),
      endedAt: new Date(`2026-07-30T11:${String(index).padStart(2, "0")}:00.000Z`),
      state: "completed",
    }));
    const sessions: RuntimeAdapter = {
      id: "fixture-sessions",
      discover: async () => true,
      recentActivity: async () => [],
      transcriptPaths: async () => [...completed, waiting],
    };
    const portfolio = new PortfolioService(
      () => [project],
      [new FilesystemGitAdapter(), sessions],
      () => new Date("2026-07-31T12:00:00.000Z"),
    );

    expect((await portfolio.getProject("fixture"))?.brief.state).toBe("attention");
    const attention = await portfolio.listAttention("fixture");
    expect(attention).toHaveLength(1);
    expect(attention?.[0]?.summary).toMatch(/waiting for your input/);
    expect(JSON.stringify(attention)).not.toContain("uncommitted file");
    expect(JSON.stringify(attention)).not.toContain("/private/not-returned.jsonl");
  });

  it("returns explicit unknown evidence ids instead of guessing", async () => {
    repo = makeFixtureRepo({ dirty: true });
    const portfolio = new PortfolioService(
      () => [{ id: "fixture", name: "Fixture", path: repo! }],
      [new FilesystemGitAdapter()],
      () => new Date("2026-07-31T12:00:00.000Z"),
    );
    const result = await portfolio.getProjectEvidence("fixture", [
      "git-working-tree",
      "missing-evidence",
    ]);
    expect(result?.evidence.map((item) => item.id)).toEqual(["git-working-tree"]);
    expect(result?.unknownEvidenceIds).toEqual(["missing-evidence"]);
  });

  it("omits old stopped notices from the portfolio while retaining session history and evidence", async () => {
    const stopped: TranscriptRef = {
      source: "cursor", id: "old-stop", path: "/private/old-stop.jsonl",
      state: "interrupted", stateReason: "The user stopped the turn.",
      endedAt: new Date("2026-07-16T10:00:00Z"),
    };
    const adapter: RuntimeAdapter = {
      id: "fixture-sessions", discover: async () => true,
      recentActivity: async () => [], transcriptPaths: async () => [stopped],
    };
    const portfolio = new PortfolioService(
      () => [{ id: "fixture", name: "Fixture", path: "/fixture" }],
      [adapter], () => new Date("2026-07-31T12:00:00Z"),
    );
    const entries = await portfolio.listProjects();
    const card = await portfolio.getProject("fixture");
    expect(entries[0]?.brief.state).toBe("quiet");
    expect(entries[0]?.brief.claims[0]?.text).not.toContain("stopped session");
    expect(card?.brief).toEqual(entries[0]?.brief);
    expect(card?.sessions).toContainEqual(expect.objectContaining({ id: "old-stop", state: "interrupted" }));
    expect((await portfolio.getProjectEvidence("fixture", ["session-cursor-old-stop"]))?.evidence)
      .toContainEqual(expect.objectContaining({ id: "session-cursor-old-stop" }));
    expect(await portfolio.listAttention()).toEqual([]);
  });

  it("reads the project provider again on every registry read", async () => {
    repo = makeFixtureRepo();
    const projects: ProjectConfig[] = [];
    const portfolio = new PortfolioService(
      () => [...projects],
      [new FilesystemGitAdapter()],
      () => new Date("2026-07-31T12:00:00.000Z"),
    );

    expect(await portfolio.listProjects()).toEqual([]);
    projects.push({ id: "fixture", name: "Fixture", path: repo });
    expect((await portfolio.listProjects()).map((project) => project.id)).toEqual([
      "fixture",
    ]);
  });

  it("keeps each agent source's recent sessions instead of applying one global cap", async () => {
    repo = makeFixtureRepo();
    const project: ProjectConfig = { id: "fixture", name: "Fixture", path: repo };
    const adapter = (source: string): RuntimeAdapter => ({
      id: source,
      discover: async () => true,
      recentActivity: async () => [],
      transcriptPaths: async (_project, limit) =>
        Array.from({ length: limit }, (_, index): TranscriptRef => ({
          source,
          id: `${source}-${index}`,
          path: `/private/${source}-${index}.jsonl`,
          startedAt: new Date(`2026-07-30T${String(19 - index).padStart(2, "0")}:00:00.000Z`),
          state: "completed",
        })),
    });
    const portfolio = new PortfolioService(
      () => [project],
      [adapter("codex"), adapter("claude-code"), adapter("cursor")],
      () => new Date("2026-07-31T12:00:00.000Z"),
    );

    const sessions = (await portfolio.getProject("fixture"))?.sessions ?? [];
    expect(sessions).toHaveLength(30);
    expect(
      Object.fromEntries(
        ["codex", "claude-code", "cursor"].map((source) => [
          source,
          sessions.filter((session) => session.source === source).length,
        ]),
      ),
    ).toEqual({ codex: 10, "claude-code": 10, cursor: 10 });
  });
});
