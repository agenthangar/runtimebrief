import AppIntents

/// Named-agent shortcuts expose only the project and task. Each has a unique
/// intent identity and uses the shared launch flow for validation, confirmation
/// and retry handling. Advanced options remain in Start Coding Session.
struct StartClaudeSessionIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Claude Agent"
    static let description = IntentDescription("Starts Claude Code for a project after confirming the task.", categoryName: "Coding Agents")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Project", requestValueDialog: "Which project should Claude work on?") var project: ProjectEntity
    @Parameter(title: "Task", requestValueDialog: "What should Claude work on?") var task: String

    static var parameterSummary: some ParameterSummary {
        Summary("Start Claude Code for \(\.$project): \(\.$task)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        var intent = StartSessionIntent(provider: .claude)
        intent.project = project
        intent.task = task
        return try await intent.perform()
    }
}

struct StartCodexSessionIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Codex Agent"
    static let description = IntentDescription("Starts Codex for a project after confirming the task.", categoryName: "Coding Agents")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Project", requestValueDialog: "Which project should Codex work on?") var project: ProjectEntity
    @Parameter(title: "Task", requestValueDialog: "What should Codex work on?") var task: String

    static var parameterSummary: some ParameterSummary {
        Summary("Start Codex for \(\.$project): \(\.$task)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        var intent = StartSessionIntent(provider: .codex)
        intent.project = project
        intent.task = task
        return try await intent.perform()
    }
}

struct StartCursorSessionIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Cursor Agent"
    static let description = IntentDescription("Starts Cursor for a project after confirming the task.", categoryName: "Coding Agents")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Project", requestValueDialog: "Which project should Cursor work on?") var project: ProjectEntity
    @Parameter(title: "Task", requestValueDialog: "What should Cursor work on?") var task: String

    static var parameterSummary: some ParameterSummary {
        Summary("Start Cursor for \(\.$project): \(\.$task)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        var intent = StartSessionIntent(provider: .cursor)
        intent.project = project
        intent.task = task
        return try await intent.perform()
    }
}
