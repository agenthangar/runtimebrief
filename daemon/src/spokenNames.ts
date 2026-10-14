import fs from "node:fs";
import path from "node:path";
import { compactName } from "./analyst/projectMentions.js";

/**
 * Other spellings Siri may hear for a project. A folder named "slipspark"
 * whose Xcode project is "SlipSpark" is spoken as "SlipSpark" or "Slip
 * Spark"; Siri recognizes those far better than the lowercase folder name.
 * Only spellings of the same name are added, never a different name.
 */
export function spokenNames(projectPath: string, name: string): string[] {
  const target = compactName(name);
  const names = new Set<string>();
  for (const directory of [projectPath, path.join(projectPath, "ios")]) {
    let entries: string[];
    try {
      entries = fs.readdirSync(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const match = /^(.+)\.(?:xcodeproj|xcworkspace)$/.exec(entry);
      if (!match || compactName(match[1]!) !== target) continue;
      const spelling = match[1]!;
      const words = spelling.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim();
      for (const candidate of [spelling, words]) {
        if (candidate !== name) names.add(candidate);
      }
    }
  }
  return [...names].sort();
}
