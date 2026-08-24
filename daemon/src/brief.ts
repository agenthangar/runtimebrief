import type { GitSummary } from "./adapters/filesystemGit.js";
import type {
  BriefClaim,
  EvidenceRef,
  ProjectBrief,
  ProjectBriefState,
  TranscriptRef,
} from "./types.js";

const ACTIVE_WINDOW_MS = 15 * 60_000;
const RECENT_WINDOW_MS = 24 * 60 * 60_000;

function sourceName(source: string): string {
  switch (source) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    default:
      return source;
  }
}

function compact(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}

function sessionTimestamp(session: TranscriptRef): Date | null {
  return session.endedAt ?? session.startedAt ?? null;
}

function isWithin(date: Date | null, now: Date, windowMs: number): boolean {
  if (!date) return false;
  const age = now.getTime() - date.getTime();
  return age >= 0 && age <= windowMs;
}

export function sessionEvidence(session: TranscriptRef): EvidenceRef {
  const timestamp = sessionTimestamp(session);
  const details: string[] = [
    `${sourceName(session.source)} session ${compact(session.id, 12)}`,
    `state: ${session.state ?? "unknown"}`,
  ];
  if (session.gitBranch) details.push(`branch: ${session.gitBranch}`);
  if (session.model) details.push(`model: ${session.model}`);
  if ((session.filesTouched?.length ?? 0) > 0) {
    details.push(`${session.filesTouched!.length} file${session.filesTouched!.length === 1 ? "" : "s"} touched`);
  }
  if ((session.toolUseCount ?? 0) > 0) {
    details.push(`${session.toolUseCount} tool call${session.toolUseCount === 1 ? "" : "s"}`);
  }
  const evidence: EvidenceRef = {
    id: `session-${session.source}-${session.id}`,
    kind: "session",
    label: `${sourceName(session.source)} · ${compact(session.id, 8)}`,
    detail: details.join(" · "),
    source: session.source,
  };
  if (timestamp) evidence.timestamp = timestamp.toISOString();
  return evidence;
}

function workingTreeEvidence(git: GitSummary, observedAt: Date): EvidenceRef {
  return {
    id: "git-working-tree",
    kind: "working-tree",
    label: `Working tree · ${git.branch}`,
    detail: git.dirty
      ? `${git.dirtyFileCount} uncommitted file${git.dirtyFileCount === 1 ? "" : "s"} on ${git.branch}`
      : `Clean working tree on ${git.branch}`,
    source: "git",
    timestamp: observedAt.toISOString(),
  };
}

function commitEvidence(commit: GitSummary["commits"][number]): EvidenceRef {
  return {
    id: `git-commit-${commit.hash}`,
    kind: "commit",
    label: `Commit ${commit.hash.slice(0, 7)}`,
    detail: `${commit.author}: ${compact(commit.message, 180)}`,
    source: "git",
    timestamp: commit.timestamp,
  };
}

function scanEvidence(projectName: string, available: boolean): EvidenceRef {
  return {
    id: "project-scan",
    kind: "project-scan",
    label: "Project scan",
    detail: available
      ? `Git and configured agent sources were scanned for ${projectName}.`
      : `No readable git or agent-session data was returned for ${projectName}.`,
    source: "runtimebriefd",
  };
}

function latestTimestamp(git: GitSummary | null, sessions: TranscriptRef[]): Date | null {
  const values: number[] = [];
  if (git?.lastCommitAt) {
    const parsed = Date.parse(git.lastCommitAt);
    if (Number.isFinite(parsed)) values.push(parsed);
  }
  for (const session of sessions) {
    const timestamp = sessionTimestamp(session);
    if (timestamp) values.push(timestamp.getTime());
  }
  if (values.length === 0) return null;
  return new Date(Math.max(...values));
}

function latestSession(sessions: TranscriptRef[]): TranscriptRef | null {
  let latest: TranscriptRef | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const session of sessions) {
    const timestamp = sessionTimestamp(session)?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (timestamp > latestTime) {
      latest = session;
      latestTime = timestamp;
    }
  }
  return latest;
}

/**
 * Build a portfolio-ready brief entirely from local git/session facts.
 * This path never invokes the analyst or incurs model cost.
 */
export function buildProjectBrief(
  projectName: string,
  git: GitSummary | null,
  sessions: TranscriptRef[],
  now: Date = new Date(),
): ProjectBrief {
  const available = git !== null || sessions.length > 0;
  const latest = latestTimestamp(git, sessions);
  const latestObservedSession = latestSession(sessions);
  const active = sessions.filter(
    (session) =>
      session.state === "active" &&
      isWithin(sessionTimestamp(session), now, ACTIVE_WINDOW_MS),
  );
  const staleActive = sessions.filter(
    (session) =>
      session.state === "active" &&
      !isWithin(sessionTimestamp(session), now, ACTIVE_WINDOW_MS),
  );
  const waiting = sessions.filter((session) => session.state === "waiting");
  const interrupted = sessions.filter((session) => session.state === "interrupted");
  const completed = sessions.filter((session) => session.state === "completed");
  const claims: BriefClaim[] = [];

  for (const session of waiting.slice(0, 2)) {
    const subject = session.summary ? ` on “${compact(session.summary, 90)}”` : "";
    claims.push({
      id: `waiting-${session.source}-${session.id}`,
      category: "attention",
      text: `${sourceName(session.source)} is waiting for your input${subject}.`,
      evidence: [sessionEvidence(session)],
    });
  }

  for (const session of active.slice(0, 2)) {
    const subject = session.summary ? ` on “${compact(session.summary, 90)}”` : "";
    claims.push({
      id: `active-${session.source}-${session.id}`,
      category: "progress",
      text: `${sourceName(session.source)} is actively working${subject}.`,
      evidence: [sessionEvidence(session)],
    });
  }

  for (const session of interrupted.slice(0, 1)) {
    claims.push({
      id: `interrupted-${session.source}-${session.id}`,
      category: "context",
      text: `${sourceName(session.source)} recorded a stopped session.`,
      evidence: [sessionEvidence(session)],
    });
  }

  for (const session of staleActive.slice(0, 1)) {
    claims.push({
      id: `stale-${session.source}-${session.id}`,
      category: "context",
      text: `${sourceName(session.source)} has no completion event after its last recorded activity.`,
      evidence: [sessionEvidence(session)],
    });
  }

  if (git?.dirty) {
    claims.push({
      id: "dirty-working-tree",
      category: "context",
      text: `${git.dirtyFileCount} uncommitted file${git.dirtyFileCount === 1 ? "" : "s"} in the working tree.`,
      evidence: [workingTreeEvidence(git, now)],
    });
  }

  const latestCompleted = completed[0];
  const completedSources = new Set<string>();
  for (const session of completed) {
    if (completedSources.has(session.source)) continue;
    completedSources.add(session.source);
    const subject = session.summary ? ` “${compact(session.summary, 100)}”` : "";
    claims.push({
      id: `completed-${session.source}-${session.id}`,
      category: "completed",
      text: `${sourceName(session.source)} completed${subject}.`,
      evidence: [sessionEvidence(session)],
    });
  }

  const latestCommit = git?.commits[0];
  if (latestCommit) {
    claims.push({
      id: `commit-${latestCommit.hash}`,
      category: "completed",
      text: `Latest commit: ${compact(latestCommit.message, 120)}.`,
      evidence: [commitEvidence(latestCommit)],
    });
  }

  if (claims.length === 0) {
    claims.push({
      id: available ? "quiet-scan" : "unavailable-scan",
      category: "context",
      text: available
        ? "No commits or agent sessions were found in the current scan."
        : "Project data could not be read.",
      evidence: [scanEvidence(projectName, available)],
    });
  }

  let state: ProjectBriefState;
  let headline: string;
  let headlineEvidence: EvidenceRef[];
  if (!available) {
    state = "unavailable";
    headline = "Project data is unavailable";
    headlineEvidence = [scanEvidence(projectName, false)];
  } else if (waiting.length > 0) {
    state = "attention";
    headline = "Waiting for your input";
    headlineEvidence = [sessionEvidence(waiting[0]!)];
  } else if (active.length > 0) {
    state = "active";
    headline = "Agent work is in progress";
    headlineEvidence = [sessionEvidence(active[0]!)];
  } else if (isWithin(latest, now, RECENT_WINDOW_MS)) {
    state = "recent";
    headline = "Recent work is ready to review";
    headlineEvidence = latestCompleted
      ? [sessionEvidence(latestCompleted)]
      : latestObservedSession
        ? [sessionEvidence(latestObservedSession)]
        : latestCommit
          ? [commitEvidence(latestCommit)]
          : [scanEvidence(projectName, true)];
  } else {
    state = "quiet";
    headline = "No recent agent activity";
    headlineEvidence = latestCompleted
      ? [sessionEvidence(latestCompleted)]
      : latestObservedSession
        ? [sessionEvidence(latestObservedSession)]
        : latestCommit
          ? [commitEvidence(latestCommit)]
          : [scanEvidence(projectName, true)];
  }

  return {
    state,
    headline,
    headlineEvidence,
    updatedAt: latest?.toISOString() ?? null,
    activeSessionCount: active.length,
    claims,
  };
}
