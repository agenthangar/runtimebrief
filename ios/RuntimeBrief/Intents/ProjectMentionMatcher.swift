import Foundation

/// Finds the projects a spoken question names. Ported from the daemon's
/// `projectMentions.ts`; both run the shared `fixtures/project-mentions.json`.
/// The app uses it for the demo and for daemons without `POST /v1/ask`.
enum ProjectMentionMatcher {
    private static let fillerWords: Set<String> = ["the", "app", "project"]
    private static let maxWindow = 5
    private static let minCompactLength = 3
    private static let wordCharacters = CharacterSet.letters.union(.decimalDigits)

    static func tokens(_ text: String) -> [String] {
        text.lowercased()
            .components(separatedBy: wordCharacters.inverted)
            .filter { !$0.isEmpty }
    }

    /// "The Sample-Tracker App" and "sampletracker" both become "sampletracker".
    static func compactName(_ text: String) -> String {
        let all = tokens(text)
        let meaningful = all.filter { !fillerWords.contains($0) }
        return (meaningful.isEmpty ? all : meaningful).joined()
    }

    /// IDs of the named projects in first-mention order. A longer name wins
    /// over a shorter one it contains ("trail map web" is not "trail map").
    static func resolve(_ question: String, candidates: [(id: String, name: String)]) -> [String] {
        let words = tokens(question)
        var compacts: [(id: String, compact: String)] = []
        for candidate in candidates {
            var seen = Set<String>()
            for compact in [compactName(candidate.name), compactName(candidate.id)]
            where compact.count >= minCompactLength && seen.insert(compact).inserted {
                compacts.append((candidate.id, compact))
            }
        }
        var matches: [(id: String, start: Int, end: Int, length: Int)] = []
        for start in words.indices {
            var window = ""
            for size in 1...maxWindow where start + size <= words.count {
                window += words[start + size - 1]
                for candidate in compacts where candidate.compact == window {
                    matches.append((candidate.id, start, start + size, window.count))
                }
            }
        }
        matches.sort { $0.length != $1.length ? $0.length > $1.length : $0.start < $1.start }
        var accepted: [(id: String, start: Int, end: Int, length: Int)] = []
        for match in matches where !accepted.contains(where: { match.start < $0.end && $0.start < match.end }) {
            accepted.append(match)
        }
        var ids: [String] = []
        for match in accepted.sorted(by: { $0.start < $1.start }) where !ids.contains(match.id) {
            ids.append(match.id)
        }
        return ids
    }
}
