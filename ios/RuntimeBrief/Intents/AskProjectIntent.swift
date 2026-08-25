import AppIntents
import Foundation

struct AskProjectIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask About a Project"
    static let description = IntentDescription(
        "Asks the RuntimeBrief analyst a question about a project.",
        categoryName: "Status"
    )
    static let openAppWhenRun = false

    @Parameter(title: "Project")
    var project: ProjectEntity

    @Parameter(title: "Question", requestValueDialog: "What do you want to know?")
    var question: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask about \(\.$project): \(\.$question)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        do {
            let answer = try await RuntimeBriefDataSourceFactory.current(timeout: 20)
                .ask(projectID: project.id, question: question)
            return .result(dialog: IntentDialog(stringLiteral: answer.spokenAnswer))
        } catch {
            let message = unreachableMessage(for: error)
            return .result(dialog: IntentDialog(stringLiteral: message))
        }
    }
}
