import AppIntents
import CoreSpotlight
import Foundation

enum ProjectDiscoverySettings {
    static let key = "runtimebrief.siri.discovery.enabled"
    static var isEnabled: Bool { UserDefaults.standard.object(forKey: key) as? Bool ?? true }
}

protocol ProjectSearchIndex: Sendable {
    func replace(with projects: [ProjectEntity]) async throws
}

struct SpotlightProjectIndex: ProjectSearchIndex {
    func replace(with projects: [ProjectEntity]) async throws {
        let index = CSSearchableIndex(name: "RuntimeBriefProjects")
        // Reconcile the complete small portfolio, including removals and changed
        // server connections. Only this entity type in this app's index is deleted.
        try await index.deleteAppEntities(ofType: ProjectEntity.self)
        if !projects.isEmpty { try await index.indexAppEntities(projects) }
    }
}

/// Serialize Spotlight writes so a slow refresh cannot restore data after
/// entering demo mode, switching Macs, or turning discovery off.
actor ProjectDiscovery {
    static let shared = ProjectDiscovery(index: SpotlightProjectIndex())
    private let index: any ProjectSearchIndex
    private var pending: Task<Void, Never>?

    init(index: any ProjectSearchIndex) { self.index = index }

    func synchronize(projects: [ProjectSummary], enabled: Bool? = nil, isDemo: Bool? = nil) async {
        let previous = pending
        let index = index
        let task = Task {
            await previous?.value
            let canIndex = (enabled ?? ProjectDiscoverySettings.isEnabled)
                && !(isDemo ?? RuntimeBriefModeStore.isDemoEnabled)
            let entities = canIndex ? projects.map(ProjectEntity.init(summary:)) : []
            // Discovery is optional. An unavailable Spotlight index must never
            // prevent loading the portfolio or answering an explicit shortcut.
            try? await index.replace(with: entities)
        }
        pending = task
        await task.value
    }

    static func updateFromSavedProjects() async {
        let snapshot = await ProjectsStore.shared.cachedSnapshot()
        await shared.synchronize(projects: snapshot.projects)
        RuntimeBriefShortcuts.updateAppShortcutParameters()
    }

    @MainActor
    static func donateOpen(_ project: ProjectSummary) async {
        guard isLiveDiscoveryEnabled else { return }
        #if compiler(>=6.4)
        if #available(iOS 27.0, *) {
            _ = try? await OpenProjectWithSiriIntent(target: ProjectEntity(summary: project)).donate()
            return
        }
        #endif
        _ = try? await OpenProjectIntent(target: ProjectEntity(summary: project)).donate()
    }

    static var isLiveDiscoveryEnabled: Bool {
        ProjectDiscoverySettings.isEnabled && !RuntimeBriefModeStore.isDemoEnabled
    }
}
