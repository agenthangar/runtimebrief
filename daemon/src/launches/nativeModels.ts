import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withCodexApi } from "./codexApi.js";
import type { AgentModel } from "./types.js";

const exec = promisify(execFile);
const modelId = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
function choices(models: AgentModel[]): AgentModel[] {
  return [...new Map(models.filter(value => modelId.test(value.id) && value.id !== "default" && value.label.trim() && !/[\u0000-\u001f\u007f]/.test(value.label))
    .map(value => [value.id, { id: value.id, label: value.label.trim().slice(0, 160) }])).values()];
}

export function parseCursorModels(output: string): AgentModel[] {
  // The native CLI prints one slug - display name per line, optionally marked current/default.
  const clean = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  return choices(clean.split(/\r?\n/).flatMap(line => {
    const match = /^([A-Za-z0-9][A-Za-z0-9._:/-]{0,127}) - (.+)$/.exec(line.trim());
    return match ? [{ id: match[1]!, label: match[2]!.replace(/ \((?:current|default)(?:, (?:current|default))*\)$/, "") }] : [];
  }));
}

export async function discoverNativeModels(provider: "codex" | "cursor", binary: string): Promise<AgentModel[]> {
  if (provider === "cursor") {
    const { stdout } = await exec(binary, ["--list-models"], { timeout: 10000, maxBuffer: 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } });
    return parseCursorModels(stdout);
  }
  return withCodexApi(binary, async request => {
    const models: AgentModel[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: { data: { model: string; displayName: string; hidden: boolean }[]; nextCursor?: string | null } = await request("model/list", { limit: 100, cursor, includeHidden: false });
      models.push(...page.data.filter(value => !value.hidden).map(value => ({ id: value.model, label: value.displayName })));
      cursor = page.nextCursor ?? null;
      if (cursor && seen.has(cursor)) throw Error("Invalid model pagination");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return choices(models);
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
