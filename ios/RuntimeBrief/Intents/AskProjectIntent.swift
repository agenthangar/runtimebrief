import AppIntents
import Foundation
import SwiftUI

struct AskProjectIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask About a Project"
    static let description = IntentDescription(
        "Asks the RuntimeBrief analyst a question about a project.",
        categoryName: "Status"
    )
    static let openAppWhenRun = false

    @Parameter(title: "Project", requestValueDialog: "Which project is your question about?")
    var project: ProjectEntity

    @Parameter(title: "Question", requestValueDialog: "What do you want to know?")
    var question: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask about \(\.$project): \(\.$question)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> & ShowsSnippetView {
        do {
            let answer = try await RuntimeBriefDataSourceFactory.current(timeout: 20)
                .ask(projectID: project.id, question: question)
            return .result(value: answer.spokenAnswer, dialog: IntentDialog(stringLiteral: answer.spokenAnswer),
                           view: StatusSnippetView(projectName: project.name, branch: project.branch, answer: answer.spokenAnswer))
        } catch {
            throw SiriIntentFailure(message: unreachableMessage(for: error))
        }
    }
}
