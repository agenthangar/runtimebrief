import Foundation
import Testing
@testable import RuntimeBrief

struct EvidencePresentationTests {
    @Test func removesCitationIdentifiersWhileKeepingReadableAnalysis() {
        let text = "Done: Improved the gallery. [git-commit-0123456789abcdef0123456789abcdef01234567]\nNow: Review is waiting. [git-working-tree] [session-codex-fictional-id]\nNext: Review the pictures. [session-codex-fictional-id]"
        #expect(EvidencePresentation.text(text) == "Done: Improved the gallery.\nNow: Review is waiting.\nNext: Review the pictures.")
    }

    @Test func removesKnownEvidenceIDsAndHidesCommitHashes() {
        let ref = EvidenceRef(id: "custom-record", kind: .commit, label: "Commit a1b2c3d", detail: "Demo Developer: Improve review", source: "git", timestamp: nil)
        #expect(EvidencePresentation.text("Commit a1b2c3d improved review. [custom-record]", evidence: [ref]) == "Commit improved review.")
        #expect(ref.id == "custom-record")
        #expect(ref.label == "Commit a1b2c3d")
    }

    @Test func preservesOrdinaryBracketsLinksParagraphsAndNumbers() {
        let text = "Review [draft] and [instructions](https://example.com/0123456789abcdef0123456789abcdef01234567).\n\nAll 5000000 rows are available.\n    Keep code indentation."
        #expect(EvidencePresentation.text(text) == text)
    }

    @Test func hidesIncompleteStreamedCitations() {
        #expect(EvidencePresentation.text("The checks passed. [git-commit-123") == "The checks passed.")
    }
}
