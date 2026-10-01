import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { configDir } from "../config.js";
import { sharesGitRepository } from "./gitWorkspace.js";
import type { ParsedSession } from "./claudeCodeSessions.js";
import type { ProjectConfig, TranscriptRef } from "../types.js";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function json(file: string) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 512000) throw Error("Invalid native snapshot");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function isNativeCursorSnapshot(file: string, root = configDir()): boolean {
  return path.basename(file) === "state.json" && uuid.test(path.basename(path.dirname(file)))
    && path.dirname(path.dirname(file)) === path.join(path.resolve(root), "native-launches");
}
async function ownerLive(file: string, cwd: string) {
  try {
    const owner = json(path.join(path.dirname(file), "owner.json"));
    const id = path.basename(path.dirname(file));
    if (!uuid.test(owner.token) || owner.socket !== `/tmp/rb-native-${id}.sock`
      || fs.realpathSync(owner.cwd) !== cwd) return false;
    return await new Promise<boolean>(resolve => {
      const socket = net.createConnection(owner.socket); let output = "";
      socket.setTimeout(300, () => socket.destroy());
      socket.once("connect", () => socket.end(JSON.stringify({ token: owner.token, op: "status" }) + "\n"));
      socket.on("data", data => { output += data; if (output.length > 1000) socket.destroy(); });
      socket.once("error", () => resolve(false));
      socket.once("close", () => { try { resolve(JSON.parse(output).live === true); } catch { resolve(false); } });
    });
  } catch { return false; }
}

/** ACP conversations may not appear in Cursor's desktop/local transcript store. */
export async function parseNativeCursorSnapshot(file: string, root = configDir()): Promise<ParsedSession> {
  if (!isNativeCursorSnapshot(file, root)) throw Error("Invalid native snapshot path");
  const value = json(file);
  const cwd = fs.realpathSync(path.join(root, "native-worktrees", path.basename(path.dirname(file))));
  if (value.provider !== "cursor" || !uuid.test(value.sessionId) || fs.realpathSync(value.cwd) !== cwd
    || !Array.isArray(value.messages) || value.messages.length > 200) throw Error("Native workspace identity mismatch");
  const messages = value.messages.filter((m: any) => typeof m.text === "string");
  const observed = new Date(value.updatedAt);
  if (!Number.isFinite(observed.getTime())) throw Error("Invalid native observation");
  const live = await ownerLive(file, cwd);
  const state = value.state === "completed" ? "completed" : value.state === "failed" || value.state === "stopped" || !live ? "interrupted" : value.state === "needs_input" ? "waiting" : value.state === "running" ? "active" : "unknown";
  return {
    sessionId: value.sessionId, cwd, startedAt: null, endedAt: observed,
    gitBranch: null, model: typeof value.model === "string" ? value.model : null,
    userPrompts: messages.filter((m: any) => m.role === "user").map((m: any) => m.text),
    finalAssistantText: state === "completed" ? messages.findLast((m: any) => m.role === "assistant")?.text ?? null : null,
    filesTouched: [], toolUseCount: messages.filter((m: any) => m.role === "tool").length,
    malformedLines: 0, state, stateReason: !live && state !== "completed" ? "The native Cursor session stopped." : String(value.message ?? "Observed native Cursor conversation."),
  };
}

export async function nativeCursorRefs(project: ProjectConfig, root: string, limit: number): Promise<TranscriptRef[]> {
  if (project.transcript_sources && !project.transcript_sources.some(s => s.type === "cursor")) return [];
  let entries: string[];
  try { entries = fs.readdirSync(path.join(root, "native-launches")).filter(id => uuid.test(id)); } catch { return []; }
  const candidates = entries.flatMap(id => {
    const file = path.join(root, "native-launches", id, "state.json");
    try { const value = json(file); return value.provider === "cursor" && sharesGitRepository(value.cwd, project.path) ? [{ file, time: fs.statSync(file).mtimeMs }] : []; } catch { return []; }
  }).sort((a, b) => b.time - a.time).slice(0, limit);
  const refs = await Promise.all(candidates.map(async ({ file }): Promise<TranscriptRef[]> => {
    try {
      const session = await parseNativeCursorSnapshot(file, root);
      return [{ source: "cursor", id: session.sessionId!, path: file, state: session.state, stateReason: session.stateReason,
        endedAt: session.endedAt!, ...(session.userPrompts[0] ? { summary: session.userPrompts[0].slice(0, 140) } : {}),
        ...(session.finalAssistantText ? { conclusion: session.finalAssistantText.slice(0, 280) } : {}), toolUseCount: session.toolUseCount }];
    } catch { return []; }
  }));
  return refs.flat();
}
