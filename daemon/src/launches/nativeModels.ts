import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withCodexApi } from "./codexApi.js";
import { MODEL_ID, type AgentModel } from "./types.js";

const exec = promisify(execFile);
function choices(models: AgentModel[]): AgentModel[] {
  return [...new Map(models.filter(value => MODEL_ID.test(value.id) && value.id !== "default" && value.label.trim() && !/[\u0000-\u001f\u007f]/.test(value.label))
    .map(value => [value.id, { ...value, label: value.label.trim().slice(0, 160) }])).values()];
}

const versions = (id: string) => (id.match(/\d+(?:\.\d+)*/)?.[0] ?? "0").split(".").map(Number);
function newest(a: AgentModel, b: AgentModel) {
  const x = versions(a.id), y = versions(b.id);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const difference = (y[i] ?? 0) - (x[i] ?? 0); if (difference) return difference; }
  return 0;
}
export function orderNativeModels(provider: "codex" | "cursor", models: AgentModel[]): AgentModel[] {
  const priority = (id: string) => provider === "codex" ? (/astra/.test(id) ? 0 : /sol/.test(id) ? 1 : 2) : (/grok/.test(id) ? 0 : 1);
  const effort = (id: string) => /-medium(?:-fast)?$/.test(id) ? 0 : /-high(?:-fast)?$/.test(id) ? 1 : 2;
  return [...models].sort((a, b) => priority(a.id) - priority(b.id) || newest(a, b) || effort(a.id) - effort(b.id));
}
export function fallbackModel(provider: "codex" | "cursor", models: AgentModel[]): string {
  const family = models.filter(value => provider === "codex" ? /sol/.test(value.id) : /grok/.test(value.id));
  family.sort(newest);
  const latest = family[0];
  if (!latest) return "default";
  if (provider === "cursor") {
    const base = latest.id.replace(/-(?:none|minimal|low|medium|high|xhigh|max)(?:-fast)?$/, "");
    return family.find(value => value.id === `${base}-medium`)?.id ?? latest.id;
  }
  return latest.id;
}

export function parseCursorModels(output: string): AgentModel[] {
  // The native CLI prints one slug - display name per line, optionally marked current/default.
  const clean = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  const models = choices(clean.split(/\r?\n/).flatMap(line => {
    const match = /^([A-Za-z0-9][A-Za-z0-9._:/-]{0,127}) - (.+)$/.exec(line.trim());
    return match ? [{ id: match[1]!, label: match[2]!.replace(/ \((?:current|default)(?:, (?:current|default))*\)$/, "") }] : [];
  }));
  return models.map(value => {
    const match = /-(none|minimal|low|medium|high|xhigh|max)(-fast)?$/.exec(value.id);
    if (!match) return value;
    const base = value.id.slice(0, match.index), fast = match[2] ?? "";
    const reasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"].filter(effort => models.some(model => model.id === `${base}-${effort}${fast}`));
    return { ...value, reasoningEfforts };
  });
}

export async function discoverNativeModels(provider: "codex" | "cursor", binary: string): Promise<AgentModel[]> {
  if (provider === "cursor") {
    const { stdout } = await exec(binary, ["--list-models"], { timeout: 10000, maxBuffer: 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } });
    return orderNativeModels(provider, parseCursorModels(stdout));
  }
  return withCodexApi(binary, async request => {
    const models: AgentModel[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: { data: { model: string; displayName: string; hidden: boolean; supportedReasoningEfforts?: { reasoningEffort: string }[] }[]; nextCursor?: string | null } = await request("model/list", { limit: 100, cursor, includeHidden: false });
      models.push(...page.data.filter(value => !value.hidden).map(value => ({ id: value.model, label: value.displayName, ...(value.supportedReasoningEfforts ? { reasoningEfforts: value.supportedReasoningEfforts.map(e => e.reasoningEffort) } : {}) })));
      cursor = page.nextCursor ?? null;
      if (cursor && seen.has(cursor)) throw Error("Invalid model pagination");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return orderNativeModels(provider, choices(models));
  });
}

/** One account catalog per backend, shared across projects and concurrent refreshes. */
export class NativeModelCatalog {
  private value: { models: AgentModel[]; modelsMessage?: string } | undefined;
  private expires = 0;
  private pending: Promise<{ models: AgentModel[]; modelsMessage?: string }> | undefined;
  constructor(private readonly discover: () => Promise<AgentModel[]>) {}
  async get() {
    if (this.value && Date.now() < this.expires) return this.value;
    if (this.pending) return this.pending;
    this.pending = this.discover().then(models => {
      if (!models.length) throw Error("Empty native model catalog");
      this.expires = Date.now() + 300_000;
      return this.value = { models };
    }).catch(() => {
      this.expires = Date.now() + 30_000;
      return this.value = { models: [], modelsMessage: "Could not load models from your Mac. Check the agent's sign-in; Default still uses its configured model." };
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
}
