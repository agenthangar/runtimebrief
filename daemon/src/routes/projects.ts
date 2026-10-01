import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { projectsForConfig } from "../projectRegistry.js";
import { PortfolioService } from "../portfolio.js";

/** The portfolio scans local Git trees and agent transcripts. Share one scan
 * across simultaneous clients and serve a recent complete result while the
 * next scan runs. Project briefs carry their own evidence timestamps. */
export class ProjectListCache<T> {
  private cached: { value: T; at: number } | null = null;
  private inFlight: Promise<T> | null = null;

  constructor(
    private readonly fetch: () => Promise<T>,
    private readonly now: () => number = Date.now,
    private readonly freshMs = 5_000,
    private readonly maxStaleMs = 60_000,
  ) {}

  get(): Promise<T> {
    const age = this.cached ? this.now() - this.cached.at : Infinity;
    if (this.cached && age < this.freshMs) return Promise.resolve(this.cached.value);
    if (this.cached && age < this.maxStaleMs) {
      void this.refresh().catch(() => {});
      return Promise.resolve(this.cached.value);
    }
    return this.refresh();
  }

  warm(): void {
    void this.refresh().catch(() => {});
  }

  private refresh(): Promise<T> {
    if (this.inFlight) return this.inFlight;
    const scan = Promise.resolve().then(this.fetch).then((value) => {
      this.cached = { value, at: this.now() };
      return value;
    });
    const shared = scan.finally(() => {
      if (this.inFlight === shared) this.inFlight = null;
    });
    this.inFlight = shared;
    return shared;
  }
}

export function registerProjectRoutes(app: FastifyInstance, deps: ServerDeps) {
  const portfolio = new PortfolioService(
    () => projectsForConfig(deps.config),
    deps.adapters,
    undefined,
    deps.iosReleases,
  );
  const projectList = new ProjectListCache(() => portfolio.listProjects());
  projectList.warm();

  app.get("/v1/projects", async () => {
    return projectList.get();
  });

  app.get<{ Params: { id: string } }>("/v1/projects/:id", async (req, reply) => {
    const project = await portfolio.getProject(req.params.id);
    if (!project) return reply.code(404).send({ error: "not_found" });
    return project;
  });
}
