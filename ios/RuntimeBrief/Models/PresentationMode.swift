import Foundation

/// For demos and screen sharing: hide the people's prompts, session titles,
/// and agent messages that briefs quote, keeping the states and counts.
enum PresentationMode {
    static let key = "runtimebrief.presentation-mode.v1"

    static var isEnabled: Bool { UserDefaults.standard.bool(forKey: key) }

    /// "Codex completed “Fix the login crash”." → "Codex completed."
    static func text(_ value: String, enabled: Bool = isEnabled) -> String {
        guard enabled else { return value }
        return value
            .replacingOccurrences(of: #"\s+(?:on\s+)?“[^”]*”"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+([.!?])"#, with: "$1", options: .regularExpression)
    }
}
