import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { projectsForConfig } from "../projectRegistry.js";
import { PortfolioService } from "../portfolio.js";

export function registerProjectRoutes(app: FastifyInstance, deps: ServerDeps) {
  const portfolio = new PortfolioService(
    () => projectsForConfig(deps.config),
    deps.adapters,
    undefined,
    deps.iosReleases,
  );

  app.get("/v1/projects", async () => {
    return portfolio.listProjects();
  });

  app.get<{ Params: { id: string } }>("/v1/projects/:id", async (req, reply) => {
    const project = await portfolio.getProject(req.params.id);
    if (!project) return reply.code(404).send({ error: "not_found" });
    return project;
  });
}
