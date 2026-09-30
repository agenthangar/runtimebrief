import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withCodexApi } from "./codexApi.js";
import { fallbackModel } from "./nativeModels.js";
import { MODEL_ID, type AgentModel, type ClaudeLaunchOptions, type ResolvedSettings } from "./types.js";

const home = () => os.homedir();
function read(file: string): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
function resolve(options: ClaudeLaunchOptions, configuredModel: string | undefined, configuredEffort: string | undefined, fallback: string, models: AgentModel[]): ResolvedSettings {
  const model = options.model !== "default" ? options.model : configuredModel ? "default" : fallback;
  const effective = model === "default" ? configuredModel : model;
  const supported = models.find(value => value.id === effective)?.reasoningEfforts;
  const effort = options.reasoningEffort && options.reasoningEffort !== "default" ? options.reasoningEffort
    : configuredEffort ? "default" : supported?.includes("medium") ? "medium" : "default";
  return { model, reasoningEffort: effort, defaultModelLabel: configuredModel ?? fallback, defaultReasoningLabel: configuredEffort ?? (supported?.includes("medium") ? "medium" : "Native default") };
}

export async function resolveCodexSettings(binary: string, cwd: string, options: ClaudeLaunchOptions, models: AgentModel[]): Promise<ResolvedSettings> {
  try {
    const result = await withCodexApi(binary, request => request<{ config: { model?: string | null; model_reasoning_effort?: string | null } }>("config/read", { cwd, includeLayers: false }));
    return resolve(options, result.config.model ?? undefined, result.config.model_reasoning_effort ?? undefined, fallbackModel("codex", models), models);
  } catch { return { model: options.model, reasoningEffort: options.reasoningEffort ?? "default" }; }
}

export function resolveCursorSettings(options: ClaudeLaunchOptions, models: AgentModel[], directory = process.env.CURSOR_CONFIG_DIR ?? path.join(home(), ".cursor")): ResolvedSettings {
  try {
    const config = read(path.join(directory, "cli-config.json"));
    const selected = config.selectedModel?.modelId ?? config.model?.displayModelId ?? config.model?.modelId;
    // Cursor's saved 'default' is an explicit Auto preference, not an absent setting.
    const model = selected === "default" ? "auto" : typeof selected === "string" && MODEL_ID.test(selected) ? selected : undefined;
    const params = config.selectedModel?.parameters ?? config.modelParameters?.[selected] ?? [];
    const effort = params.find((value: { id: string }) => value.id === "effort")?.value
      ?? /-(none|minimal|low|medium|high|xhigh|max)(?:-fast)?$/.exec(model ?? "")?.[1];
    const resolved = resolve(options, model, effort, fallbackModel("cursor", models), models);
    if (resolved.reasoningEffort !== "default") {
      const chosen = resolved.model === "default" ? model : resolved.model;
      const variant = chosen?.replace(/-(none|minimal|low|medium|high|xhigh|max)(-fast)?$/, `-${resolved.reasoningEffort}$2`);
      if (variant && models.some(value => value.id === variant)) resolved.model = variant;
    }
    return resolved;
  } catch { return { model: options.model, reasoningEffort: options.reasoningEffort ?? "default" }; }
}

export const claudeModels: AgentModel[] = [
  { id: "opus", label: "Opus (latest)", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "fable", label: "Fable (latest)", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "sonnet", label: "Sonnet (latest)", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "haiku", label: "Haiku", reasoningEfforts: [] },
  { id: "best", label: "Best available", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "opusplan", label: "Opus Plan", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "opus[1m]", label: "Opus (1M context)", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "sonnet[1m]", label: "Sonnet (1M context)", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
];
export function resolveClaudeSettings(cwd: string, options: ClaudeLaunchOptions, directory = process.env.CLAUDE_CONFIG_DIR ?? path.join(home(), ".claude")): ResolvedSettings {
  try {
    const user = read(path.join(directory, "settings.json"));
    const project = read(path.join(cwd, ".claude/settings.json"));
    const local = read(path.join(cwd, ".claude/settings.local.json"));
    const managed = read("/Library/Application Support/ClaudeCode/managed-settings.json");
    const settings: Record<string, any> = { ...user, ...project, ...local, ...managed, modelSettings: { ...user.modelSettings, ...project.modelSettings, ...local.modelSettings, ...managed.modelSettings } };
    const env = { ...process.env, ...user.env, ...project.env, ...local.env, ...managed.env };
    const model = env.ANTHROPIC_MODEL ?? settings.model ?? env.ANTHROPIC_DEFAULT_MODEL;
    const selected = options.model === "default" ? model ?? "opus" : options.model;
    const effort = env.CLAUDE_CODE_EFFORT_LEVEL ?? settings.modelSettings?.[selected]?.effortLevel ?? settings.effortLevel;
    const supported = claudeModels.some(value => value.id === selected) ? claudeModels : [...claudeModels, { id: selected, label: selected, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] }];
    return resolve(options, model, effort, "opus", supported);
  } catch { return { model: options.model, reasoningEffort: options.reasoningEffort ?? "default" }; }
}
