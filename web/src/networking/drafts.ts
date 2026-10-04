import { sha256Hex, uuidLowercase } from "../lib/hash";
import { defaults as defaultStore, type KeyValueStore } from "../lib/storage";
import type {
  AgentProvider,
  ClaudeLaunchRequest,
  ClaudeModel,
  ClaudePermissionMode,
  SessionLaunchRequest,
  SessionReply,
} from "../models/claudeLaunch";
import { isClaudeModel, isClaudePermissionMode } from "../models/claudeLaunch";

/**
 * Foundation's JSONEncoder escapes forward slashes; match it so identity
 * digests read the same across clients.
 */
function encodeStrings(values: string[]): string {
  return JSON.stringify(values).replace(/\//g, "\\/");
}

/** Durable request IDs so a retried task reuses the same identity. */
export const ClaudeLaunchDraft = {
  async key(
    projectID: string,
    scope: string,
    prompt: string,
    model: ClaudeModel,
    permissionMode: ClaudePermissionMode,
    remoteControl: boolean,
  ): Promise<string> {
    // Keep default-mode retry keys compatible with already-sent build-15 tasks.
    const identity = [scope, projectID, prompt];
    if (model !== "default" || permissionMode !== "manual") identity.push(model, permissionMode);
    if (!remoteControl) identity.push("remoteControl", "false");
    return `runtimebrief.claude.request.${await sha256Hex(encodeStrings(identity))}`;
  },

  async request(
    projectID: string,
    scope: string,
    prompt: string,
    model: ClaudeModel = "default",
    permissionMode: ClaudePermissionMode = "manual",
    remoteControl = true,
    store: KeyValueStore = defaultStore,
  ): Promise<ClaudeLaunchRequest> {
    const key = await ClaudeLaunchDraft.key(projectID, scope, prompt, model, permissionMode, remoteControl);
    const id = store.get(key) ?? uuidLowercase();
    store.set(key, id);
    return { requestId: id, prompt, model, permissionMode, remoteControl };
  },

  async clear(
    projectID: string,
    scope: string,
    prompt: string,
    model: ClaudeModel = "default",
    permissionMode: ClaudePermissionMode = "manual",
    remoteControl = true,
    store: KeyValueStore = defaultStore,
  ): Promise<void> {
    store.remove(await ClaudeLaunchDraft.key(projectID, scope, prompt, model, permissionMode, remoteControl));
  },
};

export interface SessionDraftIdentity {
  projectID: string;
  scope: string;
  prompt: string;
  provider: AgentProvider;
  model: string;
  permissionMode: string;
  reasoningEffort: string;
  remoteControl: boolean;
}

export const SessionLaunchDraft = {
  async key(identity: SessionDraftIdentity): Promise<string> {
    const parts = [
      identity.scope,
      identity.projectID,
      identity.prompt,
      identity.provider,
      identity.model,
      identity.permissionMode,
      String(identity.remoteControl),
    ];
    if (identity.reasoningEffort !== "default") parts.push("reasoningEffort", identity.reasoningEffort);
    return `runtimebrief.session.request.${await sha256Hex(encodeStrings(parts))}`;
  },

  async request(identity: SessionDraftIdentity, store: KeyValueStore = defaultStore): Promise<SessionLaunchRequest> {
    const reasoning = identity.reasoningEffort === "default" ? null : identity.reasoningEffort;
    if (
      identity.provider === "claude" &&
      identity.reasoningEffort === "default" &&
      isClaudeModel(identity.model) &&
      isClaudePermissionMode(identity.permissionMode)
    ) {
      const legacy = await ClaudeLaunchDraft.request(
        identity.projectID,
        identity.scope,
        identity.prompt,
        identity.model,
        identity.permissionMode,
        identity.remoteControl,
        store,
      );
      return {
        requestId: legacy.requestId,
        prompt: identity.prompt,
        provider: identity.provider,
        model: identity.model,
        reasoningEffort: reasoning,
        permissionMode: identity.permissionMode,
        remoteControl: identity.remoteControl,
      };
    }
    const key = await SessionLaunchDraft.key(identity);
    const id = store.get(key) ?? uuidLowercase();
    store.set(key, id);
    return {
      requestId: id,
      prompt: identity.prompt,
      provider: identity.provider,
      model: identity.model,
      reasoningEffort: reasoning,
      permissionMode: identity.permissionMode,
      remoteControl: identity.remoteControl,
    };
  },

  async clear(identity: SessionDraftIdentity, store: KeyValueStore = defaultStore): Promise<void> {
    if (
      identity.provider === "claude" &&
      identity.reasoningEffort === "default" &&
      isClaudeModel(identity.model) &&
      isClaudePermissionMode(identity.permissionMode)
    ) {
      await ClaudeLaunchDraft.clear(
        identity.projectID,
        identity.scope,
        identity.prompt,
        identity.model,
        identity.permissionMode,
        identity.remoteControl,
        store,
      );
      return;
    }
    store.remove(await SessionLaunchDraft.key(identity));
  },
};

/** Stable JSON with sorted keys and omitted nulls, like JSONEncoder's `.sortedKeys`. */
function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJSON(item)}`).join(",")}}`;
  }
  return JSON.stringify(value).replace(/\//g, "\\/");
}

/** Preserve response IDs across reloads without storing message contents. */
export const SessionReplyDraft = {
  async key(scope: string, launchID: string, body: SessionReply): Promise<string> {
    const identity: SessionReply = {
      requestId: "",
      text: body.text ?? null,
      approvalId: body.approvalId ?? null,
      optionId: body.optionId ?? null,
      answers: body.answers ?? null,
    };
    const prefix = new TextEncoder().encode(scope + launchID);
    const json = new TextEncoder().encode(stableJSON(identity));
    const combined = new Uint8Array(prefix.length + json.length);
    combined.set(prefix, 0);
    combined.set(json, prefix.length);
    return `runtimebrief.reply.${await sha256Hex(combined)}`;
  },

  async request(scope: string, launchID: string, body: SessionReply, store: KeyValueStore = defaultStore): Promise<SessionReply> {
    const key = await SessionReplyDraft.key(scope, launchID, body);
    const id = store.get(key) ?? uuidLowercase();
    store.set(key, id);
    return {
      requestId: id,
      text: body.text ?? null,
      approvalId: body.approvalId ?? null,
      optionId: body.optionId ?? null,
      answers: body.answers ?? null,
    };
  },

  async clear(scope: string, launchID: string, body: SessionReply, store: KeyValueStore = defaultStore): Promise<void> {
    store.remove(await SessionReplyDraft.key(scope, launchID, body));
  },
};