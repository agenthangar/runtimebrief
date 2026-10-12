import Foundation

/// Words the speech recognizer should expect. Project names are invented
/// words ("slipspark", "Mystico AI") that general dictation mishears, so
/// voice mode primes the recognizer with every spelling of every project.
enum VoiceVocabulary {
    /// Apple recommends keeping contextual strings to about a hundred.
    static let limit = 100

    /// Agent, tool, and release words that come up in questions about projects.
    static let domainTerms = [
        "RuntimeBrief", "Claude", "Claude Code", "Codex", "Cursor", "TestFlight", "App Store",
        "pull request", "PR", "commit", "branch", "worktree", "main", "merge", "build", "tests",
    ]

    static func strings(for projects: [ProjectSummary]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        func add(_ value: String) {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, result.count < limit, seen.insert(trimmed.lowercased()).inserted else { return }
            result.append(trimmed)
        }
        // Names first: when there are many projects, they matter most.
        for project in projects {
            add(project.name)
            for spoken in project.spokenNames ?? [] { add(spoken) }
            add(wordSplit(project.name))
        }
        for term in domainTerms { add(term) }
        return result
    }

    /// "SlipSpark" → "Slip Spark", "meal-planner" → "meal planner".
    static func wordSplit(_ name: String) -> String {
        name.replacingOccurrences(of: #"([a-z0-9])([A-Z])"#, with: "$1 $2", options: .regularExpression)
            .replacingOccurrences(of: #"[-_]+"#, with: " ", options: .regularExpression)
    }
}
