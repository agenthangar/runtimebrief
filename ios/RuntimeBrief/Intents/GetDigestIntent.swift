import AppIntents
import Foundation
import SwiftUI

enum DigestPeriod: String, AppEnum {
    case today
    case yesterday
    case thisWeek

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Period"
    static let caseDisplayRepresentations: [DigestPeriod: DisplayRepresentation] = [
        .today: "today",
        .yesterday: "yesterday",
        .thisWeek: "this week",
    ]

    /// The start of the period and how Siri says it.
    func window(now: Date = Date(), calendar: Calendar = .current) -> (since: Date, label: String) {
        let midnight = calendar.startOfDay(for: now)
        switch self {
        case .today: return (midnight, "today")
        case .yesterday: return (calendar.date(byAdding: .day, value: -1, to: midnight) ?? midnight, "since yesterday")
        case .thisWeek: return (now.addingTimeInterval(-7 * 24 * 3600), "this week")
        }
    }
}

/// "What did my agents get done today?" from saved evidence, at once.
struct GetDigestIntent: AppIntent {
    static let title: LocalizedStringResource = "What My Agents Got Done"
    static let description = IntentDescription(
        "Says which projects had finished agent work today, yesterday, or this week, from saved evidence without waiting for an analysis.",
        categoryName: "Status"
    )
    static let openAppWhenRun = false

    @Parameter(title: "Period", default: .today)
    var period: DigestPeriod

    static var parameterSummary: some ParameterSummary {
        Summary("What my agents got done \(\.$period)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> & ShowsSnippetView {
        do {
            let snapshot = try await ProjectsStore.shared.briefSnapshot()
            let window = period.window()
            let text = SiriBrief.digest(snapshot, since: window.since, period: window.label)
            return .result(value: text, dialog: IntentDialog(stringLiteral: text),
                           view: StatusSnippetView(projectName: "Your Projects", branch: nil, answer: text))
        } catch {
            throw SiriIntentFailure(message: unreachableMessage(for: error))
        }
    }
}
