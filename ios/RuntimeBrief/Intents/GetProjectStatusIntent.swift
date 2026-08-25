import AppIntents
import Foundation

struct GetProjectStatusIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Project Status"
    static let description = IntentDescription(
        "Asks the RuntimeBrief analyst what a project's current state is.",
        categoryName: "Status"
    )
    // Runs headlessly from Siri/Shortcuts — the app never opens.
    static let openAppWhenRun = false

    @Parameter(title: "Project")
    var project: ProjectEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Get the status of \(\.$project)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // TODO(iOS 27 / App Intents 2.0): stream the answer into the dialog
        // as it generates instead of waiting for the full response.
        // if #available(iOS 27, *) { ... }
        do {
            let answer = try await RuntimeBriefDataSourceFactory.current(timeout: 20)
                .status(projectID: project.id)
            return .result(dialog: IntentDialog(stringLiteral: answer.spokenAnswer))
        } catch {
            let message = unreachableMessage(for: error)
            return .result(dialog: IntentDialog(stringLiteral: message))
        }
    }
}

/// Shared Siri-friendly failure wording for headless intents.
func unreachableMessage(for error: Error) -> String {
    switch error {
    case RuntimeBriefError.notConfigured:
        return "RuntimeBrief isn't set up yet. Open the app and add your Mac's address and token in Settings."
    case RuntimeBriefError.unauthorized:
        return "Your Mac rejected the RuntimeBrief token. Open the app's settings to update it."
    case RuntimeBriefError.notFound:
        return "I couldn't find that project on your Mac."
    case RuntimeBriefError.timeout, RuntimeBriefError.network:
        return "I couldn't reach your Mac. Make sure it's awake and on the same tailnet."
    default:
        return "Something went wrong talking to your Mac."
    }
}
