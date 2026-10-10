import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { FilesystemGitAdapter } from "../src/adapters/filesystemGit.js";
import { AnswerCache } from "../src/analyst/cache.js";
import { AskJobs, type AskOutcome } from "../src/analyst/askJobs.js";
import { createAnalystService } from "../src/analyst/service.js";
import type { AnalystBackendRunner } from "../src/analyst/codexCli.js";
import {
  buildPortfolioEvidence,
  buildPortfolioPrompt,
  PORTFOLIO_SYSTEM_PROMPT,
  type PortfolioAskProject,
} from "../src/analyst/prompts.js";
import { resolveProjectMentions } from "../src/analyst/projectMentions.js";
import { portfolioInterim, projectInterim, type AskResponse } from "../src/routes/ask.js";
import type { ProjectListEntry } from "../src/portfolio.js";
import type { EvidenceRef, ProjectBrief } from "../src/types.js";
import { authHeaders, makeFixtureRepo, testConfig, tmpdir } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));

interface MentionFixture {
  projects: { id: string; name: string }[];
  cases: { question: string; expected: string[] }[];
}

describe("spoken question project routing", () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(here, "../../fixtures/project-mentions.json"), "utf8"),
  ) as MentionFixture;

  it.each(fixture.cases)("routes $question", ({ question, expected }) => {
    expect(resolveProjectMentions(question, fixture.projects)).toEqual(expected);
  });

  it("finds every project by its spoken name in any surrounding sentence", () => {
    const templates = ["how is {} doing", "did {} pass its tests?", "what's claude doing on the {} app", "{}"];
    for (const project of fixture.projects.filter((p) => p.name.replace(/\W/g, "").length >= 3)) {
      for (const template of templates) {
        const question = template.replace("{}", project.name);
        expect(resolveProjectMentions(question, fixture.projects), question).toEqual([project.id]);
      }
    }
  });
});

describe("AskJobs", () => {
  const outcome = (answer: string): AskOutcome => ({ answer, evidence: [], cached: false });

  it("keeps a slow job running after the caller stops waiting and reuses its answer", async () => {
    const jobs = new AskJobs();
    let finish!: (value: AskOutcome) => void;
    let starts = 0;
    const work = () => {
      starts++;
      return new Promise<AskOutcome>((resolve) => { finish = resolve; });
    };
    const job = jobs.run("q", work)!;
    expect((await jobs.wait(job, 10)).status).toBe("running");
    expect(jobs.run("q", work)).toBe(job);
    finish(outcome("Ready."));
    await job.settled;
    const again = jobs.run("q", work)!;
    expect(again).toBe(job);
    expect(await jobs.wait(again, 0)).toEqual({ status: "answered", outcome: outcome("Ready.") });
    expect(starts).toBe(1);
    jobs.close();
  });

  it("retries a failed question and forgets answers after the retention window", async () => {
    let now = 0;
    const jobs = new AskJobs({ retainMs: 1_000, now: () => now });
    const failed = jobs.run("q", async () => { throw new Error("boom"); })!;
    await failed.settled;
    expect(failed.state.status).toBe("failed");
    const retried = jobs.run("q", async () => outcome("Second try."))!;
    expect(retried).not.toBe(failed);
    await retried.settled;
    now = 5_000;
    const fresh = jobs.run("q", async () => outcome("Third."))!;
    expect(fresh).not.toBe(retried);
    jobs.close();
  });

  it("refuses more concurrent model runs than allowed", () => {
    const jobs = new AskJobs({ maxRunning: 2 });
    const never = () => new Promise<AskOutcome>(() => {});
    expect(jobs.run("a", never)).not.toBeNull();
    expect(jobs.run("b", never)).not.toBeNull();
    expect(jobs.run("c", never)).toBeNull();
    // Joining an existing question is still allowed.
    expect(jobs.run("a", never)).not.toBeNull();
    jobs.close();
  });
});

function ref(id: string, label = id): EvidenceRef {
  return { id, kind: "commit", label, detail: label, source: "git" };
}

function brief(overrides: Partial<ProjectBrief> = {}): ProjectBrief {
  return {
    state: "recent",
    headline: "Export checks passed",
    headlineEvidence: [ref("git-commit-abc")],
    updatedAt: "2026-10-09T10:00:00.000Z",
    activeSessionCount: 0,
    claims: [],
    ...overrides,
  };
}

function portfolioProject(id: string, name: string, overrides: Partial<PortfolioAskProject> = {}): PortfolioAskProject {
  return { id, name, branch: "main", lastActivityAt: "2026-10-09T10:00:00.000Z", brief: brief(), latestStatus: null, ...overrides };
}

describe("portfolio evidence packet", () => {
  it("scopes repeated evidence IDs per project, including citations inside saved analyses", () => {
    const projects = [
      portfolioProject("alpha", "Alpha", {
        latestStatus: { answer: "Done: Shipped the export. [git-commit-abc]", createdAt: 0, evidence: [ref("git-commit-abc")] },
      }),
      portfolioProject("beta", "Beta"),
    ];
    const packet = buildPortfolioPrompt("What shipped?", projects);
    expect(packet).toContain("Done: Shipped the export. [git-commit-abc@alpha]");
    expect(packet).toContain("Brief: Export checks passed [git-commit-abc@beta]");
    expect(packet).not.toMatch(/\[git-commit-abc\]/);
    const ids = buildPortfolioEvidence(projects).map((item) => item.id);
    expect(ids).toEqual(["git-commit-abc@alpha", "git-commit-abc@beta"]);
  });

  it("puts named projects first and the most recently active next", () => {
    const projects = [
      portfolioProject("old", "Old", { lastActivityAt: "2026-01-01T00:00:00.000Z" }),
      portfolioProject("new", "New", { lastActivityAt: "2026-10-01T00:00:00.000Z" }),
      portfolioProject("named", "Named", { lastActivityAt: null }),
    ];
    const packet = buildPortfolioPrompt("How is Named?", projects, ["named"]);
    expect(packet).toContain('Projects named in the question: "Named"');
    const order = ["### Named", "### New", "### Old"].map((heading) => packet.indexOf(heading));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("omits the least active projects beyond the context budget", () => {
    const longClaims = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`, category: "progress" as const, text: "x".repeat(500), evidence: [ref(`git-commit-${i}`)],
    }));
    const projects = Array.from({ length: 80 }, (_, i) =>
      portfolioProject(`p${i}`, `Project ${i}`, {
        lastActivityAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
        brief: brief({ claims: longClaims }),
      }),
    );
    const packet = buildPortfolioPrompt("Anything blocked?", projects);
    expect(packet.length).toBeLessThanOrEqual(120_000);
    expect(packet).toContain("### Project 79");
    expect(packet).toMatch(/\(\d+ less recently active projects omitted\)/);
  });
});

describe("analyst portfolio answers", () => {
  let dir: string;
  let cache: AnswerCache;
  beforeEach(() => {
    dir = tmpdir("portfolio");
    cache = new AnswerCache(path.join(dir, "cache.db"));
  });
  afterEach(() => {
    cache.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("uses the portfolio prompt, enforces scoped citations, and caches the answer", async () => {
    const calls: { systemPrompt: string; evidencePacket: string }[] = [];
    const runner: AnalystBackendRunner = async function* (params) {
      calls.push(params);
      yield {
        type: "result", costUsd: 0, isError: false,
        finalText: "Alpha shipped its export. [git-commit-abc@alpha]\nBeta is blocked on review.",
      };
    };
    const analyst = createAnalystService(testConfig({ projects: [] }), [], { runner, cache });
    const projects = [portfolioProject("alpha", "Alpha"), portfolioProject("beta", "Beta")];
    const answers: string[] = [];
    for (let i = 0; i < 2; i++) {
      for await (const chunk of analyst.askPortfolio("What shipped?", projects)) {
        if (chunk.type === "done") answers.push(`${chunk.cached}:${chunk.answer}`);
      }
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.systemPrompt).toBe(PORTFOLIO_SYSTEM_PROMPT);
    expect(answers).toEqual([
      "false:Alpha shipped its export. [git-commit-abc@alpha]\nUnknown from available evidence.",
      "true:Alpha shipped its export. [git-commit-abc@alpha]\nUnknown from available evidence.",
    ]);
    analyst.close();
  });
});

function entry(id: string, name: string, overrides: Partial<ProjectBrief> = {}): ProjectListEntry {
  return { id, name, lastActivityAt: null, branch: "main", dirty: false, brief: brief(overrides) };
}

describe("interim answers", () => {
  it("prefers the latest completed project analysis", () => {
    const latest = { answer: "Done: Shipped. [git-commit-abc]", createdAt: 0, evidence: [ref("git-commit-abc")], model: "m" };
    expect(projectInterim(entry("a", "Alpha"), latest)).toEqual({
      answer: latest.answer, evidence: latest.evidence, analyzedAt: "1970-01-01T00:00:00.000Z",
    });
  });

  it("falls back to the brief headline and attention claims", () => {
    const project = entry("a", "Alpha", {
      claims: [{ id: "c", category: "attention", text: "A session waits for approval", evidence: [ref("session-x")] }],
    });
    expect(projectInterim(project, null).answer).toBe(
      "Export checks passed. [git-commit-abc] A session waits for approval. [session-x]",
    );
  });

  it("summarizes attention and activity across projects with scoped citations", () => {
    const projects = [
      entry("a", "Alpha", { state: "attention", headline: "Waiting for approval" }),
      entry("b", "Beta", { state: "active", headline: "Agent is editing" }),
      entry("c", "Gamma"),
    ];
    expect(portfolioInterim(projects, []).answer).toBe(
      "You have 3 projects. 1 needs attention. Alpha: Waiting for approval. [git-commit-abc@a] " +
        "Agents are active in Beta. [git-commit-abc@b]",
    );
    expect(portfolioInterim(projects, [projects[2]!, projects[0]!]).answer).toBe(
      "Gamma: Export checks passed. [git-commit-abc@c] Alpha: Waiting for approval. [git-commit-abc@a]",
    );
  });
});

describe("POST /v1/ask", () => {
  let app: FastifyInstance;
  let dir: string;
  let repos: string[];
  let calls: { systemPrompt: string; evidencePacket: string }[];
  let behavior: "answer" | "fail" | "hold";
  let release: () => void = () => {};

  beforeAll(async () => {
    dir = tmpdir("ask-route");
    repos = [makeFixtureRepo(), makeFixtureRepo()];
    calls = [];
    behavior = "answer";
    const config = testConfig({
      projects: [
        { id: "fixture", name: "Fixture App", path: repos[0]! },
        { id: "orbit", name: "Orbit Tracker", path: repos[1]! },
      ],
    });
    const runner: AnalystBackendRunner = async function* (params) {
      calls.push(params);
      if (behavior === "fail") throw new Error("model unavailable");
      if (behavior === "hold") await new Promise<void>((resolve) => { release = resolve; });
      const portfolio = params.systemPrompt === PORTFOLIO_SYSTEM_PROMPT;
      const fixtureId = /\[([^\[\]]+@fixture)\]/.exec(params.evidencePacket)?.[1];
      yield {
        type: "result", costUsd: 0, isError: false,
        finalText: portfolio
          ? `Nothing is blocked across Fixture App and Orbit Tracker. [${fixtureId}]`
          : "The feature branch is in progress. [git-working-tree]",
      };
    };
    const adapters = [new FilesystemGitAdapter()];
    const analyst = createAnalystService(config, adapters, {
      runner, cache: new AnswerCache(path.join(dir, "cache.db")),
    });
    app = buildServer({ config, adapters, analyst });
    await app.ready();
  });

  afterAll(async () => {
    release();
    await app.close();
    for (const repo of repos) fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function ask(body: Record<string, unknown>, headers = authHeaders()) {
    const res = await app.inject({ method: "POST", url: "/v1/ask", headers, payload: body });
    return { status: res.statusCode, body: res.json() as AskResponse & { error?: string } };
  }

  it("requires the token and a question", async () => {
    expect((await ask({ question: "Hi" }, {})).status).toBe(401);
    expect((await ask({ question: "   " })).status).toBe(400);
    expect((await ask({ question: "Hi", waitMs: 60_000 })).status).toBe(400);
    expect((await ask({ question: "Hi", projectId: "ghost" })).status).toBe(404);
  });

  it("routes a question that names one project to that project's analyst", async () => {
    const before = calls.length;
    const { status, body } = await ask({ question: "Is the fixture app branch merged yet?" });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: "answered", scope: "project",
      projects: [{ id: "fixture", name: "Fixture App" }],
      answer: "The feature branch is in progress. [git-working-tree]",
      interim: null,
    });
    expect(calls.length).toBe(before + 1);
    expect(calls.at(-1)!.systemPrompt).toContain("project-state analyst");
  });

  it("answers a question about no particular project across the portfolio", async () => {
    const { body } = await ask({ question: "Is anything blocked right now?" });
    expect(body).toMatchObject({ status: "answered", scope: "portfolio", projects: [] });
    const cited = /\[([^\[\]]+@fixture)\]$/.exec(body.answer ?? "")?.[1];
    expect(body.answer).toMatch(/^Nothing is blocked across Fixture App and Orbit Tracker\./);
    expect(body.evidence.some((item) => item.id === cited)).toBe(true);
    const packet = calls.at(-1)!.evidencePacket;
    expect(packet).toContain("### Fixture App (project id: fixture)");
    expect(packet).toContain("### Orbit Tracker (project id: orbit)");
  });

  it("uses an explicit project and compares several named projects in one answer", async () => {
    const explicit = await ask({ question: "Anything to review?", projectId: "orbit" });
    expect(explicit.body).toMatchObject({ scope: "project", projects: [{ id: "orbit" }] });
    const both = await ask({ question: "Compare orbit tracker with fixture app" });
    expect(both.body).toMatchObject({
      scope: "portfolio", projects: [{ id: "orbit" }, { id: "fixture" }],
    });
    expect(calls.at(-1)!.evidencePacket).toContain('Projects named in the question: "Orbit Tracker", "Fixture App"');
  });

  it("returns saved evidence while a slow answer continues, then the answer on a repeat", async () => {
    behavior = "hold";
    const pending = await ask({ question: "What did agents finish today?", waitMs: 20 });
    expect(pending.body.status).toBe("pending");
    expect(pending.body.answer).toBeNull();
    expect(pending.body.interim?.answer).toMatch(/^You have 2 projects\./);
    const runs = calls.length;
    release();
    behavior = "answer";
    await new Promise((resolve) => setTimeout(resolve, 20));
    const repeated = await ask({ question: "what did agents  finish today?", waitMs: 0 });
    expect(repeated.body).toMatchObject({ status: "answered", interim: null });
    expect(calls.length).toBe(runs);
  });

  it("reports a failed analysis with the project's saved brief", async () => {
    behavior = "fail";
    const { body } = await ask({ question: "Why did Orbit Tracker stall?" });
    behavior = "answer";
    expect(body.status).toBe("failed");
    expect(body.scope).toBe("project");
    expect(body.interim?.answer).toEqual(expect.any(String));
    expect(body.interim!.answer.length).toBeGreaterThan(0);
  });
});
