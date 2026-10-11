import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerDeps } from "../server.js";
import type { ProjectListEntry } from "../portfolio.js";
import type { EvidenceRef } from "../types.js";
import type { AnalystChunk } from "../analyst/service.js";
import type { LatestStatus } from "../analyst/cache.js";
import { AskJobs, type AskJobState, type AskOutcome } from "../analyst/askJobs.js";
import { analyzeMentions } from "../analyst/projectMentions.js";
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
  /** When the answer is a saved analysis, the time it was made. */
  analyzedAt?: string | null;
  /** Recent saved evidence to speak while a full answer is unavailable. */
  interim: AskInterim | null;
}

/** Words of a plain status request ("what's the status of", "how is ...
 * doing", "any update on"). Such a question needs no model run: the saved
 * analysis or the deterministic overview answers it at once. */
const STATUS_WORDS = new Set(
  ("a about all an any anything app are at been brief can check could current currently " +
    "day did do does doing far for get give going has have hey how hows i in is it its " +
    "lately latest like look looking me my new news now of ok okay on overall please " +
    "progress project projects quick recent recently report right runtime runtimebrief s show so " +
    "state status summary tell that the there these things this to today up update updates " +
    "was week what whats where with you").split(" "),
);
/** A plain portfolio request may also ask who needs attention or is working. */
const OVERVIEW_WORDS = new Set([
  ...STATUS_WORDS,
  ..."active agent agents attention blocked blocker blockers blocking busy everything need needs needing review should stuck wait waiting which work working".split(" "),
]);

export function isPlainStatusRequest(otherWords: string[], scope: "project" | "portfolio"): boolean {
  const vocabulary = scope === "project" ? STATUS_WORDS : OVERVIEW_WORDS;
  return otherWords.every((word) => vocabulary.has(word));
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

function namesList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Saved briefs for up to two named projects, or a two-sentence overview:
 * which projects need attention and where agents are working. */
export function portfolioInterim(projects: ProjectListEntry[], named: ProjectListEntry[]): AskInterim {
  const evidence: EvidenceRef[] = [];
  const refs = (shown: ProjectListEntry[]) => {
    const scopedRefs = shown.flatMap((project) => scoped(project.brief.headlineEvidence, project));
    evidence.push(...scopedRefs);
    return cite(scopedRefs);
  };
  if (named.length > 0) {
    const answer = named
      .slice(0, 2)
      .map((project) => `${project.name}: ${sentence(project.brief.headline)}${refs([project])}`)
      .join(" ");
    return { answer, evidence, analyzedAt: null };
  }
  if (projects.length === 0) {
    return { answer: "No projects are registered yet.", evidence, analyzedAt: null };
  }
  const attention = projects.filter(needsAttention);
  const active = projects.filter(
    (project) => project.brief.state === "active" && !attention.includes(project),
  );
  const parts: string[] = [];
  if (attention.length > 0) {
    const shown = attention.slice(0, 3);
    const more = attention.length - shown.length;
    parts.push(
      `${attention.length} project${attention.length === 1 ? " needs" : "s need"} attention: ` +
        namesList([...shown.map((project) => project.name), ...(more > 0 ? [`${more} more`] : [])]) +
        `.${refs(shown)}`,
    );
  } else {
    parts.push(`Nothing needs your attention across ${projects.length} project${projects.length === 1 ? "" : "s"}.`);
  }
  if (active.length > 0) {
    const shown = active.slice(0, 3);
    parts.push(`Agents are working in ${namesList(shown.map((project) => project.name))}.${refs(shown)}`);
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
  // The owner's private daemon log: what Siri sent, where it went, and how
  // it ended, so a misheard or failed question can be traced.
  const log = deps.askLog ?? ((line: string) => console.log(line));
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
    const mentions = analyzeMentions(
      question,
      projects.map((project) => ({ id: project.id, name: project.name, aliases: project.spokenNames })),
    );
    const mentionedIds = projectId ? [projectId] : mentions.ids;
    const named = mentionedIds
      .map((id) => projects.find((project) => project.id === id))
      .filter((project): project is ProjectListEntry => project !== undefined);
    const scope = named.length === 1 ? "project" : "portfolio";

    const route =
      `scope=${scope} projects=${mentionedIds.join(",") || "-"}` +
      `${projectId ? " chosen=1" : ""} question=${JSON.stringify(question.slice(0, 300))}`;

    // A plain status request is answered at once from saved evidence.
    if (named.length <= 1 && isPlainStatusRequest(mentions.otherWords, scope)) {
      const saved = scope === "project" ? deps.analyst.latestStatus(named[0]!.id) : null;
      if (saved) {
        // Queues a refresh when the saved analysis is missing or old.
        try { deps.analyst.voiceStatus(named[0]!.id); } catch { /* registered after startup */ }
      }
      const instant = scope === "project" ? projectInterim(named[0]!, saved) : portfolioInterim(projects, []);
      if (scope === "portfolio" || saved) {
        log(`[ask] replied ${route} status=answered instant=1 ms=0`);
        const response: AskResponse = {
          status: "answered",
          scope,
          projects: named.map((project) => ({ id: project.id, name: project.name })),
          answer: instant.answer,
          evidence: instant.evidence,
          cached: true,
          analyzedAt: instant.analyzedAt,
          interim: null,
        };
        return reply.send(response);
      }
    }
    const key = JSON.stringify([scope, mentionedIds, question.toLowerCase().replace(/\s+/g, " ")]);
    const startedAt = Date.now();
    const job = jobs.run(key, (signal) => {
      const work = scope === "project"
        ? collect(deps.analyst.ask(named[0]!.id, question, signal, { voice: true }))
        : collectPortfolio(signal);
      return work.then(
        (outcome) => {
          log(`[ask] finished ${route} status=answered ms=${Date.now() - startedAt} cached=${outcome.cached}`);
          return outcome;
        },
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          log(`[ask] finished ${route} status=failed ms=${Date.now() - startedAt} error=${JSON.stringify(reason.slice(0, 200))}`);
          throw error;
        },
      );
    });
    function collectPortfolio(signal: AbortSignal): Promise<AskOutcome> {
      const inputs: PortfolioAskProject[] = projects.map((project) => ({
        id: project.id,
        name: project.name,
        branch: project.branch,
        lastActivityAt: project.lastActivityAt,
        brief: project.brief,
        latestStatus: deps.analyst.latestStatus(project.id),
      }));
      return collect(deps.analyst.askPortfolio(question, inputs, mentionedIds, signal));
    }
    const state: AskJobState = job ? await jobs.wait(job, waitMs) : { status: "failed" };
    log(`[ask] replied ${route} status=${job ? (state.status === "running" ? "pending" : state.status) : "busy"} ms=${Date.now() - startedAt}`);

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
