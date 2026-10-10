import type { EvidenceRef } from "./types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Keep source identifiers in the data; present readable text without
 * technical source records. Mirrors `EvidencePresentation.text` on iOS.
 */
export const EvidencePresentation = {
  text(value: string, evidence: EvidenceRef[] = []): string {
    let result = value;
    for (const item of evidence) {
      result = result.replace(new RegExp("\\[" + escapeRegExp(item.id) + "\\](?!\\()", "g"), "");
    }
    // Cached answers can cite records beyond the returned sources.
    // Preserve ordinary bracketed text and Markdown links.
    result = result.replace(
      /\[(?:git-|session-|demo-evidence-|project-scan-|xcode-|testflight-|app-store-)[^[\]]+\](?!\()/g,
      "",
    );
    result = result.replace(
      /\[(?:git-|session-|demo-evidence-|project-scan-|xcode-|testflight-|app-store-)[^[\]]*$/g,
      "",
    );
    result = result.replace(/\b([Cc]ommit|[Rr]evision)\s+[0-9a-fA-F]{7,64}\b/g, "$1");
    result = result.replace(/(?<![\w/.-])[0-9a-fA-F]{40,64}(?![\w/.-])/g, "");
    return result
      .split("\n")
      .map((line) => line.replace(/(?<=\S)[ \t]{2,}/g, " ").replace(/[ \t]+$/g, ""))
      .join("\n")
      .trim();
  },
};
