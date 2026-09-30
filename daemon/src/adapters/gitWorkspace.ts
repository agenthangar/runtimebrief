import fs from "node:fs";
import path from "node:path";

/** Linked worktrees share Git metadata even when they live outside the project. */
export function gitCommonDirectory(directory: string): string | null {
  try {
    let gitdir = path.join(directory, ".git");
    if (!fs.statSync(gitdir).isDirectory()) {
      const match = /^gitdir: (.+)$/.exec(fs.readFileSync(gitdir, "utf8").trim());
      if (!match) return null;
      gitdir = path.resolve(directory, match[1]!);
    }
    const common = path.join(gitdir, "commondir");
    return fs.realpathSync(
      fs.existsSync(common)
        ? path.resolve(gitdir, fs.readFileSync(common, "utf8").trim())
        : gitdir,
    );
  } catch {
    return null;
  }
}

/** Require both folders to be Git roots, so monorepo subprojects stay separate. */
export function sharesGitRepository(workspace: string | null, project: string): boolean {
  if (!workspace) return false;
  const projectGit = gitCommonDirectory(project);
  return projectGit !== null && gitCommonDirectory(workspace) === projectGit;
}
