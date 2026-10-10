import { describe, expect, it } from "vitest";
import { EvidencePresentation } from "../src/models/evidencePresentation";
import type { EvidenceRef } from "../src/models/types";

// Parity with ios/RuntimeBriefTests/EvidencePresentationTests.swift
describe("EvidencePresentation", () => {
  it("removes citation identifiers while keeping readable analysis", () => {
    const text =
      "Done: Improved the gallery. [git-commit-0123456789abcdef0123456789abcdef01234567]\nNow: Review is waiting. [git-working-tree] [session-codex-fictional-id]\nNext: Review the pictures. [session-codex-fictional-id]";
    expect(EvidencePresentation.text(text)).toBe(
      "Done: Improved the gallery.\nNow: Review is waiting.\nNext: Review the pictures.",
    );
  });

  it("removes known evidence IDs and hides commit hashes", () => {
    const ref: EvidenceRef = {
      id: "custom-record",
      kind: "commit",
      label: "Commit a1b2c3d",
      detail: "Demo Developer: Improve review",
      source: "git",
      timestamp: null,
    };
    expect(EvidencePresentation.text("Commit a1b2c3d improved review. [custom-record]", [ref])).toBe(
      "Commit improved review.",
    );
    expect(ref.id).toBe("custom-record");
    expect(ref.label).toBe("Commit a1b2c3d");
  });

  it("preserves ordinary brackets, links, paragraphs and numbers", () => {
    const text =
      "Review [draft] and [instructions](https://example.com/0123456789abcdef0123456789abcdef01234567).\n\nAll 5000000 rows are available.\n    Keep code indentation.";
    expect(EvidencePresentation.text(text)).toBe(text);
  });

  it("hides incomplete streamed citations", () => {
    expect(EvidencePresentation.text("The checks passed. [git-commit-123")).toBe("The checks passed.");
  });

  it("strips the demo evidence citations shown in the fictional portfolio", () => {
    const answer =
      "This fictional project is ready for review. [demo-evidence-commit-001] [demo-evidence-session-001]";
    expect(EvidencePresentation.text(answer)).toBe("This fictional project is ready for review.");
  });

  it("escapes regex metacharacters in evidence identifiers", () => {
    const ref: EvidenceRef = { id: "weird.id+(1)", kind: "session", label: "x", detail: "y", source: null, timestamp: null };
    expect(EvidencePresentation.text("Fine. [weird.id+(1)]", [ref])).toBe("Fine.");
  });
});
