import AppIntents

struct RuntimeBriefShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartSessionIntent(),
            phrases: [
                "\(.applicationName) start an agent",
                "Start an agent in \(.applicationName)",
                "Start a coding session in \(.applicationName)",
                "Start a new coding agent in \(.applicationName)",
                "Create a coding agent with \(.applicationName)",
                "Run a coding agent using \(.applicationName)",
                "Start a task for \(\.$project) in \(.applicationName)",
                "Start a new coding agent for the project \(\.$project) from \(.applicationName)",
                "Create an agent for \(\.$project) using \(.applicationName)",
            ],
            shortTitle: "Start Coding Session",
            systemImageName: "terminal"
        )
        // Separate intent identities keep Siri's phrase index from treating the
        // project in a named-agent request as the generic intent's provider.
        AppShortcut(
            intent: StartClaudeSessionIntent(),
            phrases: [
                "\(.applicationName) start Claude",
                "\(.applicationName) start a Claude agent",
                "Start Claude with \(.applicationName)",
                "Start a new Claude Code agent in \(.applicationName)",
                "Start Claude for \(\.$project) from \(.applicationName)",
                "Start Claude for \(\.$project) using \(.applicationName)",
                "Start a new Claude Code agent for the project \(\.$project) from \(.applicationName)",
                "Create a Claude agent for \(\.$project) with \(.applicationName)",
            ],
            shortTitle: "Start Claude Agent",
            systemImageName: "terminal"
        )
        AppShortcut(
            intent: StartCodexSessionIntent(),
            phrases: [
                "\(.applicationName) start Codex",
                "\(.applicationName) start a Codex agent",
                "Start Codex with \(.applicationName)",
                "Start Codex for \(\.$project) from \(.applicationName)",
                "Start a new Codex agent for the project \(\.$project) from \(.applicationName)",
                "Start Codex for \(\.$project) using \(.applicationName)",
                "Create a Codex agent for \(\.$project) with \(.applicationName)",
            ],
            shortTitle: "Start Codex Agent",
            systemImageName: "terminal"
        )
        AppShortcut(
            intent: StartCursorSessionIntent(),
            phrases: [
                "\(.applicationName) start Cursor",
                "\(.applicationName) start a Cursor agent",
                "Start Cursor with \(.applicationName)",
                "Start Cursor for \(\.$project) from \(.applicationName)",
                "Start a new Cursor agent for the project \(\.$project) from \(.applicationName)",
                "Start Cursor for \(\.$project) using \(.applicationName)",
                "Create a Cursor agent for \(\.$project) with \(.applicationName)",
            ],
            shortTitle: "Start Cursor Agent",
            systemImageName: "terminal"
        )
        AppShortcut(
            intent: GetAttentionIntent(),
            phrases: [
                "What needs attention in \(.applicationName)",
                "Which projects need attention in \(.applicationName)",
                "Show my blockers in \(.applicationName)",
                "Does anything need my attention in \(.applicationName)",
                "What should I look at in \(.applicationName)",
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
            intent: GetProjectAnalysisIntent(),
            phrases: [
                // This short form asks for a project aloud when none was named.
                "\(.applicationName) project analysis",
                "Get a project analysis from \(.applicationName)",
                "Get me the analysis of the project \(\.$project) from \(.applicationName)",
                "Get the analysis of \(\.$project) from \(.applicationName)",
                "Give me the latest analysis of the project \(\.$project) from \(.applicationName)",
                "Give me the latest analysis of \(\.$project) from \(.applicationName)",
                "Analyze \(\.$project) with \(.applicationName)",
                "Catch me up on \(\.$project) using \(.applicationName)",
                "What happened with \(\.$project) in \(.applicationName)",
                "\(.applicationName) analysis for \(\.$project)",
            ],
            shortTitle: "Project Analysis",
            systemImageName: "waveform"
        )
        AppShortcut(
            intent: GetProjectStatusIntent(),
            phrases: [
                // Keep at least one phrase without \(\.$project): shortcuts whose
                // every phrase embeds a parameter stay hidden until parameter
                // values have been donated via updateAppShortcutParameters().
                "Get me status from \(.applicationName)",
                "Get my project status from \(.applicationName)",
                "Get status from \(.applicationName)",
                "Get a project status in \(.applicationName)",
                "Show project status in \(.applicationName)",
                "Run \(.applicationName) project status",
                "Show \(.applicationName) status",
                "What's the state of my project in \(.applicationName)",
                "What's the state of \(\.$project) in \(.applicationName)",
                "What's the status of \(\.$project) in \(.applicationName)",
                "How is \(\.$project) doing in \(.applicationName)",
                "Get the status of \(\.$project) from \(.applicationName)",
                "Get me the status of the \(\.$project) project from \(.applicationName)",
                "Tell me the latest status of \(\.$project) in \(.applicationName)",
                "What's the status of my \(\.$project) app in \(.applicationName)",
                "Show the status of \(\.$project) in \(.applicationName)",
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
                "Give me an overview in \(.applicationName)",
            ],
            shortTitle: "List Projects",
            systemImageName: "list.bullet"
        )
    }
}
