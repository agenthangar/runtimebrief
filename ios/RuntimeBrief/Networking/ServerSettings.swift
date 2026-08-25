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

    /// Bare Tailscale DNS names use Serve's HTTPS/443 endpoint. Other bare
    /// hosts retain the local-development HTTP/8484 default.
    static func normalizeURL(_ input: String) -> URL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let hasExplicitScheme = trimmed.contains("://")
        let withScheme = hasExplicitScheme ? trimmed : "http://\(trimmed)"
        guard var components = URLComponents(string: withScheme),
              let host = components.host, !host.isEmpty
        else { return nil }
        if !hasExplicitScheme,
           host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
               .hasSuffix(".ts.net") {
            components.scheme = "https"
        }
        if components.port == nil {
            components.port = components.scheme?.lowercased() == "https" ? 443 : 8484
        }
        components.path = ""
        return components.url
    }

    var isConfigured: Bool { baseURL != nil && token?.isEmpty == false }
}
