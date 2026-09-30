import SwiftUI

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
    }

    var body: some Scene {
        WindowGroup {
            ProjectsListView()
        }
    }
}
