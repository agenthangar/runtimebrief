import AppIntents
import Foundation

struct ProjectEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
    static let defaultQuery = ProjectQuery()

    var id: String
    var name: String
    var branch: String?

    var displayRepresentation: DisplayRepresentation {
        if let branch {
            DisplayRepresentation(title: "\(name)", subtitle: "\(branch)")
        } else {
            DisplayRepresentation(title: "\(name)")
        }
    }

    init(summary: ProjectSummary) {
        self.id = summary.id
        self.name = summary.name
        self.branch = summary.branch
    }

    init(id: String, name: String, branch: String? = nil) {
        self.id = id
        self.name = name
        self.branch = branch
    }
}

/// Resolves projects by name with fuzzy matching, backed by a short-lived
/// cache of /v1/projects so repeated Siri resolutions don't hammer the Mac.
struct ProjectQuery: EntityQuery, EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [ProjectEntity] {
        let projects = try await ProjectsStore.shared.projects()
        return projects
            .filter { identifiers.contains($0.id) }
            .map(ProjectEntity.init(summary:))
    }

    func entities(matching string: String) async throws -> [ProjectEntity] {
        let projects = try await ProjectsStore.shared.projects()
        return ProjectFuzzyMatcher
            .rank(query: string, candidates: projects.map { ($0.id, $0.name) })
            .compactMap { match in
                projects.first { $0.id == match }.map(ProjectEntity.init(summary:))
            }
    }

    func suggestedEntities() async throws -> [ProjectEntity] {
        let projects = try await ProjectsStore.shared.projects()
        return projects.map(ProjectEntity.init(summary:))
    }
}

/// Cached project list shared by entity queries and intents.
actor ProjectsStore {
    static let shared = ProjectsStore()

    private struct PersistedSnapshot: Codable {
        let projects: [ProjectSummary]
        let fetchedAt: Date
    }

    // Preserve the project cache when an existing Backbrief install updates.
    private static let snapshotKey = "backbrief.projects.snapshot.v1"
    private var cached: [ProjectSummary]
    private var fetchedAt: Date?
    private let ttl: TimeInterval = 60

    #if DEBUG
    nonisolated static func resetPersistedSnapshotForUITesting() {
        UserDefaults.standard.removeObject(forKey: snapshotKey)
    }
    #endif

    init() {
        let defaults = UserDefaults.standard
        if let data = defaults.data(forKey: Self.snapshotKey),
           let snapshot = try? JSONDecoder.runtimeBrief.decode(PersistedSnapshot.self, from: data) {
            cached = snapshot.projects
            fetchedAt = snapshot.fetchedAt
        } else {
            cached = []
            fetchedAt = nil
        }
    }

    func projects(dataSource: (any RuntimeBriefDataSource)? = nil) async throws -> [ProjectSummary] {
        if RuntimeBriefModeStore.isDemoEnabled {
            return try await (dataSource ?? DemoRuntimeBriefDataSource()).projects()
        }
        if let fetchedAt, Date().timeIntervalSince(fetchedAt) < ttl, !cached.isEmpty {
            return cached
        }
        do {
            return try await refresh(dataSource: dataSource)
        } catch {
            // Siri and Shortcuts should still resolve project names while the
            // Mac is temporarily offline.
            if !cached.isEmpty { return cached }
            throw error
        }
    }

    func refresh(dataSource: (any RuntimeBriefDataSource)? = nil) async throws -> [ProjectSummary] {
        let isDemo = RuntimeBriefModeStore.isDemoEnabled
        let fresh = try await (dataSource ?? RuntimeBriefDataSourceFactory.current()).projects()
        if isDemo {
            return fresh
        }
        cached = fresh
        fetchedAt = Date()
        persist()
        // Donate the current project names to Siri. Without this, App Shortcuts
        // whose every phrase embeds \(\.$project) are never registered and the
        // spoken project name can't be resolved.
        RuntimeBriefShortcuts.updateAppShortcutParameters()
        return fresh
    }

    func cachedSnapshot() -> (projects: [ProjectSummary], fetchedAt: Date?) {
        if RuntimeBriefModeStore.isDemoEnabled {
            return (DemoData.projects, nil)
        }
        return (cached, fetchedAt)
    }

    func invalidate() {
        fetchedAt = nil
    }

    private func persist() {
        guard let fetchedAt else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(PersistedSnapshot(projects: cached, fetchedAt: fetchedAt)) {
            UserDefaults.standard.set(data, forKey: Self.snapshotKey)
        }
    }
}

/// Pure fuzzy matcher so "sampletracker", "sample tracker app", "the sample tracker app"
/// all resolve to the Sample Tracker App project. Returns candidate ids, best
/// match first. Kept free of AppIntents types for unit testing.
enum ProjectFuzzyMatcher {
    static func rank(query: String, candidates: [(id: String, name: String)]) -> [String] {
        let q = normalize(query)
        guard !q.isEmpty else { return [] }
        let qTokens = Set(tokens(query))
        var scored: [(id: String, score: Int)] = []
        for candidate in candidates {
            let name = normalize(candidate.name)
            let idNorm = normalize(candidate.id)
            let cTokens = Set(tokens(candidate.name)).union(tokens(candidate.id))
            var score = 0
            if name == q || idNorm == q {
                score = 100
            } else if name.hasPrefix(q) || idNorm.hasPrefix(q) {
                score = 80
            } else if name.contains(q) || idNorm.contains(q) || q.contains(name) {
                score = 60
            } else if !qTokens.isEmpty && qTokens.isSubset(of: cTokens) {
                score = 50
            } else {
                let overlap = qTokens.intersection(cTokens).count
                if overlap > 0, overlap * 2 >= qTokens.count {
                    score = 20 + overlap
                }
            }
            if score > 0 { scored.append((candidate.id, score)) }
        }
        return scored.sorted { $0.score > $1.score }.map(\.id)
    }

    /// Lowercase, strip everything but letters and digits. Also drops filler
    /// words so "the sample tracker app" matches "Sample Tracker App".
    static func normalize(_ input: String) -> String {
        tokens(input).joined()
    }

    static func tokens(_ input: String) -> [String] {
        let stopWords: Set<String> = ["the", "a", "an", "app", "project", "my"]
        return input
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty && !stopWords.contains($0) }
    }
}
