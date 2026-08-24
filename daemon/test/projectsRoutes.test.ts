import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { FilesystemGitAdapter } from "../src/adapters/filesystemGit.js";
import { authHeaders, makeFixtureRepo, testConfig } from "./helpers.js";

describe("project routes", () => {
  let app: FastifyInstance;
  let repo: string;

  beforeAll(async () => {
    repo = makeFixtureRepo({ dirty: true });
    const config = testConfig({
      projects: [
        { id: "ghost", name: "Ghost", path: "/nonexistent/path" },
        { id: "fixture", name: "Fixture App", path: repo },
      ],
    });
    app = buildServer({
      config,
      adapters: [new FilesystemGitAdapter()],
      analyst: { answer: async () => ({}) } as never,
      iosReleases: {
        summary: async (project) =>
          project.id === "fixture"
            ? {
                xcode: {
                  source: "xcodegen",
                  projectFile: "project.yml",
                  scheme: "Fixture",
                  bundleId: "com.example.fixture",
                  marketingVersion: "1.0",
                  buildNumber: "5",
                },
                appStoreConnect: {
                  status: "available",
                  checkedAt: "2026-07-31T10:00:00Z",
                  message: null,
                  appId: "123",
                  latestTestFlightBuild: {
                    id: "build-5",
                    marketingVersion: "1.0",
                    buildNumber: "5",
                    uploadedAt: "2026-07-31T09:00:00Z",
                    expiresAt: null,
                    expired: false,
                    processingState: "VALID",
                    audienceType: "APP_STORE_ELIGIBLE",
                  },
                  appStoreVersion: null,
                },
              }
            : null,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("GET /v1/projects lists all configured projects with git state", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects", headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(2);
    expect(list.map((p: { id: string }) => p.id)).toEqual(["fixture", "ghost"]);
    const fixture = list.find((p: { id: string }) => p.id === "fixture");
    expect(fixture).toMatchObject({
      name: "Fixture App",
      branch: "feature/test-branch",
      dirty: true,
      brief: {
        state: "recent",
        headline: "Recent work is ready to review",
      },
    });
    expect(
      fixture.brief.claims.every(
        (claim: { evidence: unknown[] }) => claim.evidence.length > 0,
      ),
    ).toBe(true);
    expect(Date.parse(fixture.lastActivityAt)).not.toBeNaN();
    // Unreachable project still listed, with null git state.
    const ghost = list.find((p: { id: string }) => p.id === "ghost");
    expect(ghost).toMatchObject({ branch: null, dirty: null, lastActivityAt: null });
  });

  it("GET /v1/projects/:id returns the project card", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/fixture",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const card = res.json();
    expect(card.id).toBe("fixture");
    expect(card.git.branch).toBe("feature/test-branch");
    expect(card.git.commits.length).toBeGreaterThan(0);
    expect(card.iosRelease).toMatchObject({
      xcode: { bundleId: "com.example.fixture", buildNumber: "5" },
      appStoreConnect: {
        status: "available",
        latestTestFlightBuild: { buildNumber: "5", processingState: "VALID" },
      },
    });
    expect(Array.isArray(card.sessions)).toBe(true);
    expect(card.brief.claims.every((claim: { evidence: unknown[] }) => claim.evidence.length > 0))
      .toBe(true);
  });

  it("404s on unknown project ids", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/unknown",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects" });
    expect(res.statusCode).toBe(401);
  });
});
