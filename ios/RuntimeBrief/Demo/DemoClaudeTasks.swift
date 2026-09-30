import Foundation

/// Fictional in-memory interaction. This actor never creates a client or opens an app.
actor DemoClaudeTasks {
    static let shared = DemoClaudeTasks()
    private var tasks: [ClaudeLaunch] = []
    private var screens: [String: String] = [:]
    private var inputs: Set<String> = []

    func list(projectID: String) -> ClaudeLaunchList {
        ClaudeLaunchList(
            capability: ClaudeLaunchCapability(available: true, message: "Try a fictional Claude task. Demo mode never sends work to a Mac."),
            launches: tasks.filter { $0.projectId == projectID },
            providers: AgentProvider.allCases.map { AgentCapability(id: $0, available: true, message: "Try a fictional \($0.label) task. Demo mode never sends work to a Mac.") }
        )
    }

    func start(projectID: String, requestID: String, model: ClaudeModel, permissionMode: ClaudePermissionMode, remoteControl: Bool = true) -> ClaudeLaunch {
        if let existing = tasks.first(where: { $0.id == requestID && $0.projectId == projectID }) { return existing }
        let launch = ClaudeLaunch(
            id: requestID, projectId: projectID, name: "Demo Claude task", createdAt: Date(),
            state: "completed", message: "Demo task ready to review. No work was sent to a Mac.",
            nativeId: "demo-task", sessionId: nil, cwd: "/demo/sample-tracker", openedAt: nil,
            model: model.rawValue, permissionMode: permissionMode.rawValue,
            backend: "t-legacy", requestedRemoteControl: remoteControl,
            remoteControl: ClaudeRemoteControl(state: remoteControl ? "ready" : "disabled", url: nil)
        )
        tasks.insert(launch, at: 0)
        return launch
    }

    func start(projectID: String, request: SessionLaunchRequest) -> ClaudeLaunch {
        if let existing = tasks.first(where: { $0.id == request.requestId && $0.projectId == projectID }) { return existing }
        var launch = start(projectID: projectID, requestID: request.requestId, model: .default, permissionMode: .manual, remoteControl: request.remoteControl)
        launch.provider = request.provider
        launch.model = request.model
        launch.permissionMode = request.permissionMode
        launch.backend = request.provider == .claude ? "t-legacy" : "t-\(request.provider.rawValue)"
        tasks[0] = launch
        screens[launch.id] = "Demo \(request.provider.label) terminal\r\n\r\nFictional conversation. No Mac is connected.\r\n\r\n> "
        return launch
    }

    func terminal(projectID: String, launchID: String) throws -> TerminalSnapshot {
        guard let launch = tasks.first(where: { $0.id == launchID && $0.projectId == projectID }), launch.agent != .claude, launch.requestedRemoteControl != false else { throw RuntimeBriefError.notFound }
        return TerminalSnapshot(screen: "\u{1b}[2J\u{1b}[H" + (screens[launchID] ?? "Demo terminal"), cols: 60, rows: 24, writable: true, message: "Demo only. No keys are sent to a Mac.")
    }

    func input(projectID: String, launchID: String, input: TerminalInput) throws -> TerminalInputResult {
        _ = try terminal(projectID: projectID, launchID: launchID)
        let key = launchID + input.requestId
        if inputs.insert(key).inserted {
            screens[launchID, default: ""] += input.data.replacingOccurrences(of: "\r", with: "\r\n") + "Demo received input.\r\n> "
        }
        return TerminalInputResult(state: "sent")
    }
}
