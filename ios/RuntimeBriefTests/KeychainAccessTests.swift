import Foundation
import Security
import Testing
@testable import RuntimeBrief

struct KeychainAccessTests {
    @Test func daemonCredentialUsesAccessClassAvailableAfterRelocking() throws {
        let service = "com.example.runtimebrief.locked-test.\(UUID())"
        let account = "fictional-daemon"
        defer { Keychain.delete(account: account, service: service) }
        try Keychain.save("fictional-connection-token", account: account, service: service)

        var attributes: AnyObject?
        let status = SecItemCopyMatching([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnAttributes: true,
        ] as CFDictionary, &attributes)
        #expect(status == errSecSuccess)
        let item = try #require(attributes as? [String: Any])
        #expect(item[kSecAttrAccessible as String] as? String == kSecAttrAccessibleAfterFirstUnlock as String)
        #expect(Keychain.read(account: account, service: service) == "fictional-connection-token")
    }
}
