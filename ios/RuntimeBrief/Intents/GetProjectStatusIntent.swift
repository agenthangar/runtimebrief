import AppIntents
import Foundation
import SwiftUI

struct GetProjectStatusIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Project Status"
    static let description = IntentDescription(
        "Reads a recent evidence-backed analysis of a project without waiting for a model run.",
        categoryName: "Status"
    )
    // Runs headlessly from Siri/Shortcuts — the app never opens.
    static let openAppWhenRun = false

    @Parameter(title: "Project")
    var project: ProjectEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Get the status of \(\.$project)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> & ShowsSnippetView {
        do {
            let dataSource = RuntimeBriefDataSourceFactory.current(timeout: 4)
            let snapshot = try await ProjectsStore.shared.briefSnapshot(dataSource: dataSource)
            if let project {
                guard let current = snapshot.projects.first(where: { $0.id == project.id }) else {
                    throw RuntimeBriefError.notFound
                }
                let text: String
                if snapshot.isSaved {
                    text = SiriBrief.project(current, snapshot: snapshot)
                } else {
                    do {
                        let status = try await dataSource.voiceStatus(projectID: current.id)
                        text = SiriBrief.prefix(snapshot) + SiriBrief.analyzedProject(current, status: status)
                    } catch {
                        text = "The analysis is unavailable right now. " + SiriBrief.project(current, snapshot: snapshot)
                    }
                }
                return .result(value: text, dialog: IntentDialog(stringLiteral: text),
                               view: StatusSnippetView(projectName: current.name, branch: current.branch, answer: text))
            }
            // A spoken shortcut without a project should answer immediately.
            // The system may not offer an entity picker from Siri on every OS.
            let text = SiriBrief.overview(snapshot)
            return .result(value: text, dialog: IntentDialog(stringLiteral: text),
                           view: StatusSnippetView(projectName: "Projects", branch: nil, answer: text))
        } catch {
            throw SiriIntentFailure(message: unreachableMessage(for: error))
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
