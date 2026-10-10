import AppIntents
import Foundation
import SwiftUI

struct ListProjectsIntent: AppIntent {
    static let title: LocalizedStringResource = "List Projects"
    static let description = IntentDescription(
        "Names your projects and which had recent agent activity.",
        categoryName: "Status"
    )
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[ProjectEntity]> & ShowsSnippetView {
        do {
            let snapshot = try await ProjectsStore.shared.briefSnapshot()
            let projects = snapshot.projects
            let dayAgo = Date().addingTimeInterval(-24 * 60 * 60)
            let active = projects.filter { ($0.lastActivityAt ?? .distantPast) > dayAgo }
            // Siri says two lines; the snippet lists every project.
            var dialog = SiriBrief.prefix(snapshot) + (projects.isEmpty ? "No projects are registered yet. Add projects on your Mac." :
                "You have \(projects.count) project\(projects.count == 1 ? "" : "s").")
            if !active.isEmpty {
                let shown = active.prefix(3).map(\.name) + (active.count > 3 ? ["\(active.count - 3) more"] : [])
                dialog += " Active in the last day: \(shown.formatted(.list(type: .and)))."
            }
            return .result(value: projects.map(ProjectEntity.init(summary:)), dialog: IntentDialog(stringLiteral: dialog),
                           view: ProjectListSnippetView(lines: [SiriBrief.prefix(snapshot)] + projects.map { "\($0.name): \($0.brief?.headline ?? "No brief available")" }))
        } catch {
            throw SiriIntentFailure(message: unreachableMessage(for: error))
        }
    }
}
