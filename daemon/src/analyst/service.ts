import type { RuntimeBriefConfig } from "../config.js";
import type { ProjectConfig, RuntimeAdapter, TranscriptRef } from "../types.js";
import { projectsForConfig } from "../projectRegistry.js";
import { FilesystemGitAdapter, type GitSummary } from "../adapters/filesystemGit.js";
import {
  parseClaudeSessionRef,
  type ParsedSession,
} from "../adapters/claudeCodeSessions.js";
import { parseCodexSessionFile } from "../adapters/codexSessions.js";
import {
  parseCursorProjectTranscript,
  parseCursorSessionDir,
} from "../adapters/cursorSessions.js";
import { AnswerCache } from "./cache.js";
import {
  ANALYST_SYSTEM_PROMPT,
  buildAnalystEvidence,
  buildAnalystPrompt,
  DEFAULT_STATUS_QUESTION,
  type TranscriptDigestInput,
} from "./prompts.js";
import {
  liveAnalystRunner,
  type AnalystBackendRunner,
} from "./codexCli.js";
import type { EvidenceRef } from "../types.js";
import type { IosReleaseProvider, IosReleaseSummary } from "../iosRelease.js";

export type AnalystChunk =
  | { type: "text"; text: string }
  | {
      type: "done";
      answer: string;
      costUsd: number;
      cached: boolean;
      truncated: boolean;
      evidence: EvidenceRef[];
    };

export interface AnalystService {
  ask(
    projectId: string,
    question: string,
    callerSignal?: AbortSignal,
  ): AsyncGenerator<AnalystChunk>;
  statusQuestion: string;
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`unknown project: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

/**
 * Newest-first pick of up to `max` transcripts, but every source that has
 * any transcripts keeps at least one slot — a runtime that runs daily must
 * not crowd a quieter one out of the analyst's context entirely.
 */
export function selectTranscripts(refs: TranscriptRef[], max: number): TranscriptRef[] {
  const selected = refs.slice(0, max);
  const missing = [...new Set(refs.map((r) => r.source))].filter(
    (source) => !selected.some((r) => r.source === source),
  );
  for (const source of missing) {
    const candidate = refs.find((r) => r.source === source);
    if (!candidate) continue;
    // Evict the oldest transcript of a source that holds more than one slot.
    for (let i = selected.length - 1; i >= 0; i--) {
      const s = selected[i]!.source;
      if (selected.filter((r) => r.source === s).length > 1) {
        selected.splice(i, 1);
        selected.push(candidate);
        break;
      }
    }
  }
  return selected;
}

export interface AnalystServiceOptions {
  runner?: AnalystBackendRunner;
  cache?: AnswerCache;
  iosReleases?: IosReleaseProvider;
  requestTimeoutMs?: number;
}

export const DEFAULT_ANALYST_REQUEST_TIMEOUT_MS = 60_000;
export const ANALYST_CACHE_BACKEND = "codex-cli";
export const ANALYST_CACHE_PROMPT_VERSION = "runtimebrief-analyst-v1";

/**
 * Do not surface uncited model assertions as project facts. A line with no
 * valid evidence ID is replaced with an explicit unknown rather than guessed.
 */
export function enforceEvidenceCitations(answer: string, evidence: EvidenceRef[]): string {
  const validIds = new Set(evidence.map((item) => item.id));
  const citationPattern = /\[([^\[\]]+)\]/g;
  const lines = answer.split("\n");
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (
        !trimmed ||
        /^(?:(?:Done|Now|Next):\s*)?Unknown from available evidence\.?$/i.test(trimmed)
      ) {
        return line;
      }
      const trailingCitations =
        /(?:\s*\[[^\[\]]+\])+\s*$/.exec(trimmed)?.[0] ?? "";
      const citedIds = [...trailingCitations.matchAll(citationPattern)].map(
        (match) => match[1]!,
      );
      if (citedIds.some((id) => validIds.has(id))) return line;
      const label = /^(Done|Now|Next):/i.exec(trimmed)?.[0] ?? "";
      return `${label}${label ? " " : ""}Unknown from available evidence.`;
    })
    .join("\n");
}

export function createAnalystService(
  config: RuntimeBriefConfig,
  adapters: RuntimeAdapter[],
  options: AnalystServiceOptions = {},
): AnalystService {
  const runner = options.runner ?? liveAnalystRunner;
  const cache = options.cache ?? new AnswerCache();
  const analystConfig = config.analyst;

  async function gatherGit(project: ProjectConfig): Promise<GitSummary | null> {
    const gitAdapter = adapters.find(
      (a): a is FilesystemGitAdapter => a instanceof FilesystemGitAdapter,
    );
    if (!gitAdapter) return null;
    try {
      if (!(await gitAdapter.discover(project))) return null;
      return await gitAdapter.summary(project);
    } catch {
      return null;
    }
  }

  async function gatherTranscripts(project: ProjectConfig): Promise<TranscriptDigestInput[]> {
    const refs: TranscriptRef[] = [];
    for (const adapter of adapters) {
      try {
        refs.push(...(await adapter.transcriptPaths(project, analystConfig.max_transcripts)));
      } catch {
        // a broken adapter must not block the analyst
      }
    }
    refs.sort(
      (a, b) =>
        (b.endedAt?.getTime() ?? b.startedAt?.getTime() ?? 0) -
        (a.endedAt?.getTime() ?? a.startedAt?.getTime() ?? 0),
    );
    const digests: TranscriptDigestInput[] = [];
    const parsers: Record<string, (path: string) => Promise<TranscriptDigestInput["session"]>> = {
      "claude-code": parseClaudeSessionRef,
      codex: parseCodexSessionFile,
      cursor: (transcriptPath) =>
        transcriptPath.endsWith(".jsonl")
          ? parseCursorProjectTranscript(transcriptPath)
          : parseCursorSessionDir(transcriptPath),
    };
    for (const ref of selectTranscripts(refs, analystConfig.max_transcripts)) {
      const parse = parsers[ref.source];
      if (!parse) continue;
      try {
        const parsed = await parse(ref.path);
        digests.push({
          ref,
          session:
            ref.source === "claude-code"
              ? mergeClaudeRefMetadata(parsed, ref)
              : parsed,
        });
      } catch {
        // unreadable transcript — skip
      }
    }
    return digests;
  }

  function mergeClaudeRefMetadata(
    parsed: ParsedSession,
    ref: TranscriptRef,
  ): ParsedSession {
    const session: ParsedSession = {
      ...parsed,
      userPrompts: [...parsed.userPrompts],
      filesTouched: [...parsed.filesTouched],
      workspacePaths: [...(parsed.workspacePaths ?? [])],
    };
    // The adapter ref is the joined view of the canonical transcript plus
    // Claude Desktop's catalog and live registry. Keep those joined lifecycle
    // fields when the analyst reparses the backing file in isolation.
    if (ref.startedAt) session.startedAt = ref.startedAt;
    if (ref.endedAt) session.endedAt = ref.endedAt;
    if (ref.state) session.state = ref.state;
    if (ref.stateReason) session.stateReason = ref.stateReason;
    if (ref.model) session.model = ref.model;
    if (ref.title) session.title = ref.title;
    if (ref.filesTouched) session.filesTouched = [...ref.filesTouched];
    if (ref.toolUseCount !== undefined) session.toolUseCount = ref.toolUseCount;
    if (!session.title && session.userPrompts.length === 0 && ref.summary) {
      session.title = ref.summary;
    }
    // An error recorded by the joined Desktop metadata must never be presented
    // as a successful conclusion from an older transcript record.
    if (ref.state === "interrupted") session.finalAssistantText = null;
    return session;
  }

  async function gatherIosRelease(project: ProjectConfig): Promise<IosReleaseSummary | null> {
    try {
      return (await options.iosReleases?.summary(project)) ?? null;
    } catch {
      return null;
    }
  }

  async function* ask(
    projectId: string,
    question: string,
    callerSignal?: AbortSignal,
  ): AsyncGenerator<AnalystChunk> {
    const project = projectsForConfig(config).find((p) => p.id === projectId);
    if (!project) throw new ProjectNotFoundError(projectId);

    const [git, transcripts, iosRelease] = await Promise.all([
      gatherGit(project),
      gatherTranscripts(project),
      gatherIosRelease(project),
    ]);
    const prompt = buildAnalystPrompt(question, project.name, git, transcripts, iosRelease);
    const evidence = buildAnalystEvidence(git, transcripts, undefined, iosRelease);
    const firstSectionEnd = prompt.indexOf("\n\n");
    const filteredEvidenceForCache =
      firstSectionEnd === -1 ? prompt : prompt.slice(firstSectionEnd + 2);
    const cacheIdentity = {
      backend: ANALYST_CACHE_BACKEND,
      model: analystConfig.model,
      promptVersion: ANALYST_CACHE_PROMPT_VERSION,
      evidenceHash: AnswerCache.evidenceHash(filteredEvidenceForCache),
    };
    const cached = cache.get(
      project.id,
      question,
      cacheIdentity,
      analystConfig.cache_ttl_minutes,
    );
    if (cached) {
      yield { type: "text", text: cached.answer };
      yield {
        type: "done",
        answer: cached.answer,
        costUsd: 0,
        cached: true,
        truncated: false,
        evidence: cached.evidence,
      };
      return;
    }

    const abort = new AbortController();
    const abortForCaller = () => abort.abort(callerSignal?.reason);
    if (callerSignal?.aborted) {
      abortForCaller();
    } else {
      callerSignal?.addEventListener("abort", abortForCaller, { once: true });
    }
    const requestTimeout = setTimeout(
      () => abort.abort(new Error("RuntimeBrief analyst request timed out.")),
      options.requestTimeoutMs ?? DEFAULT_ANALYST_REQUEST_TIMEOUT_MS,
    );
    requestTimeout.unref();
    let finalText: string | null = null;

    try {
      const events = runner({
        evidencePacket: prompt,
        systemPrompt: ANALYST_SYSTEM_PROMPT,
        model: analystConfig.model,
        signal: abort.signal,
      });

      for await (const event of events) {
        if (event.type === "result") {
          if (event.isError) {
            throw new Error("Codex CLI analyst did not produce a valid result.");
          }
          finalText = event.finalText;
          break;
        }
      }
    } finally {
      clearTimeout(requestTimeout);
      callerSignal?.removeEventListener("abort", abortForCaller);
      if (!abort.signal.aborted) abort.abort();
    }

    // The backend is non-streaming and schema-validates its complete response.
    // RuntimeBrief then enforces citations before emitting the single text chunk.
    const answer = enforceEvidenceCitations((finalText ?? "").trim(), evidence);

    if (answer.length > 0) {
      cache.set(project.id, question, cacheIdentity, answer, evidence);
    }
    if (answer.length > 0) {
      yield { type: "text", text: answer };
    }
    // Codex CLI uses the user's ChatGPT plan and does not expose a dollar cost.
    // Keep these compatibility fields until the HTTP/iOS schema can version them.
    yield { type: "done", answer, costUsd: 0, cached: false, truncated: false, evidence };
  }

  return { ask, statusQuestion: DEFAULT_STATUS_QUESTION };
}
