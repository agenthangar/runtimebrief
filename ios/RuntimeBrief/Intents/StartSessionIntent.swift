import AppIntents
import Foundation

extension AgentProvider: AppEnum {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Coding Agent"
    static let caseDisplayRepresentations: [AgentProvider: DisplayRepresentation] = [
        .claude: "Claude Code", .codex: "Codex", .cursor: "Cursor",
    ]
}

enum SiriSessionPermission: String, AppEnum {
    case manual, auto, acceptEdits, plan, ask, bypassPermissions, dontAsk
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Permissions"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .manual: "Manual", .auto: "Auto", .acceptEdits: "Accept Edits",
        .plan: "Plan", .ask: "Ask", .bypassPermissions: "Bypass", .dontAsk: "Pre-approved Only",
    ]
}

enum SiriReasoningEffort: String, AppEnum {
    case `default`, none, minimal, low, medium, high, xhigh, max, ultra
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Reasoning"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .default: "Native Default", .none: "None", .minimal: "Minimal", .low: "Low",
        .medium: "Medium", .high: "High", .xhigh: "Extra High", .max: "Max", .ultra: "Ultra",
    ]
}

struct SessionModelOptions: DynamicOptionsProvider {
    @IntentParameterDependency<StartSessionIntent>(\.$project, \.$provider)
    var intent

    func results() async throws -> [String] {
        guard let project = intent?.project, let provider = intent?.provider else { return ["default"] }
        let list = try await RuntimeBriefDataSourceFactory.current().sessions(projectID: project.id)
        return ["default"] + (list.providers?.first { $0.id == provider }?.models ?? [])
            .map(\.id).filter { $0 != "default" }
    }
}

struct StartSessionIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Coding Session"
    static let description = IntentDescription(
        "Starts a coding agent session for a project, after confirming the task and session options.",
        categoryName: "Coding Agents"
    )
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @Parameter(title: "Project") var project: ProjectEntity
    @Parameter(title: "Agent", requestValueDialog: "Which coding agent?") var provider: AgentProvider
    @Parameter(title: "Task", requestValueDialog: "What should the agent work on?") var task: String
    @Parameter(title: "Model", default: "default", optionsProvider: SessionModelOptions()) var model: String
    @Parameter(title: "Permissions", default: .manual) var permissions: SiriSessionPermission
    @Parameter(title: "Reasoning", default: .default) var reasoning: SiriReasoningEffort
    @Parameter(title: "Remote Control", default: true) var remoteControl: Bool

    static var parameterSummary: some ParameterSummary {
        Summary("Start \(\.$provider) for \(\.$project): \(\.$task)") {
            \.$model
            \.$permissions
            \.$reasoning
            \.$remoteControl
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        let isDemo = RuntimeBriefModeStore.isDemoEnabled
        let settings = ServerSettings.load()
        let scope = isDemo ? "demo" : (settings.baseURL?.absoluteString ?? "unconfigured")
        let source = RuntimeBriefDataSourceFactory.make(isDemo: isDemo)
        let result = try await SiriSessionLauncher.run(
            project: project, provider: provider, task: task, model: model,
            permissions: permissions, reasoning: reasoning, remoteControl: remoteControl,
            source: source, scope: scope, isDemo: isDemo
        ) { name, prompt in
            let mode = provider.permissionLabel(permissions.rawValue)
            let detail = provider.permissionExplanation(permissions.rawValue)
            let text = "\(isDemo ? "Create a fictional demo" : "Start a") \(provider.label) session for \(name)? Task: \(prompt). Model: \(model). Permissions: \(mode). \(detail) Reasoning: \(reasoning.rawValue). Remote Control: \(remoteControl ? "on" : "off")."
            try await requestConfirmation(result: .result(dialog: IntentDialog(stringLiteral: text)))
            guard RuntimeBriefModeStore.isDemoEnabled == isDemo,
                  isDemo || ServerSettings.load() == settings else {
                throw SiriIntentFailure(message: "Your connection changed. Run the shortcut again to confirm the destination.")
            }
        }
        return .result(value: result.receipt.id, dialog: IntentDialog(stringLiteral: result.text),
                       view: StatusSnippetView(projectName: result.projectName, branch: project.branch, answer: result.text))
    }
}

/// Uses the same durable request identity as the in-app composer. Reads and
/// validation finish before confirmation; only the confirmed task is dispatched.
@MainActor
enum SiriSessionLauncher {
    struct Result {
        let receipt: ClaudeLaunch
        let projectName: String
        let text: String
    }

    static func run(
        project: ProjectEntity, provider: AgentProvider, task: String, model: String = "default",
        permissions: SiriSessionPermission = .manual, reasoning: SiriReasoningEffort = .default,
        remoteControl: Bool = true, source: any RuntimeBriefDataSource,
        scope: String, isDemo: Bool, defaults: UserDefaults = .standard,
        confirm: (String, String) async throws -> Void
    ) async throws -> Result {
        let prompt = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (10...8_000).contains(prompt.utf16.count), !prompt.hasPrefix("/"),
              !prompt.unicodeScalars.contains(where: { (0...8).contains($0.value) || (11...12).contains($0.value) || (14...31).contains($0.value) || $0.value == 127 }) else {
            throw SiriIntentFailure(message: "Describe a task in 10 to 8,000 characters, without slash commands or control characters.")
        }
        // Never use the saved offline project snapshot to authorize a write.
        let current: ProjectSummary
        let capability: AgentCapability
        do {
            guard let match = try await source.projects().first(where: { $0.id == project.id }) else {
                throw RuntimeBriefError.notFound
            }
            current = match
            let list = try await source.sessions(projectID: project.id)
            guard let selected = list.providers?.first(where: { $0.id == provider }) ??
                    (provider == .claude ? AgentCapability(id: .claude, available: list.capability.available, message: list.capability.message) : nil) else {
                throw SiriIntentFailure(message: "Update the daemon on your Mac to enable \(provider.label) sessions.")
            }
            capability = selected
        } catch let error as SiriIntentFailure { throw error }
        catch { throw SiriIntentFailure(message: unreachableMessage(for: error)) }
        guard capability.available else { throw SiriIntentFailure(message: capability.message) }
        let modes = capability.permissionModes ?? provider.modes
        guard modes.contains(permissions.rawValue) else {
            throw SiriIntentFailure(message: "\(provider.label) does not offer those permissions. Choose a supported mode in the app.")
        }
        guard model.range(of: #"^[A-Za-z0-9][A-Za-z0-9._:/\[\],=+\-]{0,255}$"#, options: .regularExpression) != nil,
              model == "default" || capability.models?.contains(where: { $0.id == model }) == true else {
            throw SiriIntentFailure(message: "That model is no longer available. Choose a current model or the native default.")
        }
        if reasoning != .default {
            let selected = model == "default" ? capability.defaultModelLabel : model
            guard capability.models?.first(where: { $0.id == selected })?.reasoningEfforts?.contains(reasoning.rawValue) == true else {
                throw SiriIntentFailure(message: "That model does not offer this reasoning level. Use its native default or choose a supported level.")
            }
        }
        try await confirm(current.name, prompt)
        try Task.checkCancellation()
        let request = SessionLaunchDraft.request(projectID: project.id, scope: scope, prompt: prompt, provider: provider,
                                                model: model, permissionMode: permissions.rawValue, reasoningEffort: reasoning.rawValue,
                                                remoteControl: remoteControl, defaults: defaults)
        let receipt: ClaudeLaunch
        do { receipt = try await source.startSession(projectID: project.id, request: request) }
        catch {
            throw SiriIntentFailure(message: "The launch could not be confirmed. Your task may have started. Retry this same task and settings to reuse its request ID, or open the project and refresh agent tasks before starting another.")
        }
        guard receipt.projectId == project.id, receipt.agent == provider else {
            throw SiriIntentFailure(message: "The launch receipt did not match your task. Refresh agent tasks in the app before starting another.")
        }
        if receipt.state != "unknown" && receipt.launchState != "unknown" {
            SessionLaunchDraft.clear(projectID: project.id, scope: scope, prompt: prompt, provider: provider,
                                     model: model, permissionMode: permissions.rawValue, reasoningEffort: reasoning.rawValue,
                                     remoteControl: remoteControl, defaults: defaults)
        }
        let text = describe(receipt, projectName: current.name, isDemo: isDemo)
        return Result(receipt: receipt, projectName: current.name, text: text)
    }

    static func describe(_ receipt: ClaudeLaunch, projectName: String, isDemo: Bool) -> String {
        let prefix = isDemo ? "Fictional demo. No work was sent to a Mac. " : ""
        let status: String
        if receipt.state == "unknown" || receipt.launchState == "unknown" {
            status = "The launch result is uncertain. Refresh agent tasks in the app before starting another task."
        } else {
            switch receipt.state {
            case "failed": status = "The session could not start. \(receipt.message)"
            case "starting": status = "The session is starting. Task completion is not yet confirmed."
            case "running": status = "The agent is working."
            case "needs_input": status = "The agent needs your input."
            case "completed": status = "The agent's turn is ready to review."
            case "stopped": status = "The session is stopped."
            default: status = "Check the session in the app."
            }
        }
        let remote = receipt.remoteControl.map { receipt.agent == .claude ? $0.label : $0.terminalLabel }
        return "\(prefix)\(receipt.agent.label) for \(projectName). \(status)\(remote.map { " \($0)." } ?? "")"
    }
}
