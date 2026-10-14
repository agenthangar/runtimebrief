import AppIntents
import Foundation
import SwiftUI

/// "Tell the Meal Planner agent in RuntimeBrief", then the message: sends it
/// to the agent RuntimeBrief started on that project, after confirmation.
struct TellAgentIntent: AppIntent {
    static let title: LocalizedStringResource = "Tell an Agent"
    static let description = IntentDescription(
        "Sends a message to the coding agent RuntimeBrief started on a project, after you confirm it. The agent waiting for input is chosen first, otherwise the most recent one.",
        categoryName: "Coding Agents"
    )
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Project", requestValueDialog: "Which project's agent?") var project: ProjectEntity
    @Parameter(title: "Message", requestValueDialog: "What should I tell the agent?") var message: String

    static var parameterSummary: some ParameterSummary {
        Summary("Tell the \(\.$project) agent: \(\.$message)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw $message.needsValueError("What should I tell the agent?") }
        let isDemo = RuntimeBriefModeStore.isDemoEnabled
        let settings = ServerSettings.load()
        let scope = isDemo ? "demo" : (settings.baseURL?.absoluteString ?? "unconfigured")
        let result = try await SiriAgentMessenger.send(
            message: text, projectID: project.id, projectName: project.name,
            source: RuntimeBriefDataSourceFactory.make(isDemo: isDemo), scope: scope, isDemo: isDemo
        ) { agent, name, message in
            try await requestConfirmation(actionName: .send, dialog: IntentDialog(stringLiteral: "Send to \(agent) on \(name): \(message)?"))
            guard RuntimeBriefModeStore.isDemoEnabled == isDemo, isDemo || ServerSettings.load() == settings else {
                throw SiriIntentFailure(message: "Your connection changed. Run the shortcut again to confirm the destination.")
            }
        }
        return .result(value: result, dialog: IntentDialog(stringLiteral: result),
                       view: StatusSnippetView(projectName: project.name, branch: project.branch, answer: result))
    }
}

/// Finds the agent a spoken message is for and delivers it once.
@MainActor
enum SiriAgentMessenger {
    /// Sessions RuntimeBrief can continue that are still alive.
    private static let liveStates: Set<String> = ["needs_input", "running", "starting", "completed"]

    /// The agent waiting for input, else the most recently started live one.
    static func target(in launches: [ClaudeLaunch]) -> ClaudeLaunch? {
        let live = launches.filter { $0.requestedRemoteControl != false && liveStates.contains($0.state) }
        return live.filter { $0.state == "needs_input" }.max { $0.createdAt < $1.createdAt }
            ?? live.max { $0.createdAt < $1.createdAt }
    }

    static func send(
        message: String,
        projectID: String,
        projectName: String,
        source: any RuntimeBriefDataSource,
        scope: String,
        isDemo: Bool,
        defaults: UserDefaults = .standard,
        confirm: (_ agent: String, _ projectName: String, _ message: String) async throws -> Void
    ) async throws -> String {
        let launches: [ClaudeLaunch]
        do {
            launches = try await source.sessions(projectID: projectID).launches
        } catch let error as RuntimeBriefError {
            throw SiriIntentFailure(message: unreachableMessage(for: error))
        }
        guard let target = target(in: launches) else {
            throw SiriIntentFailure(message: "No agent that RuntimeBrief started is running on \(projectName). Say “Start Codex for \(projectName) from RuntimeBrief” to start one.")
        }
        try await confirm(target.agent.label, projectName, message)
        // The same request ID is reused if this exact message is retried.
        let reply = SessionReplyDraft.request(scope: scope, launchID: target.id,
                                              body: SessionReply(requestId: "", text: message), defaults: defaults)
        let result: SessionReplyResult
        do {
            result = try await source.reply(projectID: projectID, launchID: target.id, reply: reply)
        } catch let error as RuntimeBriefError {
            throw SiriIntentFailure(message: unreachableMessage(for: error))
        }
        let prefix = isDemo ? "Fictional demo. No message was sent to a Mac. " : ""
        if result.accepted {
            SessionReplyDraft.clear(scope: scope, launchID: target.id, body: reply, defaults: defaults)
            return "\(prefix)Sent to \(target.agent.label) on \(projectName)."
        }
        if result.unknown == true {
            return "\(prefix)I couldn't confirm \(target.agent.label) received it. Check the session in the app before sending again."
        }
        throw SiriIntentFailure(message: "\(target.agent.label) on \(projectName) didn't accept the message. Open the session in the app.")
    }
}
