import AppIntents
import SwiftUI

extension View {
    @ViewBuilder
    func projectEntityContext(_ project: ProjectSummary, enabled: Bool) -> some View {
        #if compiler(>=6.4)
        appEntityIdentifier(enabled ? EntityIdentifier(for: ProjectEntity(summary: project)) : nil)
        #else
        self
        #endif
    }
}
