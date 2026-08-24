import AppIntents

struct RuntimeBriefShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: GetProjectStatusIntent(),
            phrases: [
                // Keep at least one phrase without \(\.$project): shortcuts whose
                // every phrase embeds a parameter stay hidden until parameter
                // values have been donated via updateAppShortcutParameters().
                "Get a project status in \(.applicationName)",
                "What's the state of my project in \(.applicationName)",
                "What's the state of \(\.$project) in \(.applicationName)",
                "What's the status of \(\.$project) in \(.applicationName)",
                "Ask \(.applicationName) about \(\.$project)",
                "\(.applicationName) status for \(\.$project)",
            ],
            shortTitle: "Project Status",
            systemImageName: "shippingbox"
        )
        AppShortcut(
            intent: AskProjectIntent(),
            phrases: [
                "Ask \(.applicationName) a question",
                "Ask \(.applicationName) a question about \(\.$project)",
                "Question \(.applicationName) about \(\.$project)",
            ],
            shortTitle: "Ask About Project",
            systemImageName: "questionmark.bubble"
        )
        AppShortcut(
            intent: ListProjectsIntent(),
            phrases: [
                "What are my projects up to in \(.applicationName)",
                "List my \(.applicationName) projects",
                "What have my agents been doing in \(.applicationName)",
            ],
            shortTitle: "List Projects",
            systemImageName: "list.bullet"
        )
    }
}

// ---------------------------------------------------------------------------
// FUTURE CLIENT SEAMS (the daemon records decisions but never executes them):
//
//   struct ApproveActionIntent: AppIntent { ... }
//     Confirms a pending Action proposed by the analyst (see the
//     Action/Decision sketch in daemon/src/types.ts). Requires the daemon's
//     decision endpoint.
//
//   Live Activity for long analyst runs: start when /ask streaming begins,
//     update with streamed chunk progress, end with the final answer.
// ---------------------------------------------------------------------------
