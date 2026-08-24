import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeBriefConfig } from "./config.js";
import type { ProjectConfig } from "./types.js";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "project";
}

function normalizedPath(input: string): string {
  return path.resolve(input);
}

function isGitWorkingTreeRoot(candidate: string): boolean {
  try {
    const marker = fs.statSync(path.join(candidate, ".git"));
    return marker.isDirectory() || marker.isFile();
  } catch {
    return false;
  }
}

function uniqueDiscoveredId(base: string, projectPath: string, usedIds: Set<string>): string {
  if (!usedIds.has(base)) return base;
  const suffix = createHash("sha256").update(projectPath).digest("hex").slice(0, 8);
  return `${base}-${suffix}`;
}

/**
 * Merge explicitly configured projects with direct child Git working trees
 * found under user-trusted roots. Explicit projects always win for their path,
 * preserving custom IDs, names, and transcript source overrides.
 *
 * Discovery runs when the registry is read, so a newly-created repository
 * appears without changing config or restarting the daemon.
 */
export function projectsForConfig(config: RuntimeBriefConfig): ProjectConfig[] {
  const projects = [...config.projects];
  const seenPaths = new Set(projects.map((project) => normalizedPath(project.path)));
  const usedIds = new Set(projects.map((project) => project.id));

  for (const configuredRoot of config.project_roots) {
    const root = normalizedPath(configuredRoot);
    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      // Missing or unreadable roots should not take down the daemon.
      continue;
    }

    for (const entry of entries) {
      const projectPath = path.join(root, entry.name);
      const normalized = normalizedPath(projectPath);
      if (seenPaths.has(normalized) || !isGitWorkingTreeRoot(projectPath)) continue;

      const baseId = slugify(entry.name);
      const id = uniqueDiscoveredId(baseId, normalized, usedIds);
      projects.push({ id, name: entry.name, path: normalized, allowed_actions: [] });
      seenPaths.add(normalized);
      usedIds.add(id);
    }
  }

  return projects;
}
