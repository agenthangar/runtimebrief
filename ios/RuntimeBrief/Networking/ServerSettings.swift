import Foundation

/// Server URL lives in UserDefaults; the token lives in the Keychain only.
struct ServerSettings: Sendable {
    var baseURL: URL?
    var token: String?

    // These persisted identifiers intentionally remain stable across the
    // Backbrief-to-RuntimeBrief product rename.
    static let tokenAccount = "backbrief-daemon-token"
    private static let urlKey = "backbrief.serverURL"

    static func load() -> ServerSettings {
        #if DEBUG
        // Simulator/E2E runs can connect to an isolated daemon without
        // persisting a test credential in UserDefaults or the Keychain.
        let environment = ProcessInfo.processInfo.environment
        if let urlString = environment["RUNTIMEBRIEF_E2E_SERVER_URL"],
           let url = normalizeURL(urlString),
           let token = environment["RUNTIMEBRIEF_E2E_TOKEN"],
           !token.isEmpty {
            return ServerSettings(baseURL: url, token: token)
        }
        #endif
        let defaults = UserDefaults.standard
        let urlString = defaults.string(forKey: urlKey)
        let token = Keychain.read(account: tokenAccount)
        return ServerSettings(
            baseURL: urlString.flatMap(URL.init(string:)),
            token: token
        )
    }

    static func save(urlString: String, token: String) throws {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = normalizeURL(trimmed) else {
            throw RuntimeBriefError.invalidServerURL
        }
        UserDefaults.standard.set(url.absoluteString, forKey: urlKey)
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedToken.isEmpty {
            Keychain.delete(account: tokenAccount)
        } else {
            try Keychain.save(trimmedToken, account: tokenAccount)
        }
    }

    /// Accepts "100.x.y.z:8484", "http://mini.tail1234.ts.net:8484", etc.
    static func normalizeURL(_ input: String) -> URL? {
        guard !input.isEmpty else { return nil }
        let withScheme = input.contains("://") ? input : "http://\(input)"
        guard var components = URLComponents(string: withScheme),
              let host = components.host, !host.isEmpty
        else { return nil }
        if components.port == nil { components.port = 8484 }
        components.path = ""
        return components.url
    }

    var isConfigured: Bool { baseURL != nil && token?.isEmpty == false }
}
