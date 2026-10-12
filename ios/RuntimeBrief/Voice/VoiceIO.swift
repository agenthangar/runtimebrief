import AVFoundation
import Foundation
import Speech

enum VoiceAccess: Equatable {
    case granted
    case denied(String)
}

/// Hears one utterance at a time. Live: Apple's speech recognizer primed with
/// project names. Tests: a script of utterances.
@MainActor
protocol VoiceRecognizing: AnyObject {
    func requestAccess() async -> VoiceAccess
    /// Returns what was said, or "" when nothing was said before it timed out.
    func listen(vocabulary: [String], onPartial: @escaping @MainActor (String) -> Void) async throws -> String
    /// Ends the utterance now and keeps what was heard.
    func finish()
    /// Stops listening and discards the utterance.
    func cancel()
}

@MainActor
protocol VoiceSpeaking: AnyObject {
    func speak(_ text: String) async
    func stop()
}

/// Apple's speech recognizer with the project names as contextual strings,
/// on the device when the language supports it.
@MainActor
final class SpeechRecognizer: VoiceRecognizing {
    private let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var continuation: CheckedContinuation<String, Error>?
    private var onPartial: (@MainActor (String) -> Void)?
    private var transcript = ""
    private var silenceTimer: Task<Void, Never>?
    private var limitTimer: Task<Void, Never>?

    /// A pause this long after speech ends the question.
    var endOfSpeechPause: Duration = .milliseconds(1_400)
    /// Silence this long before any speech gives up listening.
    var initialSilence: Duration = .seconds(8)
    var longestQuestion: Duration = .seconds(30)

    func requestAccess() async -> VoiceAccess {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard speech == .authorized else {
            return .denied("Allow Speech Recognition for RuntimeBrief in Settings to talk to it. You can type instead.")
        }
        guard await AVAudioApplication.requestRecordPermission() else {
            return .denied("Allow the microphone for RuntimeBrief in Settings to talk to it. You can type instead.")
        }
        guard recognizer?.isAvailable == true else {
            return .denied("Speech recognition isn't available right now. You can type instead.")
        }
        return .granted
    }

    func listen(vocabulary: [String], onPartial: @escaping @MainActor (String) -> Void) async throws -> String {
        cancel()
        guard let recognizer, recognizer.isAvailable else { throw RuntimeBriefError.network("Speech recognition is unavailable.") }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default,
                                options: [.defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP, .duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.contextualStrings = vocabulary
        request.addsPunctuation = true
        request.taskHint = .dictation
        // Keep audio on the device whenever the language allows it.
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        self.request = request
        self.onPartial = onPartial
        transcript = ""

        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1_024, format: input.outputFormat(forBus: 0),
                         block: Self.tap(appendingTo: request))
        engine.prepare()
        try engine.start()

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            task = recognizer.recognitionTask(with: request, resultHandler: Self.resultHandler(for: self))
            restartSilenceTimer(initialSilence)
            limitTimer = Task { [weak self, longestQuestion] in
                try? await Task.sleep(for: longestQuestion)
                guard !Task.isCancelled else { return }
                self?.finish()
            }
        }
    }

    func finish() {
        guard continuation != nil else { return }
        request?.endAudio()
        stopAudio()
        // The final result usually follows endAudio within a moment.
        silenceTimer?.cancel()
        silenceTimer = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            self?.complete()
        }
    }

    func cancel() {
        task?.cancel()
        stopAudio()
        transcript = ""
        complete()
    }

    // The audio tap and recognition callbacks run off the main actor, so
    // they must not be formed in a main-actor context.
    nonisolated private static func tap(appendingTo request: SFSpeechAudioBufferRecognitionRequest) -> AVAudioNodeTapBlock {
        { buffer, _ in request.append(buffer) }
    }

    nonisolated private static func resultHandler(for owner: SpeechRecognizer) -> (SFSpeechRecognitionResult?, (any Error)?) -> Void {
        { [weak owner] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil
            Task { @MainActor in owner?.handle(text: text, isFinal: isFinal, failed: failed) }
        }
    }

    private func handle(text: String?, isFinal: Bool, failed: Bool) {
        guard continuation != nil else { return }
        if let text, !text.isEmpty, text != transcript {
            transcript = text
            onPartial?(text)
            restartSilenceTimer(endOfSpeechPause)
        }
        if isFinal || failed {
            stopAudio()
            complete()
        }
    }

    private func restartSilenceTimer(_ delay: Duration) {
        silenceTimer?.cancel()
        silenceTimer = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.finish()
        }
    }

    private func stopAudio() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
    }

    private func complete() {
        silenceTimer?.cancel()
        limitTimer?.cancel()
        task = nil
        request = nil
        onPartial = nil
        let heard = transcript
        continuation?.resume(returning: heard)
        continuation = nil
    }
}

/// Reads answers aloud with the best installed voice for the language.
@MainActor
final class SpeechSpeaker: NSObject, VoiceSpeaking, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var continuation: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String) async {
        stop()
        guard !text.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = Self.bestVoice()
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            synthesizer.speak(utterance)
        }
    }

    func stop() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        finished()
    }

    private func finished() {
        continuation?.resume()
        continuation = nil
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finished() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finished() }
    }

    static func bestVoice() -> AVSpeechSynthesisVoice? {
        let language = AVSpeechSynthesisVoice.currentLanguageCode()
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == language }
        return voices.max { $0.quality.rawValue < $1.quality.rawValue } ?? AVSpeechSynthesisVoice(language: language)
    }
}

#if DEBUG
/// UI tests and previews: utterances from a script, then silence.
@MainActor
final class ScriptedRecognizer: VoiceRecognizing {
    private var utterances: [String]
    private(set) var vocabularies: [[String]] = []
    var access: VoiceAccess

    init(utterances: [String], access: VoiceAccess = .granted) {
        self.utterances = utterances
        self.access = access
    }

    func requestAccess() async -> VoiceAccess { access }

    func listen(vocabulary: [String], onPartial: @escaping @MainActor (String) -> Void) async throws -> String {
        vocabularies.append(vocabulary)
        guard !utterances.isEmpty else { return "" }
        let next = utterances.removeFirst()
        onPartial(next)
        return next
    }

    func finish() {}
    func cancel() {}
}

/// Records what would be spoken, without audio.
@MainActor
final class RecordingSpeaker: VoiceSpeaking {
    private(set) var spoken: [String] = []
    func speak(_ text: String) async { if !text.isEmpty { spoken.append(text) } }
    func stop() {}
}
#endif
