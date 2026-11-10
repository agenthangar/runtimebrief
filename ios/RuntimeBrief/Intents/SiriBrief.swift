import Foundation

struct SiriIntentFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Formatting is shared by voice responses, Shortcuts output, and snippets.
/// Fetching the snapshot never invokes /status or /ask.
enum SiriBrief {
    /// Spoken overview for listening: who needs you, what is ready, what is
    /// running. Project names only, no counts.
    static func overview(_ snapshot: ProjectsStore.BriefSnapshot) -> String {
        guard !snapshot.projects.isEmpty else {
            return prefix(snapshot) + "No projects are registered yet. Add projects on your Mac."
        }
        let attention = attentionProjects(snapshot.projects)
        let attentionIDs = Set(attention.map(\.id))
        let ready = byRecency(snapshot.projects.filter { $0.brief?.state == .recent && !attentionIDs.contains($0.id) })
        let working = byRecency(snapshot.projects.filter { $0.brief?.state == .active && !attentionIDs.contains($0.id) })
        var parts: [String] = []
        if !attention.isEmpty { parts.append("\(names(attention)) \(attention.count == 1 ? "needs" : "need") you.") }
        if !ready.isEmpty { parts.append("\(names(ready)) \(ready.count == 1 ? "has" : "have") work ready to review.") }
        if !working.isEmpty { parts.append("Agents are working on \(names(working)).") }
        if parts.isEmpty { parts.append("All quiet. Nothing needs you right now.") }
        else if attention.isEmpty { parts.append("Nothing needs you right now.") }
        return prefix(snapshot) + parts.joined(separator: " ")
    }

    /// "A", "A and B", or "A, B and others": never a count.
    static func names(_ projects: [ProjectSummary]) -> String {
        let shown = projects.prefix(2).map(\.name)
        if projects.count > 2 { return shown.joined(separator: ", ") + " and others" }
        return shown.joined(separator: " and ")
    }

    private static func byRecency(_ projects: [ProjectSummary]) -> [ProjectSummary] {
        projects.sorted { ($0.brief?.updatedAt ?? $0.lastActivityAt ?? .distantPast) > ($1.brief?.updatedAt ?? $1.lastActivityAt ?? .distantPast) }
    }

    static func project(_ project: ProjectSummary, snapshot: ProjectsStore.BriefSnapshot) -> String {
        // Two lines: the headline, then its attention reason or evidence time.
        var text = "\(project.name): \(terminated(project.brief?.headline ?? "No project brief is available"))"
        let attention = project.brief?.claims.first { $0.category == .attention && $0.text != project.brief?.headline }
        if let attention {
            text += " \(terminated(PresentationMode.text(for: attention)))"
        } else if let evidenceDate = project.brief?.updatedAt {
            text += " Last activity \(age(of: evidenceDate))."
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
        // Say the age only when the analysis is old enough to matter.
        let stale = Date().timeIntervalSince(analyzedAt) > 12 * 3600 ? " This is from \(age(of: analyzedAt))." : ""
        return "\(project.name): \(voice(answer, evidence: status.evidence))\(stale)"
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
        // What is happening now matters most when listening, then what finished.
        let leads = [("now", "Right now, "), ("done", "Recently, "), ("next", "Next, ")]
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
                labeled[label].flatMap { isUnknown($0) ? nil : lead + continuing($0) }
            }
            chosen = known.isEmpty ? ["Unknown from available evidence."] : Array(known.prefix(maxLines))
        } else {
            chosen = Array(sentences(lines.joined(separator: " ")).prefix(maxLines))
        }
        return chosen.map { terminated(plain($0)) }.joined(separator: " ")
    }

    /// Drops what is hard to follow by ear: commit hashes, issue and pull
    /// request numbers, file paths and asides in parentheses.
    static func plain(_ line: String) -> String {
        var text = line
        let patterns = [
            #"\s*\([^()]*\)"#,                                  // asides
            #"`[^`]*`"#,                                          // code spans
            #"\b[\w.-]+(?:/[\w.-]+){2,}\b"#,                      // paths
            #"\b[\w-]+\.(?:swift|ts|tsx|json|yml|yaml|kt|py|plist|xcstrings)\b"#, // file names
            #"\s*(?:\b(?:PR|pull request|issue)\s*)?#\d+\b"#,          // #123
            #"\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b"#, // hashes
        ]
        for pattern in patterns {
            text = text.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
        }
        text = text.replacingOccurrences(of: #"\s+\b(?:in|to|for|at|of|from|on)\s*([.!?])$"#, with: "$1", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+([.,;:!?])"#, with: "$1", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespaces)
    }

    static func sentences(_ text: String) -> [String] {
        text.replacingOccurrences(of: #"(?<=[.!?])\s+(?=[A-Z0-9"“])"#, with: "\n", options: .regularExpression)
            .split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// "Recently, the latest session…": a sentence opener that follows the
    /// spoken lead is lowercased; names and acronyms keep their case.
    private static let continuingOpeners: Set<String> = [
        "A", "All", "An", "Both", "Each", "It", "Its", "Most", "No", "Nothing",
        "Several", "Some", "That", "The", "There", "These", "This", "Those",
    ]

    private static func continuing(_ text: String) -> String {
        guard let first = text.split(separator: " ").first, continuingOpeners.contains(String(first)) else { return text }
        return text.prefix(1).lowercased() + text.dropFirst()
    }

    private static func isUnknown(_ line: String) -> Bool {
        line.range(of: #"^Unknown from available evidence\.?$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func terminated(_ line: String) -> String {
        line.hasSuffix(".") || line.hasSuffix("?") || line.hasSuffix("!") ? line : line + "."
    }

    static func age(of date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let elapsed = max(0, now.timeIntervalSince(date))
        if elapsed < 60 * 10 { return "just now" }
        if elapsed < 60 * 60 { return "in the last hour" }
        if elapsed < 2 * 60 * 60 { return "an hour ago" }
        if calendar.isDate(date, inSameDayAs: now) { return "earlier today" }
        if calendar.isDateInYesterday(date) { return "yesterday" }
        if elapsed < 7 * 24 * 3600 { return "this week" }
        return "a while ago"
    }

    /// Which projects had completed agent work since `since`, newest first,
    /// in two lines: the project names, then the latest completed item.
    static func digest(_ snapshot: ProjectsStore.BriefSnapshot, since: Date, period: String) -> String {
        let done = snapshot.projects.flatMap { project in
            (project.brief?.claims ?? []).filter { $0.category == .completed }.compactMap { claim -> (ProjectSummary, BriefClaim, Date)? in
                guard let at = claim.evidence.compactMap(\.timestamp).max(), at >= since else { return nil }
                return (project, claim, at)
            }
        }.sorted { $0.2 > $1.2 }
        guard let latest = done.first else {
            return prefix(snapshot) + "No completed agent work is recorded \(period)."
        }
        var names: [String] = []
        for (project, _, _) in done where !names.contains(project.name) { names.append(project.name) }
        let item = PresentationMode.text(for: latest.1)
        return prefix(snapshot)
            + "Agents finished work \(period) on \(spokenList(names))."
            + " Latest, \(latest.0.name): \(terminated(plain(item)))"
    }

    private static func spokenList(_ names: [String]) -> String {
        if names.count > 3 { return names.prefix(3).joined(separator: ", ") + " and others" }
        return names.formatted(.list(type: .and))
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
            var text = "Nothing needs your attention."
            if !unavailable.isEmpty {
                text += " \(names(unavailable)) \(unavailable.count == 1 ? "has" : "have") no brief yet."
            }
            return prefix(snapshot) + text
        }
        // Two lines: who needs attention, then the first one's reason.
        let reason = terminated(plain(first.brief?.headline ?? "Review this project"))
        return prefix(snapshot)
            + "\(spokenList(projects.map(\.name))) \(projects.count == 1 ? "needs" : "need") you."
            + " \(first.name): \(reason)"
    }

    static func prefix(_ snapshot: ProjectsStore.BriefSnapshot) -> String {
        if snapshot.isDemo { return "Fictional demo. " }
        if snapshot.isSaved {
            let saved = snapshot.fetchedAt.map { " from \(age(of: $0))" } ?? ""
            return "Your Mac is unreachable. Using saved briefs\(saved). "
        }
        return ""
    }
}
