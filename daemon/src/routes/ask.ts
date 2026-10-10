import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerDeps } from "../server.js";
import type { ProjectListEntry } from "../portfolio.js";
import type { EvidenceRef } from "../types.js";
import type { AnalystChunk } from "../analyst/service.js";
import type { LatestStatus } from "../analyst/cache.js";
import { AskJobs, type AskJobState, type AskOutcome } from "../analyst/askJobs.js";
import { resolveProjectMentions } from "../analyst/projectMentions.js";
import { scopedEvidenceId, type PortfolioAskProject } from "../analyst/prompts.js";

/** Long enough for a cached or quick answer, short enough for Siri. */
export const DEFAULT_ASK_WAIT_MS = 8_000;

const askBodySchema = z.object({
  question: z.string().trim().min(1).max(4000),
  projectId: z.string().min(1).max(256).optional(),
  waitMs: z.number().int().min(0).max(25_000).optional(),
});

export interface AskInterim {
  answer: string;
  evidence: EvidenceRef[];
  analyzedAt: string | null;
}

export interface AskResponse {
  status: "answered" | "pending" | "failed";
  scope: "project" | "portfolio";
  /** Projects the question named, in the order it named them. */
  projects: { id: string; name: string }[];
  answer: string | null;
  evidence: EvidenceRef[];
  cached: boolean;
  /** Recent saved evidence to speak while a full answer is unavailable. */
  interim: AskInterim | null;
}

function cite(refs: EvidenceRef[]): string {
  return refs.map((ref) => ` [${ref.id}]`).join("");
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function needsAttention(project: ProjectListEntry): boolean {
  return (
    project.brief.state === "attention" ||
    project.brief.claims.some((claim) => claim.category === "attention")
  );
}

function scoped(refs: EvidenceRef[], project: ProjectListEntry): EvidenceRef[] {
  return refs.map((ref) => ({ ...ref, id: scopedEvidenceId(ref.id, project.id) }));
}

/** The latest completed analysis, or the deterministic brief when none exists. */
export function projectInterim(project: ProjectListEntry, latest: LatestStatus | null): AskInterim {
  if (latest) {
    return {
      answer: latest.answer,
      evidence: latest.evidence,
      analyzedAt: new Date(latest.createdAt).toISOString(),
    };
  }
  const { brief } = project;
  const attention = brief.claims.filter((claim) => claim.category === "attention").slice(0, 2);
  const lines = [
    sentence(brief.headline) + cite(brief.headlineEvidence),
    ...attention
      .filter((claim) => claim.text !== brief.headline)
      .map((claim) => sentence(claim.text) + cite(claim.evidence)),
  ];
  return {
    answer: lines.join(" "),
    evidence: [...brief.headlineEvidence, ...attention.flatMap((claim) => claim.evidence)],
    analyzedAt: brief.updatedAt,
  };
}

/** Saved briefs for the named projects, or a portfolio overview. */
export function portfolioInterim(projects: ProjectListEntry[], named: ProjectListEntry[]): AskInterim {
  const evidence: EvidenceRef[] = [];
  const describe = (project: ProjectListEntry) => {
    const refs = scoped(project.brief.headlineEvidence, project);
    evidence.push(...refs);
    return `${project.name}: ${sentence(project.brief.headline)}${cite(refs)}`;
  };
  if (named.length > 0) {
    return { answer: named.map(describe).join(" "), evidence, analyzedAt: null };
  }
  if (projects.length === 0) {
    return { answer: "No projects are registered yet.", evidence, analyzedAt: null };
  }
  const parts = [`You have ${projects.length} project${projects.length === 1 ? "" : "s"}.`];
  const attention = projects.filter(needsAttention);
  if (attention.length > 0) {
    parts.push(
      `${attention.length} need${attention.length === 1 ? "s" : ""} attention.`,
      ...attention.slice(0, 3).map(describe),
    );
  } else {
    parts.push("Nothing is marked as needing your attention.");
  }
  const active = projects.filter(
    (project) => project.brief.state === "active" && !attention.includes(project),
  );
  if (active.length > 0) {
    const shown = active.slice(0, 3);
    const refs = shown.flatMap((project) => scoped(project.brief.headlineEvidence, project));
    evidence.push(...refs);
    parts.push(`Agents are active in ${shown.map((project) => project.name).join(", ")}.${cite(refs)}`);
  }
  return { answer: parts.join(" "), evidence, analyzedAt: null };
}

async function collect(stream: AsyncGenerator<AnalystChunk>): Promise<AskOutcome> {
  for await (const chunk of stream) {
    if (chunk.type === "done") {
      if (!chunk.answer) throw new Error("The analyst returned no answer.");
      return { answer: chunk.answer, evidence: chunk.evidence, cached: chunk.cached };
    }
  }
  throw new Error("The analyst stopped without an answer.");
}

/**
 * One endpoint for any spoken question. A question that names one project is
 * answered by that project's analyst; anything else by the portfolio analyst.
 */
export function registerAskRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
  projectList: { get(): Promise<ProjectListEntry[]> },
) {
  const jobs = new AskJobs();
  app.addHook("onClose", async () => jobs.close());

  app.post("/v1/ask", async (req, reply) => {
    const parsed = askBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { question, projectId, waitMs = DEFAULT_ASK_WAIT_MS } = parsed.data;

    const projects = await projectList.get();
    if (projectId && !projects.some((project) => project.id === projectId)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const mentionedIds = projectId ? [projectId] : resolveProjectMentions(question, projects);
    const named = mentionedIds
      .map((id) => projects.find((project) => project.id === id))
      .filter((project): project is ProjectListEntry => project !== undefined);
    const scope = named.length === 1 ? "project" : "portfolio";

    const key = JSON.stringify([scope, mentionedIds, question.toLowerCase().replace(/\s+/g, " ")]);
    const job = jobs.run(key, (signal) => {
      if (scope === "project") return collect(deps.analyst.ask(named[0]!.id, question, signal));
      const inputs: PortfolioAskProject[] = projects.map((project) => ({
        id: project.id,
        name: project.name,
        branch: project.branch,
        lastActivityAt: project.lastActivityAt,
        brief: project.brief,
        latestStatus: deps.analyst.latestStatus(project.id),
      }));
      return collect(deps.analyst.askPortfolio(question, inputs, mentionedIds, signal));
    });
    const state: AskJobState = job ? await jobs.wait(job, waitMs) : { status: "failed" };

    const response: AskResponse = {
      status: state.status === "running" ? "pending" : state.status,
      scope,
      projects: named.map((project) => ({ id: project.id, name: project.name })),
      answer: state.status === "answered" ? state.outcome.answer : null,
      evidence: state.status === "answered" ? state.outcome.evidence : [],
      cached: state.status === "answered" ? state.outcome.cached : false,
      interim:
        state.status === "answered"
          ? null
          : scope === "project"
            ? projectInterim(named[0]!, deps.analyst.latestStatus(named[0]!.id))
            : portfolioInterim(projects, named),
    };
    return reply.send(response);
  });
}
