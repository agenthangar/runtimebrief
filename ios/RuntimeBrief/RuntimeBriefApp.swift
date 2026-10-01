import SwiftUI
import AppIntents

@main
struct RuntimeBriefApp: App {
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.environment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] == "1" {
            RuntimeBriefModeStore.setDemoEnabled(false)
            ProjectsStore.resetPersistedSnapshotForUITesting()
            ServerSettings.resetForUITesting()
            UserDefaults.standard.removeObject(forKey: ProjectDiscoverySettings.key)
        }
        #endif
        // Parameterized Siri phrases remain unavailable until the system has
        // fetched their entities. Register on every launch, including updates
        // and offline launches that can resolve the saved project snapshot.
        RuntimeBriefShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup {
            ProjectsListView()
        }
    }
}
