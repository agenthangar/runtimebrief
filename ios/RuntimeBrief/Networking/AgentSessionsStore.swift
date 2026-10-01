import Foundation
import Observation
import CryptoKit

/// Shared account health and project snapshots, scoped to the connected Mac and demo mode.
@MainActor @Observable
final class AgentSessionsStore {
    static let shared = AgentSessionsStore()
    private(set) var providers: [AgentCapability] = []
    private(set) var lists: [String: ClaudeLaunchList] = [:]
    private(set) var savedProjects = Set<String>()
    private(set) var errors: [String: String] = [:]
    private let identityOverride: (() -> String)?
    private let sourceFactory: (TimeInterval) -> any RuntimeBriefDataSource
    private let cacheDirectory: URL?
    private let now: () -> Date
    init(identity: (() -> String)? = nil, source: ((TimeInterval) -> any RuntimeBriefDataSource)? = nil,
         cacheDirectory: URL? = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
         now: @escaping () -> Date = Date.init) {
        identityOverride = identity
        sourceFactory = source ?? { RuntimeBriefDataSourceFactory.current(timeout: $0) }
        self.cacheDirectory = cacheDirectory
        self.now = now
    }
    private var scope = ""
    private var warmingScope: String?
    private var pending = Set<String>()
    private var healthAt: Date?
    private var refreshedAt: [String: Date] = [:]
    private var retryAfter: [String: Date] = [:]
    private var file: URL? {
        guard scope != "demo", scope != "unconfigured" else { return nil }
        return cacheDirectory?.appendingPathComponent("agent-sessions-\(scope).json")
    }
    private func synchronizeScope() {
        let settings = ServerSettings.load()
        let identity = identityOverride?() ?? (RuntimeBriefModeStore.isDemoEnabled ? "demo" : settings.isConfigured ? "\(settings.baseURL!.absoluteString)|\(settings.token!)" : "unconfigured")
        let current = identity == "demo" || identity == "unconfigured" ? identity : SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        guard current != scope else { return }
        scope = current; providers = []; lists = [:]; errors = [:]; healthAt = nil; pending = []; savedProjects = []; refreshedAt = [:]; retryAfter = [:]
        if let file, let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode([String: ClaudeLaunchList].self, from: data) { lists = saved; savedProjects = Set(saved.keys) }
    }
    func connectionScope() -> String { synchronizeScope(); return scope }
    func cached(projectID: String) -> ClaudeLaunchList? { synchronizeScope(); return lists[projectID] }
    func warm(force: Bool = false) async {
        synchronizeScope()
        guard warmingScope != scope, scope != "unconfigured", force || healthAt == nil || Date().timeIntervalSince(healthAt!) > 60 else { return }
        let expected = scope
        warmingScope = expected
        defer { if warmingScope == expected { warmingScope = nil } }
        let source = sourceFactory(6)
        for _ in 0..<8 {
            do {
                let result = try await source.agentProviders()
                guard expected == scope else { return }
                providers = result.providers
                if !providers.contains(where: { $0.checking == true }) { healthAt = Date(); return }
            } catch { return }
            do { try await Task.sleep(for: .seconds(1)) } catch { return }
        }
    }
    func refresh(projectID: String, background: Bool = false) async {
        synchronizeScope()
        guard !pending.contains(projectID) else { return }
        if let retry = retryAfter[projectID], retry > now() { return }
        if background, let refreshed = refreshedAt[projectID], now().timeIntervalSince(refreshed) < 60 { return }
        let expected = scope
        pending.insert(projectID)
        defer { if expected == scope { pending.remove(projectID) } }
        do {
            let result = try await sourceFactory(6).sessions(projectID: projectID)
            guard expected == scope else { return }
            lists[projectID] = result; savedProjects.remove(projectID); errors.removeValue(forKey: projectID)
            refreshedAt[projectID] = now(); retryAfter.removeValue(forKey: projectID)
            if let value = result.providers, !value.contains(where: { $0.message == "Starting tasks is disabled for this project." }) { providers = value }
            if let file, let data = try? JSONEncoder().encode(lists) { try? data.write(to: file, options: [.atomic, .completeFileProtection]) }
        } catch {
            guard expected == scope else { return }
            errors[projectID] = error.localizedDescription
            if error as? RuntimeBriefError == .rateLimited { retryAfter[projectID] = now().addingTimeInterval(60) }
        }
    }
    func prefetch(_ projects: [ProjectSummary]) async {
        synchronizeScope()
        let expected = scope
        // Bound background requests so a large portfolio cannot flood the Mac.
        for offset in stride(from: 0, to: projects.count, by: 4) {
            guard expected == scope else { return }
            await withTaskGroup(of: Void.self) { group in
                for project in projects[offset..<min(offset + 4, projects.count)] { group.addTask { await self.refresh(projectID: project.id, background: true) } }
            }
        }
    }
    func remember(_ launch: ClaudeLaunch, expectedScope: String) {
        synchronizeScope()
        guard expectedScope == scope else { return }
        let existing = lists[launch.projectId]
        let capability = existing?.capability ?? ClaudeLaunchCapability(available: true, message: "Ready")
        lists[launch.projectId] = ClaudeLaunchList(capability: capability, launches: [launch] + (existing?.launches.filter { $0.id != launch.id } ?? []), providers: providers)
    }
}
