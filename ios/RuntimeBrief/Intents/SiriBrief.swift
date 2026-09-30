import Foundation

struct SiriIntentFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Formatting is shared by voice responses, Shortcuts output, and snippets.
/// Fetching the snapshot never invokes /status or /ask.
enum SiriBrief {
    static func project(_ project: ProjectSummary, snapshot: ProjectsStore.BriefSnapshot) -> String {
        var text = "\(project.name): \(project.brief?.headline ?? "No project brief is available.")"
        let attention = project.brief?.claims.filter { $0.category == .attention } ?? []
        for claim in attention.prefix(2) where claim.text != project.brief?.headline {
            text += " \(claim.text)"
        }
        if let evidenceDate = project.brief?.updatedAt {
            text += " Evidence updated \(dateText(evidenceDate))."
        }
        return prefix(snapshot) + text
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
