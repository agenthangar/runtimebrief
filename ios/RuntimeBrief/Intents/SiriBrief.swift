import Foundation

struct SiriIntentFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Formatting is shared by voice responses, Shortcuts output, and snippets.
/// Fetching the snapshot never invokes /status or /ask.
enum SiriBrief {
    static func overview(_ snapshot: ProjectsStore.BriefSnapshot) -> String {
        guard !snapshot.projects.isEmpty else {
            return prefix(snapshot) + "No projects are registered yet. Add projects on your Mac."
        }
        let count = snapshot.projects.count
        let needsAttention = attentionProjects(snapshot.projects)
        let urgent = needsAttention.prefix(2).map(\.name).joined(separator: " and ")
        let detail = needsAttention.isEmpty ? "Nothing is marked as needing your attention." :
            "\(needsAttention.count) need your attention, including \(urgent)."
        return prefix(snapshot) + "You have \(count) project\(count == 1 ? "" : "s"). \(detail) Ask for a project by name for its latest analysis."
    }

    static func project(_ project: ProjectSummary, snapshot: ProjectsStore.BriefSnapshot) -> String {
        var text = "\(project.name): \(project.brief?.headline ?? "No project brief is available.")"
        let attention = project.brief?.claims.filter { $0.category == .attention } ?? []
        for claim in attention.prefix(2) where claim.text != project.brief?.headline {
            text += " \(claim.text)"
        }
        if let evidenceDate = project.brief?.updatedAt {
            text += " Last activity \(dateText(evidenceDate))."
        }
        return prefix(snapshot) + text
    }

    static func analyzedProject(_ project: ProjectSummary, status: VoiceStatus) -> String {
        guard let answer = status.answer, !answer.isEmpty, let analyzedAt = status.analyzedAt else {
            let headline = project.brief?.headline ?? "No current brief is available."
            if status.unavailable {
                return "I couldn't finish an analysis for \(project.name) right now. The current brief says: \(headline)"
            }
            return "I'm preparing an analysis for \(project.name). The current brief says: \(headline) Ask me again shortly."
        }
        let lines = EvidencePresentation.text(answer, evidence: status.evidence).split(separator: "\n").map { line in
            String(line)
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: #"^Done:\s*"#, with: "Recently, ", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"^Now:\s*"#, with: "Currently, ", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"^Next:\s*"#, with: "Next, ", options: [.regularExpression, .caseInsensitive])
        }.filter { !$0.isEmpty }
        let spoken = lines.map { $0.hasSuffix(".") ? $0 : $0 + "." }.joined(separator: " ")
        let elapsed = max(0, Date().timeIntervalSince(analyzedAt))
        let age: String
        if elapsed < 60 * 5 { age = "just now" }
        else if elapsed < 60 * 60 { age = "\(Int(elapsed / 60)) minutes ago" }
        else if elapsed < 24 * 60 * 60 { age = "\(Int(elapsed / 3600)) hours ago" }
        else { age = dateText(analyzedAt) }
        let refreshNote: String
        if status.unavailable { refreshNote = " I couldn't refresh it right now." }
        else if status.refreshing { refreshNote = " I'm refreshing the analysis now." }
        else { refreshNote = "" }
        return "\(project.name), analyzed \(age). \(spoken)\(refreshNote)"
    }

    static func attentionProjects(_ projects: [ProjectSummary]) -> [ProjectSummary] {
        projects.filter { $0.brief?.state == .attention || $0.brief?.claims.contains(where: { $0.category == .attention }) == true }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    static func attention(_ snapshot: ProjectsStore.BriefSnapshot) -> String {
        guard !snapshot.projects.isEmpty else {
            return prefix(snapshot) + "No projects are registered yet. Add projects on your Mac."
        }
        let projects = attentionProjects(snapshot.projects)
        let unavailable = snapshot.projects.filter { $0.brief == nil || $0.brief?.state == .unavailable }
        var text = projects.isEmpty ? "No attention items were found in the available briefs." :
            "\(projects.count) project\(projects.count == 1 ? " needs" : "s need") attention. "
                + projects.prefix(5).map { "\($0.name): \($0.brief?.headline ?? "Review this project.")" }.joined(separator: " ")
        if projects.count > 5 { text += " Open RuntimeBrief for the remaining \(projects.count - 5)." }
        if !unavailable.isEmpty {
            text += " \(unavailable.count) project\(unavailable.count == 1 ? " has" : "s have") no available brief."
        }
        return prefix(snapshot) + text
    }

    static func prefix(_ snapshot: ProjectsStore.BriefSnapshot) -> String {
        if snapshot.isDemo { return "Fictional demo. " }
        if snapshot.isSaved {
            let saved = snapshot.fetchedAt.map { " from \(dateText($0))" } ?? ""
            return "Your Mac is unreachable. Using saved briefs\(saved). "
        }
        return ""
    }

    private static func dateText(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }
}
