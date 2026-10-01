import AppIntents
import Foundation
import SwiftUI

/// A required project lets Siri ask a short follow-up when the person starts
/// with "RuntimeBrief project analysis" instead of naming a project upfront.
struct GetProjectAnalysisIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Project Analysis"
    static let description = IntentDescription(
        "Reads the latest evidence-backed project analysis aloud.",
        categoryName: "Status"
    )
    static let openAppWhenRun = false

    @Parameter(title: "Project")
    var project: ProjectEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Analyze \(\.$project)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> & ShowsSnippetView {
        do {
            let dataSource = RuntimeBriefDataSourceFactory.current(timeout: 4)
            let snapshot = try await ProjectsStore.shared.briefSnapshot(dataSource: dataSource)
            let answer = try await ProjectStatusReader.read(project, snapshot: snapshot, dataSource: dataSource)
            return .result(value: answer.text, dialog: IntentDialog(stringLiteral: answer.text),
                           view: StatusSnippetView(projectName: answer.name, branch: answer.branch, answer: answer.text))
        } catch {
            throw SiriIntentFailure(message: unreachableMessage(for: error))
        }
    }
}
