import Foundation
@testable import RuntimeBrief

/// Scripted transport: maps URL path suffixes to canned responses.
struct MockTransport: HTTPTransport {
    struct Stub: Sendable {
        var status: Int = 200
        var body: Data
        var headers: [String: String] = ["Content-Type": "application/json"]
    }

    let stubs: [String: Stub] // key: path suffix
    let recorder: Recorder

    final class Recorder: @unchecked Sendable {
        private let lock = NSLock()
        private var _requests: [URLRequest] = []
        var requests: [URLRequest] {
            lock.lock(); defer { lock.unlock() }
            return _requests
        }
        func record(_ request: URLRequest) {
            lock.lock(); defer { lock.unlock() }
            _requests.append(request)
        }
    }

    init(stubs: [String: Stub]) {
        self.stubs = stubs
        self.recorder = Recorder()
    }

    private func stub(for request: URLRequest) throws -> (Stub, HTTPURLResponse) {
        recorder.record(request)
        guard let url = request.url,
              let match = stubs.first(where: { url.path.hasSuffix($0.key) })
        else {
            throw URLError(.unsupportedURL)
        }
        let response = HTTPURLResponse(
            url: url, statusCode: match.value.status,
            httpVersion: "HTTP/1.1", headerFields: match.value.headers)!
        return (match.value, response)
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let (stub, response) = try self.stub(for: request)
        return (stub.body, response)
    }

    func byteStream(for request: URLRequest) async throws -> (AsyncThrowingStream<UInt8, Error>, URLResponse) {
        let (stub, response) = try self.stub(for: request)
        let bytes = [UInt8](stub.body)
        let stream = AsyncThrowingStream<UInt8, Error> { continuation in
            for byte in bytes { continuation.yield(byte) }
            continuation.finish()
        }
        return (stream, response)
    }
}

extension ServerSettings {
    static var mock: ServerSettings {
        ServerSettings(baseURL: URL(string: "http://127.0.0.1:8484"), token: "test-token")
    }
}
