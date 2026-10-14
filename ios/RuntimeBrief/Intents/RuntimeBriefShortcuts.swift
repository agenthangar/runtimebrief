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
                "Start an agent for \(\.$project) from \(.applicationName)",
                "Start an agent for \(\.$project) via \(.applicationName)",
                "Start a coding session for \(\.$project) from \(.applicationName)",
                "Start a coding session for \(\.$project) via \(.applicationName)",
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
                "Start Claude for \(\.$project) via \(.applicationName)",
                "Start Claude for \(\.$project) with \(.applicationName)",
                "Start Claude for \(\.$project) in \(.applicationName)",
                "Start Claude on \(\.$project) from \(.applicationName)",
                "Start a Claude session for \(\.$project) from \(.applicationName)",
                "Start a Claude session for \(\.$project) via \(.applicationName)",
                "Start a Claude session for \(\.$project) using \(.applicationName)",
                "Start a Claude agent for \(\.$project) from \(.applicationName)",
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
                "Start Codex for \(\.$project) via \(.applicationName)",
                "Start Codex for \(\.$project) with \(.applicationName)",
                "Start Codex for \(\.$project) in \(.applicationName)",
                "Start Codex on \(\.$project) from \(.applicationName)",
                "Start a Codex session for \(\.$project) from \(.applicationName)",
                "Start a Codex session for \(\.$project) via \(.applicationName)",
                "Start a Codex session for \(\.$project) using \(.applicationName)",
                "Start a Codex agent for \(\.$project) from \(.applicationName)",
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
                "Start Cursor for \(\.$project) via \(.applicationName)",
                "Start Cursor for \(\.$project) with \(.applicationName)",
                "Start Cursor for \(\.$project) in \(.applicationName)",
                "Start Cursor on \(\.$project) from \(.applicationName)",
                "Start a Cursor session for \(\.$project) from \(.applicationName)",
                "Start a Cursor session for \(\.$project) via \(.applicationName)",
                "Start a Cursor session for \(\.$project) using \(.applicationName)",
                "Start a Cursor agent for \(\.$project) from \(.applicationName)",
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
        // A spoken message to a running agent; the message is asked for
        // after the project, then confirmed before it is sent.
        AppShortcut(
            intent: TellAgentIntent(),
            phrases: [
                "\(.applicationName) tell an agent",
                "Tell an agent in \(.applicationName)",
                "Tell the \(\.$project) agent in \(.applicationName)",
                "Message the \(\.$project) agent in \(.applicationName)",
                "Reply to the \(\.$project) agent in \(.applicationName)",
                "Send a message to the \(\.$project) agent with \(.applicationName)",
                "Ask \(.applicationName) to tell the \(\.$project) agent something",
                "Tell the \(\.$project) agent via \(.applicationName)",
                "Tell the \(\.$project) agent from \(.applicationName)",
                "Tell the \(\.$project) agent using \(.applicationName)",
            ],
            shortTitle: "Tell an Agent",
            systemImageName: "bubble.left.and.text.bubble.right"
        )
        // Every request about one project uses the analysis action, whose
        // project is required: when Siri mishears the name, it asks "Which
        // project?" and resolves the reply, rather than answering for all.
        AppShortcut(
            intent: GetProjectAnalysisIntent(),
            phrases: [
                "\(.applicationName) project analysis",
                "Get a project analysis from \(.applicationName)",
                "Get my project status from \(.applicationName)",
                "Get a project status in \(.applicationName)",
                "Show project status in \(.applicationName)",
                "Run \(.applicationName) project status",
                "What's the state of my project in \(.applicationName)",
                "Tell me a project's status from \(.applicationName)",
                "Get me the analysis of the project \(\.$project) from \(.applicationName)",
                "Get the analysis of \(\.$project) from \(.applicationName)",
                "Give me the latest analysis of the project \(\.$project) from \(.applicationName)",
                "Give me the latest analysis of \(\.$project) from \(.applicationName)",
                "Analyze \(\.$project) with \(.applicationName)",
                "Catch me up on \(\.$project) using \(.applicationName)",
                "What happened with \(\.$project) in \(.applicationName)",
                "\(.applicationName) analysis for \(\.$project)",
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
                "Get the status of \(\.$project) via \(.applicationName)",
                "What's the status of \(\.$project) via \(.applicationName)",
                "What's the status of \(\.$project) from \(.applicationName)",
                "Ask \(.applicationName) about \(\.$project)",
                "Ask \(.applicationName) what's the status of \(\.$project)",
                "Ask \(.applicationName) for the status of \(\.$project)",
                "Ask \(.applicationName) how \(\.$project) is doing",
                "Ask \(.applicationName) what's happening with \(\.$project)",
                "Ask \(.applicationName) for an update on \(\.$project)",
                "\(.applicationName) status for \(\.$project)",
            ],
            shortTitle: "Project Status",
            systemImageName: "waveform"
        )
        // Status for every project at once; no project is asked for.
        AppShortcut(
            intent: GetProjectStatusIntent(),
            phrases: [
                "Get me status from \(.applicationName)",
                "Get status from \(.applicationName)",
                "Show \(.applicationName) status",
                "How are my projects doing in \(.applicationName)",
                "Give me a status update from \(.applicationName)",
                "What are my projects up to in \(.applicationName)",
                "List my \(.applicationName) projects",
                "What have my agents been doing in \(.applicationName)",
                "Give me an overview in \(.applicationName)",
            ],
            shortTitle: "All Projects Status",
            systemImageName: "shippingbox"
        )
        // The open-ended entry point. A spoken phrase cannot carry free text,
        // so Siri asks "What do you want to know?" and the daemon interprets
        // the answer, including any project it names.
        AppShortcut(
            intent: AskProjectIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Ask \(.applicationName) a question",
                "Ask \(.applicationName) something",
                "I have a question for \(.applicationName)",
                "Talk to \(.applicationName)",
                "Check with \(.applicationName)",
                "Ask \(.applicationName) about my projects",
                "Ask \(.applicationName) about my agents",
                "Ask \(.applicationName) a question about \(\.$project)",
                "Question \(.applicationName) about \(\.$project)",
            ],
            shortTitle: "Ask RuntimeBrief",
            systemImageName: "questionmark.bubble"
        )
        // What finished, across every agent and project, without a model run.
        AppShortcut(
            intent: GetDigestIntent(),
            phrases: [
                "What did my agents get done in \(.applicationName)",
                "What did my agents get done \(\.$period) in \(.applicationName)",
                "What did my agents do \(\.$period) in \(.applicationName)",
                "What did my agents ship \(\.$period) in \(.applicationName)",
                "What got done \(\.$period) in \(.applicationName)",
                "What's new \(\.$period) in \(.applicationName)",
                "Ask \(.applicationName) what my agents got done \(\.$period)",
            ],
            shortTitle: "What Got Done",
            systemImageName: "checkmark.circle"
        )
    }
}
