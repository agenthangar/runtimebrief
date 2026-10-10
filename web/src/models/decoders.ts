import {
  parseDate,
  type AnalystAnswer,
  type AppStoreConnectStatus,
  type AppStoreConnectSummary,
  type AppStoreVersionSummary,
  type BriefClaim,
  type BriefClaimCategory,
  type CommitInfo,
  type EvidenceKind,
  type EvidenceRef,
  type GitSummary,
  type HealthInfo,
  type IOSReleaseSummary,
  type ProjectBrief,
  type ProjectBriefState,
  type ProjectCard,
  type ProjectSummary,
  type SessionInfo,
  type AgentSessionState,
  type TestFlightBuildSummary,
  type VoiceStatus,
  type XcodeProjectSummary,
} from "./types";

type Raw = Record<string, unknown>;

function asRecord(value: unknown, what: string): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${what} to be an object`);
  }
  return value as Raw;
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Expected ${what} to be an array`);
  return value;
}

function str(raw: Raw, key: string): string {
  const value = raw[key];
  if (typeof value !== "string") throw new TypeError(`Expected string for "${key}"`);
  return value;
}

function optStr(raw: Raw, key: string): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new TypeError(`Expected string for "${key}"`);
  return value;
}

function bool(raw: Raw, key: string): boolean {
  const value = raw[key];
  if (typeof value !== "boolean") throw new TypeError(`Expected boolean for "${key}"`);
  return value;
}

function optBool(raw: Raw, key: string): boolean | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new TypeError(`Expected boolean for "${key}"`);
  return value;
}

function num(raw: Raw, key: string): number {
  const value = raw[key];
  if (typeof value !== "number") throw new TypeError(`Expected number for "${key}"`);
  return value;
}

function optNum(raw: Raw, key: string): number | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number") throw new TypeError(`Expected number for "${key}"`);
  return value;
}

function oneOf<T extends string>(raw: Raw, key: string, allowed: readonly T[]): T {
  const value = raw[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`Unexpected value for "${key}": ${String(value)}`);
  }
  return value as T;
}

function optOneOf<T extends string>(raw: Raw, key: string, allowed: readonly T[]): T | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  return oneOf(raw, key, allowed);
}

const BRIEF_STATES: readonly ProjectBriefState[] = ["active", "attention", "recent", "quiet", "unavailable"];
const CLAIM_CATEGORIES: readonly BriefClaimCategory[] = ["attention", "progress", "completed", "context"];
const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  "working-tree",
  "commit",
  "session",
  "project-scan",
  "xcode-project",
  "testflight-build",
  "app-store-version",
];
const SESSION_STATES: readonly AgentSessionState[] = ["active", "waiting", "completed", "interrupted", "unknown"];
const ASC_STATUSES: readonly AppStoreConnectStatus[] = ["available", "not-configured", "app-not-found", "unavailable"];

export function decodeEvidenceRef(value: unknown): EvidenceRef {
  const raw = asRecord(value, "evidence");
  return {
    id: str(raw, "id"),
    kind: oneOf(raw, "kind", EVIDENCE_KINDS),
    label: str(raw, "label"),
    detail: str(raw, "detail"),
    source: optStr(raw, "source"),
    timestamp: parseDate(raw.timestamp),
  };
}

export function decodeBriefClaim(value: unknown): BriefClaim {
  const raw = asRecord(value, "claim");
  return {
    id: str(raw, "id"),
    category: oneOf(raw, "category", CLAIM_CATEGORIES),
    text: str(raw, "text"),
    evidence: asArray(raw.evidence, "evidence").map(decodeEvidenceRef),
  };
}

export function decodeProjectBrief(value: unknown): ProjectBrief | null {
  if (value === undefined || value === null) return null;
  const raw = asRecord(value, "brief");
  return {
    state: oneOf(raw, "state", BRIEF_STATES),
    headline: str(raw, "headline"),
    headlineEvidence: asArray(raw.headlineEvidence, "headlineEvidence").map(decodeEvidenceRef),
    updatedAt: parseDate(raw.updatedAt),
    activeSessionCount: num(raw, "activeSessionCount"),
    claims: asArray(raw.claims, "claims").map(decodeBriefClaim),
  };
}

export function decodeProjectSummary(value: unknown): ProjectSummary {
  const raw = asRecord(value, "project");
  return {
    id: str(raw, "id"),
    name: str(raw, "name"),
    lastActivityAt: parseDate(raw.lastActivityAt),
    branch: optStr(raw, "branch"),
    dirty: optBool(raw, "dirty"),
    brief: decodeProjectBrief(raw.brief),
  };
}

export function decodeProjectSummaries(value: unknown): ProjectSummary[] {
  return asArray(value, "projects").map(decodeProjectSummary);
}

export function decodeCommit(value: unknown): CommitInfo {
  const raw = asRecord(value, "commit");
  const timestamp = parseDate(raw.timestamp);
  if (!timestamp) throw new TypeError('Expected date for "timestamp"');
  return { hash: str(raw, "hash"), author: str(raw, "author"), timestamp, message: str(raw, "message") };
}

export function decodeGitSummary(value: unknown): GitSummary | null {
  if (value === undefined || value === null) return null;
  const raw = asRecord(value, "git");
  return {
    branch: str(raw, "branch"),
    dirty: bool(raw, "dirty"),
    dirtyFileCount: num(raw, "dirtyFileCount"),
    commits: asArray(raw.commits, "commits").map(decodeCommit),
    diffstatVsDefault: optStr(raw, "diffstatVsDefault"),
    defaultBranch: optStr(raw, "defaultBranch"),
    todoCount: num(raw, "todoCount"),
    fixmeCount: num(raw, "fixmeCount"),
    lastCommitAt: parseDate(raw.lastCommitAt),
  };
}

export function decodeSessionInfo(value: unknown): SessionInfo {
  const raw = asRecord(value, "session");
  const files = raw.filesTouched;
  return {
    source: str(raw, "source"),
    id: str(raw, "id"),
    startedAt: parseDate(raw.startedAt),
    endedAt: parseDate(raw.endedAt),
    summary: optStr(raw, "summary"),
    state: optOneOf(raw, "state", SESSION_STATES),
    stateReason: optStr(raw, "stateReason"),
    gitBranch: optStr(raw, "gitBranch"),
    model: optStr(raw, "model"),
    filesTouched:
      files === undefined || files === null
        ? null
        : asArray(files, "filesTouched").map((item) => {
            if (typeof item !== "string") throw new TypeError("Expected string file path");
            return item;
          }),
    toolUseCount: optNum(raw, "toolUseCount"),
    conclusion: optStr(raw, "conclusion"),
  };
}

function decodeXcode(value: unknown): XcodeProjectSummary {
  const raw = asRecord(value, "xcode");
  return {
    source: str(raw, "source"),
    projectFile: str(raw, "projectFile"),
    scheme: str(raw, "scheme"),
    bundleId: str(raw, "bundleId"),
    marketingVersion: optStr(raw, "marketingVersion"),
    buildNumber: optStr(raw, "buildNumber"),
  };
}

function decodeTestFlight(value: unknown): TestFlightBuildSummary | null {
  if (value === undefined || value === null) return null;
  const raw = asRecord(value, "testflight build");
  return {
    id: str(raw, "id"),
    marketingVersion: optStr(raw, "marketingVersion"),
    buildNumber: str(raw, "buildNumber"),
    uploadedAt: parseDate(raw.uploadedAt),
    expiresAt: parseDate(raw.expiresAt),
    expired: bool(raw, "expired"),
    processingState: str(raw, "processingState"),
    audienceType: optStr(raw, "audienceType"),
  };
}

function decodeAppStoreVersion(value: unknown): AppStoreVersionSummary | null {
  if (value === undefined || value === null) return null;
  const raw = asRecord(value, "app store version");
  return {
    id: str(raw, "id"),
    version: str(raw, "version"),
    buildNumber: optStr(raw, "buildNumber"),
    state: str(raw, "state"),
    createdAt: parseDate(raw.createdAt),
  };
}

function decodeAppStoreConnect(value: unknown): AppStoreConnectSummary {
  const raw = asRecord(value, "appStoreConnect");
  return {
    status: oneOf(raw, "status", ASC_STATUSES),
    checkedAt: parseDate(raw.checkedAt),
    message: optStr(raw, "message"),
    appId: optStr(raw, "appId"),
    latestTestFlightBuild: decodeTestFlight(raw.latestTestFlightBuild),
    appStoreVersion: decodeAppStoreVersion(raw.appStoreVersion),
  };
}

export function decodeIOSRelease(value: unknown): IOSReleaseSummary | null {
  if (value === undefined || value === null) return null;
  const raw = asRecord(value, "iosRelease");
  return { xcode: decodeXcode(raw.xcode), appStoreConnect: decodeAppStoreConnect(raw.appStoreConnect) };
}

export function decodeProjectCard(value: unknown): ProjectCard {
  const raw = asRecord(value, "project card");
  return {
    id: str(raw, "id"),
    name: str(raw, "name"),
    path: str(raw, "path"),
    lastActivityAt: parseDate(raw.lastActivityAt),
    git: decodeGitSummary(raw.git),
    iosRelease: decodeIOSRelease(raw.iosRelease),
    sessions: asArray(raw.sessions, "sessions").map(decodeSessionInfo),
    brief: decodeProjectBrief(raw.brief),
  };
}

export function decodeAnalystAnswer(value: unknown): AnalystAnswer {
  const raw = asRecord(value, "analyst answer");
  const evidence = raw.evidence;
  return {
    answer: str(raw, "answer"),
    costUsd: num(raw, "costUsd"),
    cached: bool(raw, "cached"),
    truncated: bool(raw, "truncated"),
    evidence: evidence === undefined || evidence === null ? null : asArray(evidence, "evidence").map(decodeEvidenceRef),
  };
}

export function decodeVoiceStatus(value: unknown): VoiceStatus {
  const raw = asRecord(value, "voice status");
  return {
    answer: optStr(raw, "answer"),
    analyzedAt: parseDate(raw.analyzedAt),
    model: optStr(raw, "model"),
    evidence: asArray(raw.evidence, "evidence").map(decodeEvidenceRef),
    refreshing: bool(raw, "refreshing"),
    unavailable: bool(raw, "unavailable"),
  };
}

export function decodeHealth(value: unknown): HealthInfo {
  const raw = asRecord(value, "health");
  return { version: str(raw, "version"), uptime: num(raw, "uptime") };
}

/** Re-hydrate dates inside a JSON snapshot that was persisted with `JSON.stringify`. */
export function reviveProjectSummaries(value: unknown): ProjectSummary[] {
  return decodeProjectSummaries(value);
}
