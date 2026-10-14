import AppIntents
import Foundation
import SwiftUI

/// The open-ended Siri entry point: "Ask RuntimeBrief", then any question in
/// the person's own words. The type name stays stable for saved Shortcuts.
struct AskProjectIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask RuntimeBrief"
    static let description = IntentDescription(
        "Answers any question about your projects and coding agents in plain language, such as what needs attention, what an agent finished, or why a project is blocked. Name a project in the question or choose one to focus the answer.",
        categoryName: "Status"
    )
    static let openAppWhenRun = false

    @Parameter(
        title: "Question",
        description: "Anything about your projects or coding agents, in your own words.",
        requestValueDialog: "What do you want to know?"
    )
    var question: String

    @Parameter(
        title: "Project",
        description: "Optional. Leave empty to ask about every project; a project named in the question is found automatically."
    )
    var project: ProjectEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Ask \(\.$question)") {
            \.$project
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> & ShowsSnippetView {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw $question.needsValueError("What do you want to know?")
        }
        do {
            let reply = try await SiriQuestion.answerWaiting(
                question: trimmed,
                projectID: project?.id,
                dataSource: RuntimeBriefDataSourceFactory.current(timeout: 13)
            ) { prompt in
                // Declining ends the request; the answer stays ready on the Mac.
                try await requestConfirmation(actionName: .continue, dialog: IntentDialog(stringLiteral: prompt))
            }
            return .result(value: reply.detail, dialog: IntentDialog(stringLiteral: reply.text),
                           view: StatusSnippetView(projectName: reply.title, branch: project?.branch, answer: reply.text))
        } catch let error as RuntimeBriefError {
            throw SiriIntentFailure(message: unreachableMessage(for: error))
        }
    }
}
