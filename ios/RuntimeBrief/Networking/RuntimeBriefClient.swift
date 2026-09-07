import Foundation

enum RuntimeBriefError: Error, LocalizedError, Equatable {
    case notConfigured
    case invalidServerURL
    case unauthorized
    case notFound
    case rateLimited
    case serverError(Int)
    case decoding(String)
    case network(String)
    case timeout
    case launch(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Set the server address and token in Settings first."
        case .invalidServerURL:
            return "That server address doesn't look valid."
        case .unauthorized:
            return "The daemon rejected the token. Check Settings."
        case .notFound:
            return "The daemon doesn't know that project."
        case .rateLimited:
            return "Too many requests — try again in a minute."
        case .serverError(let code):
            return "The daemon returned an error (HTTP \(code))."
        case .decoding(let detail):
            return "Couldn't read the daemon's response: \(detail)"
        case .network(let detail):
            return "Couldn't reach your Mac: \(detail)"
        case .timeout:
            return "Couldn't reach your Mac — the request timed out."
        case .launch(let message):
            return message
        }
    }
}

/// Transport seam so unit tests can run without a network. Byte streams are
/// exposed as AsyncThrowingStream because URLSession.AsyncBytes cannot be
/// constructed in tests.
protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
    func byteStream(for request: URLRequest) async throws -> (AsyncThrowingStream<UInt8, Error>, URLResponse)
}

extension URLSession: HTTPTransport {
    func byteStream(for request: URLRequest) async throws -> (AsyncThrowingStream<UInt8, Error>, URLResponse) {
        let (bytes, response) = try await self.bytes(for: request)
        let stream = AsyncThrowingStream<UInt8, Error> { continuation in
            let task = Task {
                do {
                    for try await byte in bytes { continuation.yield(byte) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        return (stream, response)
    }
}

/// Async/await client for the runtimebriefd /v1 API.
struct RuntimeBriefClient: Sendable {
    private struct LaunchFailure: Decodable { let message: String? }
    let settings: ServerSettings
    let transport: any HTTPTransport
    let timeout: TimeInterval

    init(
        settings: ServerSettings = .load(),
        transport: any HTTPTransport = URLSession.shared,
        timeout: TimeInterval = 20
    ) {
        self.settings = settings
        self.transport = transport
        self.timeout = timeout
    }

    // MARK: Endpoints

    func health() async throws -> HealthInfo {
        try await getJSON("/v1/health")
    }

    func claudeLaunches(projectID: String) async throws -> ClaudeLaunchList {
        try await getJSON("/v1/projects/\(escape(projectID))/claude-launches")
    }

    func startClaude(projectID: String, request: ClaudeLaunchRequest) async throws -> ClaudeLaunch {
        try await launchRequest(path: "/v1/projects/\(escape(projectID))/claude-launches", body: JSONEncoder().encode(request))
    }

    func openClaude(projectID: String, launchID: String) async throws -> ClaudeLaunch {
        try await launchRequest(path: "/v1/projects/\(escape(projectID))/claude-launches/\(escape(launchID))/open", body: Data("{}".utf8))
    }

    private func launchRequest<T: Decodable>(path: String, body: Data) async throws -> T {
        var request = try makeRequest(path: path)
        request.httpMethod = "POST"
        request.timeoutInterval = max(timeout, 45)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await perform(request)
        if let http = response as? HTTPURLResponse, [400, 403, 409, 503].contains(http.statusCode) {
            if let failure = try? JSONDecoder().decode(LaunchFailure.self, from: data), let message = failure.message {
                throw RuntimeBriefError.launch(message)
            }
        }
        try check(response)
        return try decode(data)
    }

    func projects() async throws -> [ProjectSummary] {
        try await getJSON("/v1/projects")
    }

    func project(id: String) async throws -> ProjectCard {
        try await getJSON("/v1/projects/\(escape(id))")
    }

    func status(projectID: String) async throws -> AnalystAnswer {
        try await getJSON("/v1/projects/\(escape(projectID))/status")
    }

    func ask(projectID: String, question: String) async throws -> AnalystAnswer {
        var request = try makeRequest(path: "/v1/projects/\(escape(projectID))/ask")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["question": question])
        let (data, response) = try await perform(request)
        try check(response)
        return try decode(data)
    }

    /// Streaming variants: yields text chunks as the analyst produces them.
    func streamStatus(projectID: String) -> AsyncThrowingStream<AnalystStreamEvent, Error> {
        streamRequest(path: "/v1/projects/\(escape(projectID))/status", body: nil)
    }

    func streamAsk(projectID: String, question: String) -> AsyncThrowingStream<AnalystStreamEvent, Error> {
        streamRequest(
            path: "/v1/projects/\(escape(projectID))/ask",
            body: try? JSONEncoder().encode(["question": question])
        )
    }

    // MARK: Internals

    private func escape(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
    }

    private func makeRequest(path: String) throws -> URLRequest {
        guard let base = settings.baseURL, let token = settings.token, !token.isEmpty else {
            throw RuntimeBriefError.notConfigured
        }
        guard let url = URL(string: path, relativeTo: base) else {
            throw RuntimeBriefError.invalidServerURL
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await transport.data(for: request)
        } catch let error as URLError where error.code == .timedOut {
            throw RuntimeBriefError.timeout
        } catch let error as RuntimeBriefError {
            throw error
        } catch {
            throw RuntimeBriefError.network(error.localizedDescription)
        }
    }

    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        switch http.statusCode {
        case 200...299: return
        case 401: throw RuntimeBriefError.unauthorized
        case 404: throw RuntimeBriefError.notFound
        case 429: throw RuntimeBriefError.rateLimited
        default: throw RuntimeBriefError.serverError(http.statusCode)
        }
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try JSONDecoder.runtimeBrief.decode(T.self, from: data)
        } catch {
            throw RuntimeBriefError.decoding(String(describing: error))
        }
    }

    private func getJSON<T: Decodable>(_ path: String) async throws -> T {
        let request = try makeRequest(path: path)
        let (data, response) = try await perform(request)
        try check(response)
        return try decode(data)
    }

    private func streamRequest(path: String, body: Data?) -> AsyncThrowingStream<AnalystStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = try makeRequest(path: path)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    if let body {
                        request.httpMethod = "POST"
                        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                        request.httpBody = body
                    }
                    let (bytes, response) = try await transport.byteStream(for: request)
                    try check(response)
                    var parser = SSEParser()
                    // Note: AsyncBytes.lines skips empty lines, which are the
                    // SSE event delimiter — split on raw newlines instead.
                    var buffer = [UInt8]()
                    func handle(_ sseEvent: SSEEvent?) -> Bool {
                        guard let sseEvent, let parsed = AnalystStreamEvent(sse: sseEvent) else {
                            return false
                        }
                        continuation.yield(parsed)
                        if case .done = parsed { return true }
                        return false
                    }
                    for try await byte in bytes {
                        if byte == UInt8(ascii: "\n") {
                            var line = String(decoding: buffer, as: UTF8.self)
                            if line.hasSuffix("\r") { line.removeLast() }
                            buffer.removeAll(keepingCapacity: true)
                            if handle(parser.consume(line: line)) {
                                continuation.finish()
                                return
                            }
                        } else {
                            buffer.append(byte)
                        }
                    }
                    _ = handle(parser.finish())
                    continuation.finish()
                } catch let error as URLError where error.code == .timedOut {
                    continuation.finish(throwing: RuntimeBriefError.timeout)
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

enum AnalystStreamEvent: Sendable, Equatable {
    case chunk(String)
    case done(AnalystAnswer)
    case failure(String)

    init?(sse event: SSEEvent) {
        let data = Data(event.data.utf8)
        switch event.name {
        case "chunk":
            guard let payload = try? JSONDecoder().decode([String: String].self, from: data),
                  let text = payload["text"] else { return nil }
            self = .chunk(text)
        case "done":
            guard let answer = try? JSONDecoder.runtimeBrief.decode(AnalystAnswer.self, from: data) else {
                return nil
            }
            self = .done(answer)
        case "error":
            self = .failure(event.data)
        default:
            return nil
        }
    }
}
