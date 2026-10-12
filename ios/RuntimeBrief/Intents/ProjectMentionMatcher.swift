import Foundation

/// Finds the projects a spoken question names. Ported from the daemon's
/// `projectMentions.ts`; both run the shared `fixtures/project-mentions.json`.
/// The app uses it for the demo and for daemons without `POST /v1/ask`.
enum ProjectMentionMatcher {
    private static let fillerWords: Set<String> = ["the", "app", "project"]
    private static let maxWindow = 5
    private static let minCompactLength = 3
    /// Misheard names ("slip park" for SlipSpark) span at most this many words.
    private static let maxFuzzyWindow = 3
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

    /// Edits tolerated in a misheard name: none below six letters, one up to
    /// nine, two from ten. The first letter must match.
    static func allowedMishearing(_ length: Int) -> Int {
        length >= 10 ? 2 : length >= 6 ? 1 : 0
    }

    /// Optimal string alignment distance, or `max + 1` once it exceeds `max`.
    static func editDistance(_ lhs: String, _ rhs: String, max limit: Int) -> Int {
        let a = Array(lhs), b = Array(rhs)
        if abs(a.count - b.count) > limit { return limit + 1 }
        if a.isEmpty || b.isEmpty { return Swift.min(Swift.max(a.count, b.count), limit + 1) }
        var previous2: [Int] = []
        var previous = Array(0...b.count)
        for i in 1...a.count {
            var current = [i]
            var rowMinimum = i
            for j in 1...b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                var value = Swift.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
                if i > 1, j > 1, a[i - 1] == b[j - 2], a[i - 2] == b[j - 1] {
                    value = Swift.min(value, previous2[j - 2] + 1)
                }
                current.append(value)
                rowMinimum = Swift.min(rowMinimum, value)
            }
            if rowMinimum > limit { return limit + 1 }
            previous2 = previous
            previous = current
        }
        return Swift.min(previous[b.count], limit + 1)
    }

    private static let projectMarkers: Set<String> = ["project", "projects"]

    /// Speech recognition often keeps only part of an invented name ("project
    /// park" for SlipSpark). After the word "project", a word of four or more
    /// letters that begins or ends exactly one project's name selects it.
    private static func partialNameAfterProject(
        _ words: [String],
        compacts: [(id: String, compact: String)]
    ) -> (id: String, start: Int, end: Int, length: Int, distance: Int)? {
        for index in words.indices.dropFirst() where projectMarkers.contains(words[index - 1]) {
            let word = words[index]
            guard word.count >= 4, !fillerWords.contains(word) else { continue }
            let ids = Set(compacts.filter {
                $0.compact != word && ($0.compact.hasPrefix(word) || $0.compact.hasSuffix(word))
            }.map(\.id))
            if ids.count == 1, let id = ids.first {
                return (id, index, index + 1, word.count, 2)
            }
        }
        return nil
    }

    /// IDs of the named projects in first-mention order. Names may be split,
    /// joined, pluralized, or slightly misheard ("slip park"). Exact matches
    /// win over misheard ones, and a longer name over a shorter one it
    /// contains ("trail map web" is not "trail map").
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
        typealias Match = (id: String, start: Int, end: Int, length: Int, distance: Int)
        var matches: [Match] = []
        for start in words.indices {
            var window = ""
            for size in 1...maxWindow where start + size <= words.count {
                window += words[start + size - 1]
                // Dictation often pluralizes a name: "slip sparks" for SlipSpark.
                let singular = window.count > minCompactLength && window.hasSuffix("s") ? String(window.dropLast()) : nil
                var exact = false
                for candidate in compacts where candidate.compact == window || candidate.compact == singular {
                    matches.append((candidate.id, start, start + size, candidate.compact.count, 0))
                    exact = true
                }
                if exact || size > maxFuzzyWindow { continue }
                // A misheard name counts only when exactly one project is closest.
                var best = Int.max
                var closest = Set<String>()
                var closestLength = 0
                for candidate in compacts {
                    let allowed = allowedMishearing(candidate.compact.count)
                    guard allowed > 0, candidate.compact.first == window.first else { continue }
                    let distance = editDistance(window, candidate.compact, max: allowed)
                    guard distance <= allowed, distance <= best else { continue }
                    if distance < best {
                        best = distance
                        closest = []
                    }
                    closest.insert(candidate.id)
                    closestLength = candidate.compact.count
                }
                if closest.count == 1, let id = closest.first {
                    matches.append((id, start, start + size, closestLength, best))
                }
            }
        }
        matches.sort {
            if $0.distance != $1.distance { return $0.distance < $1.distance }
            return $0.length != $1.length ? $0.length > $1.length : $0.start < $1.start
        }
        var accepted: [Match] = []
        for match in matches where !accepted.contains(where: { match.start < $0.end && $0.start < match.end }) {
            accepted.append(match)
        }
        if accepted.isEmpty, let partial = partialNameAfterProject(words, compacts: compacts) {
            accepted.append(partial)
        }
        var ids: [String] = []
        for match in accepted.sorted(by: { $0.start < $1.start }) where !ids.contains(match.id) {
            ids.append(match.id)
        }
        return ids
    }
}
