import AppIntents
import Observation

@MainActor @Observable
final class ProjectNavigation {
    static let shared = ProjectNavigation()
    var path: [ProjectSummary] = []
    private var intentOpenedProjectID: String?

    func open(_ project: ProjectSummary) {
        intentOpenedProjectID = project.id
        path = [project]
    }

    func consumeIntentNavigation(for projectID: String) -> Bool {
        let fromIntent = intentOpenedProjectID == projectID
        intentOpenedProjectID = nil
        return fromIntent
    }
}

struct OpenProjectIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Project"
    static let description = IntentDescription("Opens a project and its evidence-backed brief in RuntimeBrief.")
    static let openAppWhenRun = true

    @Parameter(title: "Project") var target: ProjectEntity

    init() {}
    init(target: ProjectEntity) { self.target = target }

    static var parameterSummary: some ParameterSummary { Summary("Open \(\.$target)") }

    @MainActor
    func perform() async throws -> some IntentResult {
        try await openProject(target)
        return .result()
    }
}

/// iOS 26 keeps its custom opening action; iOS 27 additionally exposes the
/// system's schema for conversational content access.
#if compiler(>=6.4)
@available(iOS 27.0, *)
@AppIntent(schema: .system.open)
struct OpenProjectWithSiriIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open Project with Siri"
    var target: ProjectEntity

    init() {}
    init(target: ProjectEntity) { self.target = target }

    @MainActor
    func perform() async throws -> some IntentResult {
        try await openProject(target)
        return .result()
    }
}
#endif

@MainActor
private func openProject(_ entity: ProjectEntity) async throws {
    // Resolve by stable ID instead of navigating to stale donated content.
    let projects = try await ProjectsStore.shared.projects()
    guard let project = projects.first(where: { $0.id == entity.id }) else {
        throw SiriIntentFailure(message: unreachableMessage(for: RuntimeBriefError.notFound))
    }
    ProjectNavigation.shared.open(project)
}
