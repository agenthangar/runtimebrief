import AppIntents

struct RuntimeBriefShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartSessionIntent(),
            phrases: [
                "Start a coding session in \(.applicationName)",
                "Start a \(\.$provider) session in \(.applicationName)",
                "Start a task for \(\.$project) in \(.applicationName)",
            ],
            shortTitle: "Start Coding Session",
            systemImageName: "terminal"
        )
        AppShortcut(
            intent: GetAttentionIntent(),
            phrases: [
                "What needs attention in \(.applicationName)",
                "Which projects need attention in \(.applicationName)",
                "Show my blockers in \(.applicationName)",
            ],
            shortTitle: "Needs Attention",
            systemImageName: "exclamationmark.bubble"
        )
        AppShortcut(
            intent: OpenProjectIntent(),
            phrases: [
                "Open a project in \(.applicationName)",
                "Open \(\.$target) in \(.applicationName)",
                "Show \(\.$target) in \(.applicationName)",
            ],
            shortTitle: "Open Project",
            systemImageName: "shippingbox"
        )
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
                "Tell me the status of \(\.$project) from \(.applicationName)",
                "Can you tell me the status of the \(\.$project) app from \(.applicationName)",
                "Get the status of \(\.$project) using \(.applicationName)",
                "Tell me a project's status from \(.applicationName)",
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
