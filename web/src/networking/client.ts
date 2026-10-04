import {
  decodeAgentCapability,
  decodeAgentProviderList,
  decodeClaudeLaunch,
  decodeClaudeLaunchList,
  decodeConversationSnapshot,
  decodeSessionReplyResult,
  decodeTerminalInputResult,
  decodeTerminalSnapshot,
  isClaudeModel,
  isClaudePermissionMode,
  type AgentCapability,
  type AgentProvider,
  type AgentProviderList,
  type ClaudeLaunch,
  type ClaudeLaunchList,
  type ClaudeLaunchRequest,
  type ConversationSnapshot,
  type SessionLaunchRequest,
  type SessionReply,
  type SessionReplyResult,
  type TerminalInput,
  type TerminalInputResult,
  type TerminalSnapshot,
} from "../models/claudeLaunch";
import {
  decodeAnalystAnswer,
  decodeHealth,
  decodeProjectCard,
  decodeProjectSummaries,
  decodeVoiceStatus,
} from "../models/decoders";
import type { AnalystAnswer, HealthInfo, ProjectCard, ProjectSummary, VoiceStatus } from "../models/types";
import { RuntimeBriefError } from "./errors";
import { ServerSettingsStore, type ServerSettings } from "./serverSettings";
import { SSEParser, type SSEEvent } from "./sseParser";

/** Transport seam so unit tests can run without a network. */
export type HTTPTransport = (url: string, init: RequestInit) => Promise<Response>;

export type AnalystStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "done"; answer: AnalystAnswer }
  | { type: "failure"; message: string };

export function analystStreamEvent(event: SSEEvent): AnalystStreamEvent | null {
  switch (event.name) {
    case "chunk": {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        const text = payload.text;
        if (typeof text !== "string") return null;
        return { type: "chunk", text };
      } catch {
        return null;
      }
    }
    case "done": {
      try {
        return { type: "done", answer: decodeAnalystAnswer(JSON.parse(event.data)) };
      } catch {
        return null;
      }
    }
    case "error":
      return { type: "failure", message: event.data };
    default:
      return null;
  }
}

interface LaunchFailure {
  message?: unknown;
}

function launchFailureMessage(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as LaunchFailure;
    return typeof parsed.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}

const defaultTransport: HTTPTransport = (url, init) => fetch(url, init);

/** Async client for the runtimebriefd /v1 API. */
export class RuntimeBriefClient {
  readonly settings: ServerSettings;
  readonly transport: HTTPTransport;
  readonly timeoutSeconds: number;

  constructor(options: { settings?: ServerSettings; transport?: HTTPTransport; timeout?: number } = {}) {
    this.settings = options.settings ?? ServerSettingsStore.load();
    this.transport = options.transport ?? defaultTransport;
    this.timeoutSeconds = options.timeout ?? 20;
  }

  // MARK: Endpoints

  health(): Promise<HealthInfo> {
    return this.getJSON("/v1/health", decodeHealth);
  }

  /** A healthy process alone does not prove that the project list is usable. */
  async checkConnection(): Promise<{ health: HealthInfo; projectCount: number }> {
    const health = await this.health();
    try {
      const projects = await this.projects();
      return { health, projectCount: projects.length };
    } catch (error) {
      throw RuntimeBriefError.projectRefresh(error instanceof Error ? error.message : String(error));
    }
  }

  claudeLaunches(projectID: string): Promise<ClaudeLaunchList> {
    return this.getJSON(`/v1/projects/${escape(projectID)}/claude-launches`, decodeClaudeLaunchList);
  }

  startClaude(projectID: string, request: ClaudeLaunchRequest): Promise<ClaudeLaunch> {
    return this.launchRequest(`/v1/projects/${escape(projectID)}/claude-launches`, request, decodeClaudeLaunch);
  }

  agentProviders(): Promise<AgentProviderList> {
    return this.getJSON("/v1/providers", decodeAgentProviderList);
  }

  agentModels(projectID: string, provider: AgentProvider): Promise<AgentCapability> {
    return this.getJSON(`/v1/projects/${escape(projectID)}/providers/${provider}`, decodeAgentCapability);
  }

  conversation(projectID: string, launchID: string): Promise<ConversationSnapshot> {
    return this.getJSON(
      `/v1/projects/${escape(projectID)}/sessions/${escape(launchID)}/conversation`,
      decodeConversationSnapshot,
    );
  }

  reply(projectID: string, launchID: string, reply: SessionReply): Promise<SessionReplyResult> {
    return this.launchRequest(
      `/v1/projects/${escape(projectID)}/sessions/${escape(launchID)}/reply`,
      reply,
      decodeSessionReplyResult,
    );
  }

  async sessions(projectID: string): Promise<ClaudeLaunchList> {
    try {
      return await this.getJSON(`/v1/projects/${escape(projectID)}/sessions`, decodeClaudeLaunchList);
    } catch (error) {
      if (RuntimeBriefError.is(error, "notFound")) return this.claudeLaunches(projectID);
      throw error;
    }
  }

  async startSession(projectID: string, request: SessionLaunchRequest): Promise<ClaudeLaunch> {
    try {
      return await this.launchRequest(`/v1/projects/${escape(projectID)}/sessions`, request, decodeClaudeLaunch);
    } catch (error) {
      if (RuntimeBriefError.is(error, "notFound") && request.provider === "claude") {
        if (!isClaudeModel(request.model) || !isClaudePermissionMode(request.permissionMode)) throw error;
        return this.startClaude(projectID, {
          requestId: request.requestId,
          prompt: request.prompt,
          model: request.model,
          permissionMode: request.permissionMode,
          remoteControl: request.remoteControl,
        });
      }
      throw error;
    }
  }

  terminal(projectID: string, launchID: string): Promise<TerminalSnapshot> {
    return this.getJSON(`/v1/projects/${escape(projectID)}/sessions/${escape(launchID)}/terminal`, decodeTerminalSnapshot);
  }

  sendInput(projectID: string, launchID: string, input: TerminalInput): Promise<TerminalInputResult> {
    return this.launchRequest(
      `/v1/projects/${escape(projectID)}/sessions/${escape(launchID)}/input`,
      input,
      decodeTerminalInputResult,
    );
  }

  openClaude(projectID: string, launchID: string): Promise<ClaudeLaunch> {
    return this.launchRequest(
      `/v1/projects/${escape(projectID)}/claude-launches/${escape(launchID)}/open`,
      {},
      decodeClaudeLaunch,
    );
  }

  projects(): Promise<ProjectSummary[]> {
    return this.getJSON("/v1/projects", decodeProjectSummaries);
  }

  project(id: string): Promise<ProjectCard> {
    return this.getJSON(`/v1/projects/${escape(id)}`, decodeProjectCard);
  }

  status(projectID: string): Promise<AnalystAnswer> {
    return this.getJSON(`/v1/projects/${escape(projectID)}/status`, decodeAnalystAnswer);
  }

  voiceStatus(projectID: string): Promise<VoiceStatus> {
    return this.getJSON(`/v1/projects/${escape(projectID)}/voice-status`, decodeVoiceStatus);
  }

  async ask(projectID: string, question: string): Promise<AnalystAnswer> {
    const { url, init } = this.makeRequest(`/v1/projects/${escape(projectID)}/ask`);
    init.method = "POST";
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify({ question });
    const response = await this.perform(url, init, this.timeoutSeconds);
    this.check(response);
    return decodeBody(await response.text(), decodeAnalystAnswer);
  }

  /** Streaming variants: yield text chunks as the analyst produces them. */
  streamStatus(projectID: string): AsyncGenerator<AnalystStreamEvent> {
    return this.streamRequest(`/v1/projects/${escape(projectID)}/status`, null);
  }

  streamAsk(projectID: string, question: string): AsyncGenerator<AnalystStreamEvent> {
    return this.streamRequest(`/v1/projects/${escape(projectID)}/ask`, JSON.stringify({ question }));
  }

  // MARK: Internals

  private makeRequest(path: string): { url: string; init: RequestInit } {
    const { baseURL, token } = this.settings;
    if (!baseURL || !token || token.length === 0) throw RuntimeBriefError.notConfigured();
    let url: string;
    try {
      url = new URL(path, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();
    } catch {
      throw RuntimeBriefError.invalidServerURL();
    }
    return {
      url,
      init: {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` } as Record<string, string>,
      },
    };
  }

  private async perform(url: string, init: RequestInit, timeoutSeconds: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    try {
      return await this.transport(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof RuntimeBriefError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw RuntimeBriefError.timeout();
      }
      throw RuntimeBriefError.network(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private check(response: Response): void {
    const code = response.status;
    if (code >= 200 && code <= 299) return;
    if (code === 401) throw RuntimeBriefError.unauthorized();
    if (code === 404) throw RuntimeBriefError.notFound();
    if (code === 429) throw RuntimeBriefError.rateLimited();
    throw RuntimeBriefError.serverError(code);
  }

  private async getJSON<T>(path: string, decode: (raw: unknown) => T): Promise<T> {
    const { url, init } = this.makeRequest(path);
    const response = await this.perform(url, init, this.timeoutSeconds);
    const text = await response.text();
    if ([403, 409, 503].includes(response.status)) {
      const message = launchFailureMessage(text);
      if (message) throw RuntimeBriefError.launch(message);
    }
    this.check(response);
    return decodeBody(text, decode);
  }

  private async launchRequest<T>(path: string, body: unknown, decode: (raw: unknown) => T): Promise<T> {
    const { url, init } = this.makeRequest(path);
    init.method = "POST";
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    // Swift's Codable omits nil optionals; drop nulls so the daemon sees the same JSON.
    init.body = JSON.stringify(body, (_key, value: unknown) => (value === null ? undefined : value));
    const response = await this.perform(url, init, Math.max(this.timeoutSeconds, 45));
    const text = await response.text();
    if ([400, 403, 409, 503].includes(response.status)) {
      const message = launchFailureMessage(text);
      if (message) throw RuntimeBriefError.launch(message);
    }
    this.check(response);
    return decodeBody(text, decode);
  }

  private async *streamRequest(path: string, body: string | null): AsyncGenerator<AnalystStreamEvent> {
    const { url, init } = this.makeRequest(path);
    (init.headers as Record<string, string>).Accept = "text/event-stream";
    if (body !== null) {
      init.method = "POST";
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = body;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);
    let response: Response;
    try {
      response = await this.transport(url, { ...init, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw RuntimeBriefError.timeout();
      }
      throw RuntimeBriefError.network(error instanceof Error ? error.message : String(error));
    }
    clearTimeout(timer);
    this.check(response);

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // The daemon may answer a buffered JSON object instead of SSE.
      const answer = decodeBody(await response.text(), decodeAnalystAnswer);
      yield { type: "done", answer };
      return;
    }

    const parser = new SSEParser();
    const emit = (event: SSEEvent | null): AnalystStreamEvent | null => {
      if (!event) return null;
      return analystStreamEvent(event);
    };

    const reader = response.body?.getReader();
    if (!reader) {
      // Non-streaming bodies still arrive as one chunk.
      const text = await response.text();
      for (const line of text.split("\n")) {
        const parsed = emit(parser.consume(line.replace(/\r$/, "")));
        if (parsed) {
          yield parsed;
          if (parsed.type === "done") return;
        }
      }
      const trailing = emit(parser.finish());
      if (trailing) yield trailing;
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          let line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          const parsed = emit(parser.consume(line));
          if (parsed) {
            yield parsed;
            if (parsed.type === "done") {
              await reader.cancel().catch(() => undefined);
              return;
            }
          }
          newline = buffer.indexOf("\n");
        }
      }
      buffer += decoder.decode();
      if (buffer.length > 0) {
        const parsed = emit(parser.consume(buffer.replace(/\r$/, "")));
        if (parsed) {
          yield parsed;
          if (parsed.type === "done") return;
        }
      }
      const trailing = emit(parser.finish());
      if (trailing) yield trailing;
    } catch (error) {
      if (error instanceof RuntimeBriefError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw RuntimeBriefError.timeout();
      throw RuntimeBriefError.network(error instanceof Error ? error.message : String(error));
    }
  }
}

function escape(id: string): string {
  return encodeURIComponent(id);
}

function decodeBody<T>(text: string, decode: (raw: unknown) => T): T {
  try {
    return decode(JSON.parse(text));
  } catch (error) {
    throw RuntimeBriefError.decoding(error instanceof Error ? error.message : String(error));
  }
}
