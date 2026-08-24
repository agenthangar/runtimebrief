import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var serverURL = ""
    @State private var token = ""
    @State private var testResult: TestResult?
    @State private var testing = false
    @FocusState private var focusedField: Field?

    enum Field {
        case server
        case token
    }

    enum TestResult {
        case success(String)
        case failure(String)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("100.x.y.z:8484 or mini.tailnet.ts.net:8484", text: $serverURL)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(.system(.body, design: .monospaced))
                        .focused($focusedField, equals: .server)
                } header: {
                    Text("Server")
                } footer: {
                    Text("The address of runtimebriefd on your Mac — usually its Tailscale IP or MagicDNS name.")
                }

                Section {
                    SecureField("Paste the token from `runtimebriefd init`", text: $token)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .focused($focusedField, equals: .token)
                } header: {
                    Text("Token")
                } footer: {
                    Text("Stored in the Keychain, never in app preferences.")
                }

                Section {
                    Button {
                        testConnection()
                    } label: {
                        if testing {
                            HStack {
                                ProgressView().controlSize(.small)
                                Text("Testing…")
                            }
                        } else {
                            Text("Test Connection")
                        }
                    }
                    .disabled(serverURL.isEmpty || token.isEmpty || testing)

                    if let testResult {
                        switch testResult {
                        case .success(let message):
                            Label(message, systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        case .failure(let message):
                            Label(message, systemImage: "xmark.circle.fill")
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focusedField = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(serverURL.isEmpty)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        let settings = ServerSettings.load()
        serverURL = settings.baseURL?.absoluteString ?? ""
        token = settings.token ?? ""
    }

    private func save() {
        do {
            try ServerSettings.save(urlString: serverURL, token: token)
            dismiss()
        } catch {
            testResult = .failure((error as? RuntimeBriefError)?.errorDescription ?? "Couldn't save.")
        }
    }

    private func testConnection() {
        testing = true
        testResult = nil
        Task {
            defer { testing = false }
            guard let url = ServerSettings.normalizeURL(serverURL) else {
                testResult = .failure("That server address doesn't look valid.")
                return
            }
            let settings = ServerSettings(baseURL: url, token: token)
            do {
                let health = try await RuntimeBriefClient(settings: settings, timeout: 8).health()
                testResult = .success("Connected — runtimebriefd \(health.version)")
            } catch {
                testResult = .failure(
                    (error as? RuntimeBriefError)?.errorDescription ?? error.localizedDescription)
            }
        }
    }
}
