import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { withCodexApi } from "./codexApi.js";
import type { ClaudeLaunch } from "./types.js";

interface NativeProject { id: string; roots: { path: string }[] }
interface ProjectList { data: NativeProject[]; nextCursor: string | null }
export type CodexRequest = <R>(method: string, params: unknown) => Promise<R>;
const canonical = (value: string) => { try { return fs.realpathSync(value); } catch { return path.resolve(value); } };

/** Use native metadata APIs; never edit Codex's database or change a thread's cwd. */
export async function bindCodexProject(binary: string, launch: ClaudeLaunch): Promise<string> {
  return withCodexApi(binary, async request => {
    const project = await findCodexProject(request, launch.projectRoot ?? launch.cwd, launch.projectName);
    const result = await request<{ thread: { projectId?: string | null; cwd: string } }>("thread/metadata/update", { threadId: launch.sessionId, projectId: project });
    if (result.thread.projectId !== project || canonical(result.thread.cwd) !== canonical(launch.cwd)) throw Error("Native assignment was not confirmed");
    return project;
  });
}

/** Resolve the repository's native metadata before thread/start. Sidebar grouping also needs the selected project cwd. */
export async function findCodexProject(request: CodexRequest, projectRoot: string, name?: string): Promise<string> {
  const root = canonical(projectRoot);
  let project: NativeProject | undefined, cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page: ProjectList = await request("project/list", { limit: 100, cursor });
    const matches = page.data.filter(value => value.roots.some(value => canonical(value.path) === root));
    if (matches.length > 1 || (project && matches.some(value => value.id !== project!.id))) throw Error("Ambiguous native project");
    project ??= matches[0];
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw Error("Invalid project pagination");
    if (cursor) seen.add(cursor);
  } while (cursor);
  if (!project) {
    const hash = createHash("sha256").update(`runtimebrief-project:${root}`).digest("hex");
    const idempotencyKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const result = await request<{ project: NativeProject }>("project/create", { idempotencyKey, name: name ?? path.basename(root), roots: [{ path: root }] });
    project = result.project;
  }
  if (!project.id || !project.roots.some(value => canonical(value.path) === root)) throw Error("Native project was not confirmed");
  return project.id;
}
