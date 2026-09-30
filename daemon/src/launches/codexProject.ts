import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { withCodexApi } from "./codexApi.js";
import type { ClaudeLaunch } from "./types.js";

interface NativeProject { id: string; roots: { path: string }[] }
interface ProjectList { data: NativeProject[]; nextCursor: string | null }
const canonical = (value: string) => { try { return fs.realpathSync(value); } catch { return path.resolve(value); } };

/** Use native metadata APIs; never edit Codex's database or change a thread's cwd. */
export async function bindCodexProject(binary: string, launch: ClaudeLaunch): Promise<string> {
  const root = canonical(launch.projectRoot ?? launch.cwd);
  return withCodexApi(binary, async request => {
    let project: NativeProject | undefined, cursor: string | null = null;
    do {
      const page: ProjectList = await request("project/list", { limit: 100, cursor });
      const matches = page.data.filter(value => value.roots.some(value => canonical(value.path) === root));
      if (matches.length > 1 || (project && matches.some(value => value.id !== project!.id))) throw Error("Ambiguous native project");
      project ??= matches[0];
      cursor = page.nextCursor;
    } while (cursor);
    if (!project) {
      const hash = createHash("sha256").update(`runtimebrief-project:${root}`).digest("hex");
      const idempotencyKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const result = await request<{ project: NativeProject }>("project/create", { idempotencyKey, name: launch.projectName ?? path.basename(root), roots: [{ path: root }] });
      project = result.project;
    }
    const result = await request<{ thread: { projectId?: string | null; cwd: string } }>("thread/metadata/update", { threadId: launch.sessionId, projectId: project.id });
    if (result.thread.projectId !== project.id || canonical(result.thread.cwd) !== canonical(launch.cwd)) throw Error("Native assignment was not confirmed");
    return project.id;
  });
}
