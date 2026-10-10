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
        return prefix(snapshot) + "You have \(count) project\(count == 1 ? "" : "s"). \(detail)"
    }

    static func project(_ project: ProjectSummary, snapshot: ProjectsStore.BriefSnapshot) -> String {
        // Two lines: the headline, then its attention reason or evidence time.
        var text = "\(project.name): \(terminated(project.brief?.headline ?? "No project brief is available"))"
        let attention = project.brief?.claims.first { $0.category == .attention && $0.text != project.brief?.headline }
        if let attention {
            text += " \(terminated(attention.text))"
        } else if let evidenceDate = project.brief?.updatedAt {
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
        return "\(project.name), analyzed \(age(of: analyzedAt)): \(voice(answer, evidence: status.evidence))"
    }

    /// An analyst answer as one spoken paragraph: no evidence IDs, and the
    /// status labels read as sentence openings.
    static func spoken(_ answer: String, evidence: [EvidenceRef]) -> String {
        let lines = EvidencePresentation.text(answer, evidence: evidence).split(separator: "\n").map { line in
            String(line)
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: #"^Done:\s*"#, with: "Recently, ", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"^Now:\s*"#, with: "Currently, ", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"^Next:\s*"#, with: "Next, ", options: [.regularExpression, .caseInsensitive])
        }.filter { !$0.isEmpty }
        return lines.map { $0.hasSuffix(".") || $0.hasSuffix("?") || $0.hasSuffix("!") ? $0 : $0 + "." }
            .joined(separator: " ")
    }

    /// The spoken form Siri says: at most `maxLines` short lines, most
    /// important first. A Done/Now/Next analysis keeps its first known lines
    /// in that order; any other answer keeps its first sentences.
    static func voice(_ answer: String, evidence: [EvidenceRef], maxLines: Int = 2) -> String {
        let text = EvidencePresentation.text(answer, evidence: evidence)
        let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let leads = [("done", "Recently, "), ("now", "Currently, "), ("next", "Next, ")]
        var labeled: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let label = line[..<colon].lowercased()
            if leads.contains(where: { $0.0 == label }) {
                labeled[label] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            }
        }
        let chosen: [String]
        if !labeled.isEmpty {
            let known = leads.compactMap { label, lead in
                labeled[label].flatMap { isUnknown($0) ? nil : lead + $0 }
            }
            chosen = known.isEmpty ? ["Unknown from available evidence."] : Array(known.prefix(maxLines))
        } else {
            chosen = Array(sentences(lines.joined(separator: " ")).prefix(maxLines))
        }
        return chosen.map(terminated).joined(separator: " ")
    }

    static func sentences(_ text: String) -> [String] {
        text.replacingOccurrences(of: #"(?<=[.!?])\s+(?=[A-Z0-9"“])"#, with: "\n", options: .regularExpression)
            .split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    private static func isUnknown(_ line: String) -> Bool {
        line.range(of: #"^Unknown from available evidence\.?$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func terminated(_ line: String) -> String {
        line.hasSuffix(".") || line.hasSuffix("?") || line.hasSuffix("!") ? line : line + "."
    }

    static func age(of date: Date, now: Date = Date()) -> String {
        let elapsed = max(0, now.timeIntervalSince(date))
        if elapsed < 60 * 5 { return "just now" }
        if elapsed < 60 * 60 { return "\(Int(elapsed / 60)) minutes ago" }
        if elapsed < 24 * 60 * 60 { return "\(Int(elapsed / 3600)) hours ago" }
        return dateText(date)
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
        guard let first = projects.first else {
            let unavailable = snapshot.projects.filter { $0.brief == nil || $0.brief?.state == .unavailable }
            var text = "No attention items were found in the available briefs."
            if !unavailable.isEmpty {
                text += " \(unavailable.count) project\(unavailable.count == 1 ? " has" : "s have") no available brief."
            }
            return prefix(snapshot) + text
        }
        // Two lines: who needs attention, then the first one's reason.
        let names = projects.prefix(3).map(\.name) + (projects.count > 3 ? ["\(projects.count - 3) more"] : [])
        let reason = terminated(first.brief?.headline ?? "Review this project")
        return prefix(snapshot)
            + "\(projects.count) project\(projects.count == 1 ? " needs" : "s need") attention: \(names.formatted(.list(type: .and)))."
            + " \(first.name): \(reason)"
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
