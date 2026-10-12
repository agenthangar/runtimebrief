import Foundation

/// For demos and screen sharing: hide the person's prompts and agent
/// messages that briefs quote, keeping native session titles, states, and counts.
enum PresentationMode {
    static let key = "runtimebrief.presentation-mode.v1"

    static var isEnabled: Bool { UserDefaults.standard.bool(forKey: key) }

    /// A claim keeps a quoted native session title, such as “Siri
    /// integration”; a quoted request in the person's words is removed.
    static func text(for claim: BriefClaim, enabled: Bool = isEnabled) -> String {
        let plain = EvidencePresentation.text(claim.text, evidence: claim.evidence)
        return claim.subject?.source == "title" ? plain : text(plain, enabled: enabled)
    }

    /// Session cards show only native titles while presenting.
    static func showsSessionSummary(source: String?, enabled: Bool = isEnabled) -> Bool {
        !enabled || source == "title"
    }

    /// "Codex completed “Fix the login crash”." → "Codex completed."
    static func text(_ value: String, enabled: Bool = isEnabled) -> String {
        guard enabled else { return value }
        return value
            .replacingOccurrences(of: #"\s+(?:on\s+)?“[^”]*”"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+([.!?])"#, with: "$1", options: .regularExpression)
    }
}
