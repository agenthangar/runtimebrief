import Foundation

/// Fictional in-memory interaction. This actor never creates a client or opens an app.
actor DemoClaudeTasks {
    static let shared = DemoClaudeTasks()
    private var tasks: [ClaudeLaunch] = []

    func list(projectID: String) -> ClaudeLaunchList {
        ClaudeLaunchList(
            capability: ClaudeLaunchCapability(available: true, message: "Try a fictional Claude task. Demo mode never sends work to a Mac."),
            launches: tasks.filter { $0.projectId == projectID }
        )
    }

    func start(projectID: String, requestID: String, model: ClaudeModel, permissionMode: ClaudePermissionMode) -> ClaudeLaunch {
        if let existing = tasks.first(where: { $0.id == requestID && $0.projectId == projectID }) { return existing }
        let launch = ClaudeLaunch(
            id: requestID, projectId: projectID, name: "Demo Claude task", createdAt: Date(),
            state: "completed", message: "Demo task ready to review. No work was sent to a Mac.",
            nativeId: "demo-task", sessionId: nil, cwd: "/demo/sample-tracker", openedAt: nil,
            model: model.rawValue, permissionMode: permissionMode.rawValue
        )
        tasks.insert(launch, at: 0)
        return launch
    }
}
