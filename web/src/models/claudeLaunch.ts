import { parseDate } from "./types";

export type AgentProvider = "claude" | "codex" | "cursor";
export const AGENT_PROVIDERS: readonly AgentProvider[] = ["claude", "codex", "cursor"];

export type ClaudeModel = "default" | "fable" | "opus" | "sonnet" | "haiku";
export const CLAUDE_MODELS: readonly ClaudeModel[] = ["default", "fable", "opus", "sonnet", "haiku"];

export type ClaudePermissionMode =
  | "manual"
  | "auto"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions"
  | "dontAsk";
export const CLAUDE_PERMISSION_MODES: readonly ClaudePermissionMode[] = [
  "manual",
  "auto",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "dontAsk",
];

export function isClaudeModel(value: string | null | undefined): value is ClaudeModel {
  return value !== null && value !== undefined && (CLAUDE_MODELS as readonly string[]).includes(value);
}

export function isClaudePermissionMode(value: string | null | undefined): value is ClaudePermissionMode {
  return (
    value !== null && value !== undefined && (CLAUDE_PERMISSION_MODES as readonly string[]).includes(value)
  );
}

export function claudeModelLabel(model: ClaudeModel): string {
  switch (model) {
    case "default":
      return "Claude default";
    case "fable":
      return "Fable";
    case "opus":
      return "Opus";
    case "sonnet":
      return "Sonnet";
    case "haiku":
      return "Haiku";
  }
}

export function claudePermissionLabel(mode: ClaudePermissionMode): string {
  switch (mode) {
    case "manual":
      return "Manual";
    case "auto":
      return "Auto";
    case "acceptEdits":
      return "Accept Edits";
    case "plan":
      return "Plan";
    case "bypassPermissions":
      return "Bypass";
    case "dontAsk":
      return "Pre-approved Only";
  }
}

export function claudePermissionExplanation(mode: ClaudePermissionMode): string {
  switch (mode) {
    case "manual":
      return "Claude asks before actions that need permission.";
    case "auto":
      return "Claude checks actions automatically. Availability depends on your Claude account and model.";
    case "acceptEdits":
      return "Claude can edit files automatically and asks before other actions that need permission.";
    case "plan":
      return "Claude explores and plans before making changes.";
    case "bypassPermissions":
      return "Runs tools without permission prompts or safety checks. Use only for work and projects you trust.";
    case "dontAsk":
      return "Runs only pre-approved tools and denies actions that would need approval.";
  }
}

export function providerLabel(provider: AgentProvider): string {
  switch (provider) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
  }
}

export function providerModes(provider: AgentProvider): string[] {
  if (provider === "claude") return [...CLAUDE_PERMISSION_MODES];
  if (provider === "cursor") return ["manual", "plan", "ask"];
  return ["manual", "plan"];
}

function capitalized(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

export function providerPermissionLabel(_provider: AgentProvider, mode: string): string {
  if (mode === "ask") return "Ask";
  if (isClaudePermissionMode(mode)) return claudePermissionLabel(mode);
  return capitalized(mode);
}

export function providerPermissionExplanation(provider: AgentProvider, mode: string): string {
  if (provider === "claude") return isClaudePermissionMode(mode) ? claudePermissionExplanation(mode) : "";
  switch (mode) {
    case "auto":
      return provider === "codex"
        ? "Codex reviews approval requests automatically in its workspace sandbox."
        : "Cursor reviews safe actions automatically and asks before other actions.";
    case "plan":
      return provider === "codex"
        ? "Codex explores in its read-only sandbox."
        : "Cursor explores and plans before making changes.";
    case "ask":
      return "Cursor answers questions without making changes.";
    case "bypassPermissions":
      return provider === "codex"
        ? "Runs Codex without approval prompts or its sandbox."
        : "Runs Cursor without approval prompts or its sandbox. Explicitly denied commands remain denied.";
    case "dontAsk":
      return "Codex uses its workspace sandbox and denies actions that would need approval.";
    default:
      return provider === "codex"
        ? "Codex uses its workspace sandbox and asks before actions that need approval."
        : "Cursor asks before actions that need permission.";
  }
}

export interface ClaudeRemoteControl {
  state: string;
  url: string | null;
}

export function remoteControlNativeURL(remote: ClaudeRemoteControl): URL | null {
  if (!remote.url || !/^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+$/.test(remote.url)) return null;
  try {
    return new URL(remote.url);
  } catch {
    return null;
  }
}

export function remoteControlLabel(remote: ClaudeRemoteControl): string {
  switch (remote.state) {
    case "ready":
      return "Remote Control connected";
    case "disabled":
      return "Remote Control off";
    case "starting":
      return "Remote Control starting";
    case "unavailable":
      return "Remote Control needs setup in Claude";
    default:
      return "Remote Control connection unconfirmed";
  }
}

export function remoteControlTerminalLabel(remote: ClaudeRemoteControl): string {
  switch (remote.state) {
    case "ready":
      return "Remote terminal connected";
    case "disabled":
      return "Remote Control off";
    case "starting":
      return "Remote terminal starting";
    default:
      return "Remote terminal unavailable";
  }
}

export interface ClaudeLaunch {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  state: string;
  message: string;
  nativeId: string | null;
  sessionId: string | null;
  cwd: string;
  openedAt: Date | null;
  model: string | null;
  reasoningEffort: string | null;
  effectiveReasoningEffort: string | null;
  permissionMode: string | null;
  backend: string | null;
  tmuxTarget: string | null;
  launchState: string | null;
  activity: string | null;
  requestedRemoteControl: boolean | null;
  remoteControl: ClaudeRemoteControl | null;
  provider: AgentProvider | null;
}

export function launchAgent(launch: ClaudeLaunch): AgentProvider {
  return launch.provider ?? "claude";
}

export function launchSettingsLabel(launch: ClaudeLaunch): string {
  const agent = launchAgent(launch);
  let model: string;
  if (agent === "claude") {
    const raw = launch.model ?? "default";
    model = isClaudeModel(raw) ? claudeModelLabel(raw) : "Claude";
  } else {
    model =
      launch.model === null || launch.model === "default" ? `${providerLabel(agent)} default` : launch.model;
  }
  const rawMode = launch.permissionMode ?? "manual";
  const permissions = isClaudePermissionMode(rawMode) ? claudePermissionLabel(rawMode) : capitalized(rawMode);
  return `${model} · ${permissions}`;
}

export function launchStateLabel(launch: ClaudeLaunch): string {
  switch (launch.state) {
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "needs_input":
      return launch.message.toLowerCase().includes("question") ? "Needs a reply" : "Needs approval";
    case "completed":
      return "Ready to review";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "in_desktop":
      return "In Claude Desktop";
    default:
      return "Status unavailable";
  }
}

export interface ClaudeLaunchCapability {
  available: boolean;
  message: string;
}

export interface AgentModel {
  id: string;
  label: string;
  reasoningEfforts: string[] | null;
}

export interface AgentCapability {
  id: AgentProvider;
  available: boolean;
  message: string;
  checking: boolean | null;
  models: AgentModel[] | null;
  modelsMessage: string | null;
  permissionModes: string[] | null;
  defaultModelLabel: string | null;
  defaultReasoningLabel: string | null;
}

export function makeCapability(
  id: AgentProvider,
  available: boolean,
  message: string,
  extra: Partial<Omit<AgentCapability, "id" | "available" | "message">> = {},
): AgentCapability {
  return {
    id,
    available,
    message,
    checking: extra.checking ?? null,
    models: extra.models ?? null,
    modelsMessage: extra.modelsMessage ?? null,
    permissionModes: extra.permissionModes ?? null,
    defaultModelLabel: extra.defaultModelLabel ?? null,
    defaultReasoningLabel: extra.defaultReasoningLabel ?? null,
  };
}

export interface ClaudeLaunchList {
  capability: ClaudeLaunchCapability;
  launches: ClaudeLaunch[];
  providers: AgentCapability[] | null;
}

export interface AgentProviderList {
  providers: AgentCapability[];
}

export interface SessionLaunchRequest {
  requestId: string;
  prompt: string;
  provider: AgentProvider;
  model: string;
  reasoningEffort: string | null;
  permissionMode: string;
  remoteControl: boolean;
}

export interface ClaudeLaunchRequest {
  requestId: string;
  prompt: string;
  model: ClaudeModel;
  permissionMode: ClaudePermissionMode;
  remoteControl: boolean;
}

export interface TerminalSnapshot {
  screen: string;
  cols: number;
  rows: number;
  writable: boolean;
  message: string;
}

export interface TerminalInput {
  requestId: string;
  data: string;
}

export interface TerminalInputResult {
  state: string;
}

export interface ConversationMessage {
  id: string;
  role: string;
  text: string;
}

export interface AgentOption {
  id: string;
  label: string;
}

export interface AgentQuestion {
  id: string;
  prompt: string;
  options: AgentOption[];
}

export interface AgentRequest {
  id: string;
  title: string;
  body: string;
  options: AgentOption[];
  questions: AgentQuestion[];
}

export interface ConversationSnapshot {
  state: string;
  message: string;
  writable: boolean | null;
  messages: ConversationMessage[];
  requests: AgentRequest[];
}

export interface SessionReply {
  requestId: string;
  text?: string | null;
  approvalId?: string | null;
  optionId?: string | null;
  answers?: Record<string, string[]> | null;
}

export interface SessionReplyResult {
  accepted: boolean;
  unknown: boolean | null;
}

// MARK: Decoders

type Raw = Record<string, unknown>;

function asRecord(value: unknown, what: string): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${what} to be an object`);
  }
  return value as Raw;
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

function optBool(raw: Raw, key: string): boolean | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new TypeError(`Expected boolean for "${key}"`);
  return value;
}

function bool(raw: Raw, key: string): boolean {
  const value = raw[key];
  if (typeof value !== "boolean") throw new TypeError(`Expected boolean for "${key}"`);
  return value;
}

function num(raw: Raw, key: string): number {
  const value = raw[key];
  if (typeof value !== "number") throw new TypeError(`Expected number for "${key}"`);
  return value;
}

function isProvider(value: unknown): value is AgentProvider {
  return typeof value === "string" && (AGENT_PROVIDERS as readonly string[]).includes(value);
}

export function decodeClaudeLaunch(value: unknown): ClaudeLaunch {
  const raw = asRecord(value, "launch");
  const createdAt = parseDate(raw.createdAt);
  if (!createdAt) throw new TypeError('Expected date for "createdAt"');
  const provider = raw.provider;
  if (provider !== undefined && provider !== null && !isProvider(provider)) {
    throw new TypeError(`Unknown provider "${String(provider)}"`);
  }
  const remote = raw.remoteControl;
  return {
    id: str(raw, "id"),
    projectId: str(raw, "projectId"),
    name: str(raw, "name"),
    createdAt,
    state: str(raw, "state"),
    message: str(raw, "message"),
    nativeId: optStr(raw, "nativeId"),
    sessionId: optStr(raw, "sessionId"),
    cwd: str(raw, "cwd"),
    openedAt: parseDate(raw.openedAt),
    model: optStr(raw, "model"),
    reasoningEffort: optStr(raw, "reasoningEffort"),
    effectiveReasoningEffort: optStr(raw, "effectiveReasoningEffort"),
    permissionMode: optStr(raw, "permissionMode"),
    backend: optStr(raw, "backend"),
    tmuxTarget: optStr(raw, "tmuxTarget"),
    launchState: optStr(raw, "launchState"),
    activity: optStr(raw, "activity"),
    requestedRemoteControl: optBool(raw, "requestedRemoteControl"),
    remoteControl:
      remote === undefined || remote === null
        ? null
        : { state: str(asRecord(remote, "remoteControl"), "state"), url: optStr(asRecord(remote, "remoteControl"), "url") },
    provider: provider === undefined || provider === null ? null : provider,
  };
}

export function decodeAgentModel(value: unknown): AgentModel {
  const raw = asRecord(value, "model");
  const efforts = raw.reasoningEfforts;
  return {
    id: str(raw, "id"),
    label: str(raw, "label"),
    reasoningEfforts:
      efforts === undefined || efforts === null
        ? null
        : (efforts as unknown[]).map((item) => {
            if (typeof item !== "string") throw new TypeError("Expected string reasoning effort");
            return item;
          }),
  };
}

export function decodeAgentCapability(value: unknown): AgentCapability {
  const raw = asRecord(value, "capability");
  const id = raw.id;
  if (!isProvider(id)) throw new TypeError(`Unknown provider "${String(id)}"`);
  const models = raw.models;
  const modes = raw.permissionModes;
  return {
    id,
    available: bool(raw, "available"),
    message: str(raw, "message"),
    checking: optBool(raw, "checking"),
    models: models === undefined || models === null ? null : (models as unknown[]).map(decodeAgentModel),
    modelsMessage: optStr(raw, "modelsMessage"),
    permissionModes:
      modes === undefined || modes === null
        ? null
        : (modes as unknown[]).map((item) => {
            if (typeof item !== "string") throw new TypeError("Expected string permission mode");
            return item;
          }),
    defaultModelLabel: optStr(raw, "defaultModelLabel"),
    defaultReasoningLabel: optStr(raw, "defaultReasoningLabel"),
  };
}

export function decodeClaudeLaunchList(value: unknown): ClaudeLaunchList {
  const raw = asRecord(value, "launch list");
  const capability = asRecord(raw.capability, "capability");
  const launches = raw.launches;
  if (!Array.isArray(launches)) throw new TypeError('Expected array for "launches"');
  const providers = raw.providers;
  return {
    capability: { available: bool(capability, "available"), message: str(capability, "message") },
    launches: launches.map(decodeClaudeLaunch),
    providers:
      providers === undefined || providers === null ? null : (providers as unknown[]).map(decodeAgentCapability),
  };
}

export function decodeAgentProviderList(value: unknown): AgentProviderList {
  const raw = asRecord(value, "provider list");
  const providers = raw.providers;
  if (!Array.isArray(providers)) throw new TypeError('Expected array for "providers"');
  return { providers: providers.map(decodeAgentCapability) };
}

export function decodeTerminalSnapshot(value: unknown): TerminalSnapshot {
  const raw = asRecord(value, "terminal");
  return {
    screen: str(raw, "screen"),
    cols: num(raw, "cols"),
    rows: num(raw, "rows"),
    writable: bool(raw, "writable"),
    message: str(raw, "message"),
  };
}

export function decodeTerminalInputResult(value: unknown): TerminalInputResult {
  return { state: str(asRecord(value, "input result"), "state") };
}

function decodeOption(value: unknown): AgentOption {
  const raw = asRecord(value, "option");
  return { id: str(raw, "id"), label: str(raw, "label") };
}

export function decodeConversationSnapshot(value: unknown): ConversationSnapshot {
  const raw = asRecord(value, "conversation");
  const messages = raw.messages;
  const requests = raw.requests;
  if (!Array.isArray(messages)) throw new TypeError('Expected array for "messages"');
  if (!Array.isArray(requests)) throw new TypeError('Expected array for "requests"');
  return {
    state: str(raw, "state"),
    message: str(raw, "message"),
    writable: optBool(raw, "writable"),
    messages: messages.map((item) => {
      const message = asRecord(item, "message");
      return { id: str(message, "id"), role: str(message, "role"), text: str(message, "text") };
    }),
    requests: requests.map((item) => {
      const request = asRecord(item, "request");
      const options = request.options;
      const questions = request.questions;
      if (!Array.isArray(options)) throw new TypeError('Expected array for "options"');
      if (!Array.isArray(questions)) throw new TypeError('Expected array for "questions"');
      return {
        id: str(request, "id"),
        title: str(request, "title"),
        body: str(request, "body"),
        options: options.map(decodeOption),
        questions: questions.map((entry) => {
          const question = asRecord(entry, "question");
          const questionOptions = question.options;
          if (!Array.isArray(questionOptions)) throw new TypeError('Expected array for "options"');
          return {
            id: str(question, "id"),
            prompt: str(question, "prompt"),
            options: questionOptions.map(decodeOption),
          };
        }),
      };
    }),
  };
}

export function decodeSessionReplyResult(value: unknown): SessionReplyResult {
  const raw = asRecord(value, "reply result");
  return { accepted: bool(raw, "accepted"), unknown: optBool(raw, "unknown") };
}
