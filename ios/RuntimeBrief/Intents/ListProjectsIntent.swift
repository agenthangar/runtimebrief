import AppIntents
import Foundation

struct ListProjectsIntent: AppIntent {
    static let title: LocalizedStringResource = "List Projects"
    static let description = IntentDescription(
        "Names your projects and which had recent agent activity.",
        categoryName: "Status"
    )
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        do {
            let projects = try await RuntimeBriefDataSourceFactory.current(timeout: 20).projects()
            guard !projects.isEmpty else {
                let none = "No projects are registered yet. Run runtimebriefd add-project on your Mac."
                return .result(dialog: IntentDialog(stringLiteral: none))
            }
            let dayAgo = Date().addingTimeInterval(-24 * 60 * 60)
            let active = projects.filter { ($0.lastActivityAt ?? .distantPast) > dayAgo }
            let names = projects.map(\.name).formatted(.list(type: .and))
            var dialog = "You have \(projects.count) project\(projects.count == 1 ? "" : "s"): \(names)."
            if !active.isEmpty {
                let activeNames = active.map(\.name).formatted(.list(type: .and))
                dialog += " Active in the last day: \(activeNames)."
            }
            return .result(dialog: IntentDialog(stringLiteral: dialog))
        } catch {
            let message = unreachableMessage(for: error)
            return .result(dialog: IntentDialog(stringLiteral: message))
        }
    }
}
