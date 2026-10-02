import AppIntents
import Foundation
import CoreSpotlight

struct ProjectEntity: AppEntity, IndexedEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
    static let defaultQuery = ProjectQuery()

    var id: String
    @Property(title: "Name") var name: String
    @Property(title: "Branch") var branch: String?
    @Property(title: "Brief") var headline: String
    @Property(title: "State") var state: String
    @Property(title: "Evidence Updated") var updatedAt: Date?

    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = defaultAttributeSet
        attributes.title = name
        attributes.contentDescription = headline
        attributes.keywords = [name, state, "project", "RuntimeBrief"] + [branch].compactMap { $0 }
        attributes.contentModificationDate = updatedAt
        return attributes
    }

    var displayRepresentation: DisplayRepresentation {
        // Siri's phrase expansion uses display names, rather than the string
        // query's normalization. Register common spoken forms of the name.
        let synonyms: [LocalizedStringResource] = ["\(name) app", "\(name) project", "the \(name) app"]
        if let branch {
            return DisplayRepresentation(title: "\(name)", subtitle: "\(branch)", synonyms: synonyms)
        } else {
            return DisplayRepresentation(title: "\(name)", synonyms: synonyms)
        }
    }

    init(summary: ProjectSummary) {
        self.id = summary.id
        self.name = summary.name
        self.branch = summary.branch
        self.headline = summary.brief?.headline ?? "No project brief available."
        self.state = summary.brief?.state.rawValue ?? "unavailable"
        self.updatedAt = summary.brief?.updatedAt ?? summary.lastActivityAt
    }

    init(id: String, name: String, branch: String? = nil) {
        self.id = id
        self.name = name
        self.branch = branch
        self.headline = "No project brief available."
        self.state = "unavailable"
        self.updatedAt = nil
    }
}

#if compiler(>=6.4)
@available(iOS 27.0, *)
extension ProjectQuery: IndexedEntityQuery {
    func reindexEntities(for identifiers: [String], indexDescription: CSSearchableIndexDescription) async throws {
        // A full reconciliation also removes projects that no longer exist.
        try await reindexAllEntities(indexDescription: indexDescription)
    }

    func reindexAllEntities(indexDescription: CSSearchableIndexDescription) async throws {
        guard ProjectDiscovery.isLiveDiscoveryEnabled else {
            await ProjectDiscovery.shared.synchronize(projects: [])
            return
        }
        let projects = try await ProjectsStore.shared.projects()
        await ProjectDiscovery.shared.synchronize(projects: projects)
    }
}
#endif

/// Resolves projects by name with fuzzy matching, backed by a short-lived
/// cache of /v1/projects so repeated Siri resolutions don't hammer the Mac.
struct ProjectQuery: EntityStringQuery, EnumerableEntityQuery {
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
        // Shortcuts also uses this query for its explicit project chooser.
        // Discovery opt-out controls indexing and donations, not that chooser.
        do {
            return try await allEntities()
        } catch is RuntimeBriefError {
            // A failed background vocabulary refresh otherwise aborts the
            // registration of every shortcut, including parameter-free reads.
            // Publish no names when setup/auth/network fails; explicit queries
            // and intent execution still report the connection error.
            return []
        }
    }

    func allEntities() async throws -> [ProjectEntity] {
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
    private let defaults: UserDefaults
    private let discovery: ProjectDiscovery?
    private var revision = 0

    struct BriefSnapshot: Sendable {
        let projects: [ProjectSummary]
        let fetchedAt: Date?
        let isSaved: Bool
        let isDemo: Bool
    }

    /// Quick Siri reads use deterministic briefs and never start an analyst.
    /// A failed connection may use the saved brief, explicitly labelled as such.
    func briefSnapshot(dataSource: (any RuntimeBriefDataSource)? = nil) async throws -> BriefSnapshot {
        if RuntimeBriefModeStore.isDemoEnabled {
            return BriefSnapshot(projects: try await (dataSource ?? DemoRuntimeBriefDataSource()).projects(),
                                 fetchedAt: nil, isSaved: false, isDemo: true)
        }
        do {
            let projects = try await refresh(dataSource: dataSource ?? RuntimeBriefDataSourceFactory.current(timeout: 5))
            return BriefSnapshot(projects: projects, fetchedAt: fetchedAt, isSaved: false, isDemo: false)
        } catch {
            // Configuration/auth failures must not reveal a previous connection's data.
            switch error {
            case RuntimeBriefError.network, RuntimeBriefError.timeout: break
            default: throw error
            }
            guard !cached.isEmpty else { throw error }
            return BriefSnapshot(projects: cached, fetchedAt: fetchedAt, isSaved: true, isDemo: false)
        }
    }

    #if DEBUG
    nonisolated static func resetPersistedSnapshotForUITesting() {
        UserDefaults.standard.removeObject(forKey: snapshotKey)
    }
    #endif

    init(defaults: UserDefaults = .standard, discovery: ProjectDiscovery? = .shared) {
        self.defaults = defaults
        self.discovery = discovery
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
            return try await refresh(dataSource: dataSource ?? RuntimeBriefDataSourceFactory.current(timeout: 5))
        } catch {
            // Siri and Shortcuts should still resolve project names while the
            // Mac is temporarily offline.
            switch error {
            case RuntimeBriefError.network, RuntimeBriefError.timeout: break
            default: throw error
            }
            if !cached.isEmpty { return cached }
            throw error
        }
    }

    func refresh(dataSource: (any RuntimeBriefDataSource)? = nil) async throws -> [ProjectSummary] {
        let isDemo = RuntimeBriefModeStore.isDemoEnabled
        let startingRevision = revision
        let fresh = try await (dataSource ?? RuntimeBriefDataSourceFactory.current()).projects()
        guard startingRevision == revision, isDemo == RuntimeBriefModeStore.isDemoEnabled else {
            throw CancellationError()
        }
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
        await discovery?.schedule(projects: fresh) {
            await self.isCurrent(revision: startingRevision, isDemo: isDemo)
        }
        guard startingRevision == revision, isDemo == RuntimeBriefModeStore.isDemoEnabled else {
            throw CancellationError()
        }
        return fresh
    }

    private func isCurrent(revision: Int, isDemo: Bool) -> Bool {
        revision == self.revision && isDemo == RuntimeBriefModeStore.isDemoEnabled
    }

    func cachedSnapshot() -> (projects: [ProjectSummary], fetchedAt: Date?) {
        if RuntimeBriefModeStore.isDemoEnabled {
            return (DemoData.projects, nil)
        }
        return (cached, fetchedAt)
    }

    func invalidate() {
        revision += 1
        fetchedAt = nil
    }

    func clear() async {
        revision += 1
        cached = []
        fetchedAt = nil
        defaults.removeObject(forKey: Self.snapshotKey)
        await discovery?.synchronize(projects: [])
        RuntimeBriefShortcuts.updateAppShortcutParameters()
    }

    private func persist() {
        guard let fetchedAt else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(PersistedSnapshot(projects: cached, fetchedAt: fetchedAt)) {
            defaults.set(data, forKey: Self.snapshotKey)
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
            let overlap = qTokens.intersection(cTokens).count
            var score = 0
            if name == q || idNorm == q {
                score = 100
            } else if name.hasPrefix(q) || idNorm.hasPrefix(q) {
                score = 80
            } else if name.contains(q) || idNorm.contains(q) {
                score = 60
            } else if q.contains(name) || q.contains(idNorm) {
                // Siri sometimes includes the app name in the entity text:
                // "Meal Planner from RuntimeBrief" must prefer Meal Planner
                // over the RuntimeBrief project even if both names occur.
                score = 60 + min(overlap, 4) * 5
            } else if !qTokens.isEmpty && qTokens.isSubset(of: cTokens) {
                score = 50
            } else {
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
        let stopWords: Set<String> = ["the", "a", "an", "app", "project", "my", "from", "in", "using"]
        return input
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty && !stopWords.contains($0) }
    }
}
