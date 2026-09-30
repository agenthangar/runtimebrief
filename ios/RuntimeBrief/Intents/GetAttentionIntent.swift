import AppIntents
import SwiftUI

struct GetAttentionIntent: AppIntent {
    static let title: LocalizedStringResource = "What Needs Attention"
    static let description = IntentDescription("Lists projects with attention items in their evidence-backed briefs. Does not start an analyst run.", categoryName: "Status")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ReturnsValue<[ProjectEntity]> & ProvidesDialog & ShowsSnippetView {
        do {
            let snapshot = try await ProjectsStore.shared.briefSnapshot()
            let projects = SiriBrief.attentionProjects(snapshot.projects)
            let text = SiriBrief.attention(snapshot)
            return .result(value: projects.map(ProjectEntity.init(summary:)), dialog: IntentDialog(stringLiteral: text),
                           view: ProjectListSnippetView(lines: [text]))
        } catch {
            throw SiriIntentFailure(message: unreachableMessage(for: error))
        }
    }
}
