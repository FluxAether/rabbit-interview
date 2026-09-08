import AVFoundation
import Foundation
import Speech

private let appleSttSampleRate: Double = 16_000
private let utteranceEndNs: UInt64 = 1_500_000_000

@available(macOS 26.0, *)
@available(macOS 26.0, *)
private final class SourceSession {
    let source: String
    let inputBuilder: AsyncStream<AnalyzerInput>.Continuation
    var analyzer: SpeechAnalyzer?
    var analysisTask: Task<Void, Never>?
    var resultsTask: Task<Void, Never>?
    var utteranceEndTask: Task<Void, Never>?
    var sawFinal = false
    var utteranceEnded = false
    var failed = false
    var convertInput: ((AVAudioPCMBuffer) throws -> [AnalyzerInput])?

    init(
        source: String,
        inputBuilder: AsyncStream<AnalyzerInput>.Continuation
    ) {
        self.source = source
        self.inputBuilder = inputBuilder
    }
}

@available(macOS 26.0, *)
private final class AppleSttRuntime: @unchecked Sendable {
    static let shared = AppleSttRuntime()

    private let lock = NSLock()
    // AnalyzerInput is not realtime-safe; cpal/CoreAudio calls push() on the IO thread.
    private let ingestQueue = DispatchQueue(label: "com.rabbitinterview.apple-stt.ingest")
    private var generation: UInt64 = 0
    private var ownerGeneration: UInt64 = 0
    private var sessions: [String: SourceSession] = [:]
    private var emitTranscript: ((UnsafePointer<CChar>, UnsafePointer<CChar>, Bool, UnsafePointer<CChar>, UInt64) -> Void)?
    private var emitError: ((UnsafePointer<CChar>, UnsafePointer<CChar>, UInt64) -> Void)?

    func setCallbacks(
        transcript: @escaping @convention(c) (UnsafePointer<CChar>, UnsafePointer<CChar>, Bool, UnsafePointer<CChar>, UInt64) -> Void,
        error: @escaping @convention(c) (UnsafePointer<CChar>, UnsafePointer<CChar>, UInt64) -> Void
    ) {
        lock.lock()
        emitTranscript = transcript
        emitError = error
        lock.unlock()
    }

    func statusJSON() -> String {
        let osAvailable = ProcessInfo.processInfo.isOperatingSystemAtLeast(
            OperatingSystemVersion(majorVersion: 26, minorVersion: 0, patchVersion: 0)
        )
        #if arch(arm64)
        let appleSilicon = true
        #else
        let appleSilicon = false
        #endif
        let speechAvailable = osAvailable
        var reason: String?
        let tccReason = tccIdentityError()
        if !osAvailable {
            reason = "Apple on-device STT requires macOS 26 or later"
        } else if !appleSilicon {
            reason = "Apple on-device STT requires Apple Silicon"
        } else if !speechAvailable {
            reason = "SpeechTranscriber is not available on this Mac"
        } else if let tccReason {
            reason = tccReason
        }
        return jsonString([
            "available": osAvailable && appleSilicon && speechAvailable && tccReason == nil,
            "os_supported": osAvailable,
            "apple_silicon": appleSilicon,
            "speech_supported": speechAvailable,
            "reason": reason as Any,
        ])
    }

    func start(sourcesCSV: String, language: String, owner: UInt64) -> String {
        stop()
        lock.lock()
        ownerGeneration = owner
        lock.unlock()
        let sources = sourcesCSV
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        if sources.isEmpty {
            return "No Apple STT audio sources were requested"
        }
        guard #available(macOS 26.0, *) else {
            return "Apple on-device STT requires macOS 26 or later"
        }
        if let tccReason = tccIdentityError() {
            return tccReason
        }
        let started = DispatchSemaphore(value: 0)
        var startError: String?
        let current = currentGeneration()
        Task { @MainActor in
            do {
                try await self.startAvailable(sources: sources, language: language, generation: current)
            } catch {
                startError = error.localizedDescription
            }
            started.signal()
        }
        if started.wait(timeout: .now() + 45) == .timedOut {
            stop()
            return "Apple STT startup timed out"
        }
        if let startError { stop(); return startError }
        return ""
    }

    func push(source: String, samples: UnsafePointer<Float>, count: Int) {
        guard count > 0 else { return }
        lock.lock()
        let active = sessions[source].map { !$0.failed } ?? false
        lock.unlock()
        guard active else { return }
        let copy = Array(UnsafeBufferPointer(start: samples, count: count))
        ingestQueue.async { [weak self] in
            self?.ingest(source: source, samples: copy)
        }
    }

    private func ingest(source: String, samples: [Float]) {
        lock.lock()
        let session = sessions[source]
        lock.unlock()
        guard let session, !session.failed, let convertInput = session.convertInput else { return }
        do {
            let buffer = try makeCaptureBuffer(samples: samples)
            for input in try convertInput(buffer) {
                session.inputBuilder.yield(input)
            }
        } catch {
            fail(source: source, generation: currentGeneration(), message: error.localizedDescription)
        }
    }

    func stop() {
        let stopping: [SourceSession] = ingestQueue.sync {
            lock.lock()
            generation += 1
            let sessionsToStop = Array(sessions.values)
            sessions.removeAll()
            lock.unlock()
            return sessionsToStop
        }
        for session in stopping {
            session.resultsTask?.cancel()
            session.analysisTask?.cancel()
            session.utteranceEndTask?.cancel()
            session.inputBuilder.finish()
            if let analyzer = session.analyzer {
                Task { @MainActor in
                    await analyzer.cancelAndFinishNow()
                }
            }
        }
    }

    @available(macOS 26.0, *)
    @MainActor
    private func startAvailable(sources: [String], language: String, generation current: UInt64) async throws {
        if let tccReason = tccIdentityError() {
            throw appleError(tccReason)
        }
        try await requestSpeechAuthorization()
        let locale = try await resolveLocale(language)
        let module = try await makeTranscriber(locale: locale)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
            try await request.downloadAndInstall()
        }
        guard current == currentGeneration() else { throw CancellationError() }
        for source in sources {
            guard current == currentGeneration() else { throw CancellationError() }
            try await startSource(
                source: source,
                module: cloneModule(module, locale: locale),
                generation: current,
                dual: sources.count > 1
            )
        }
    }

    @available(macOS 26.0, *)
    @MainActor
    private func cloneModule(_ module: any SpeechModule, locale: Locale) throws -> any SpeechModule {
        if module is SpeechTranscriber {
            return SpeechTranscriber(
                locale: locale,
                transcriptionOptions: [],
                reportingOptions: [.volatileResults, .fastResults],
                attributeOptions: [.audioTimeRange]
            )
        }
        if module is DictationTranscriber {
            return DictationTranscriber(locale: locale, preset: .progressiveLongDictation)
        }
        throw appleError("Unsupported Apple transcriber")
    }

    @available(macOS 26.0, *)
    @MainActor
    private func startSource(
        source: String,
        module: any SpeechModule,
        generation: UInt64,
        dual: Bool
    ) async throws {
        let (inputSequence, inputBuilder) = AsyncStream.makeStream(of: AnalyzerInput.self)
        let options = SpeechAnalyzer.Options(priority: .high, modelRetention: .whileInUse)
        let analyzer = SpeechAnalyzer(modules: [module], options: options)
        guard let captureFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: appleSttSampleRate,
            channels: 1,
            interleaved: false
        ) else {
            throw appleError("Unable to create Apple STT audio format")
        }
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [module],
            considering: captureFormat
        ) else {
            throw appleError("Apple STT could not determine a compatible audio format")
        }
        try await analyzer.prepareToAnalyze(in: format)
        guard generation == currentGeneration() else {
            inputBuilder.finish()
            await analyzer.cancelAndFinishNow()
            throw CancellationError()
        }
        let session = SourceSession(source: source, inputBuilder: inputBuilder)
        session.convertInput = makeInputConverter(format: format)
        session.analyzer = analyzer
        session.resultsTask = Task { [weak self] in
            guard let self else { return }
            do {
                if let transcriber = module as? SpeechTranscriber {
                    for try await result in transcriber.results {
                        if Task.isCancelled { break }
                        self.handleResult(
                            source: source,
                            generation: generation,
                            text: String(result.text.characters),
                            isFinal: result.isFinal
                        )
                    }
                } else if let transcriber = module as? DictationTranscriber {
                    for try await result in transcriber.results {
                        if Task.isCancelled { break }
                        self.handleResult(
                            source: source,
                            generation: generation,
                            text: String(result.text.characters),
                            isFinal: result.isFinal
                        )
                    }
                }
            } catch is CancellationError {
            } catch {
                self.fail(source: source, generation: generation, message: error.localizedDescription)
            }
        }
        session.analysisTask = Task { [weak self] in
            do {
                _ = try await analyzer.analyzeSequence(inputSequence)
            } catch is CancellationError {
            } catch {
                self?.fail(source: source, generation: generation, message: error.localizedDescription)
            }
        }
        lock.lock()
        if generation == self.generation {
            sessions[source] = session
            lock.unlock()
        } else {
            lock.unlock()
            session.resultsTask?.cancel()
            session.analysisTask?.cancel()
            inputBuilder.finish()
            await analyzer.cancelAndFinishNow()
            throw CancellationError()
        }
    }

    private func handleResult(source: String, generation: UInt64, text: String, isFinal: Bool) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, generation == currentGeneration() else { return }
        lock.lock()
        if let session = sessions[source] {
            if session.utteranceEnded {
                session.sawFinal = false
                session.utteranceEnded = false
            }
            if isFinal {
                session.sawFinal = true
                scheduleUtteranceEndLocked(session: session, generation: generation)
            }
        }
        lock.unlock()
        emit(source: source, text: trimmed, isFinal: isFinal, boundary: isFinal ? "final" : "interim", generation: generation)
    }

    private func scheduleUtteranceEndLocked(session: SourceSession, generation: UInt64) {
        session.utteranceEndTask?.cancel()
        let source = session.source
        session.utteranceEndTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: utteranceEndNs)
            guard !Task.isCancelled else { return }
            self?.emitUtteranceEnd(source: source, generation: generation)
        }
    }

    private func emitUtteranceEnd(source: String, generation: UInt64) {
        guard generation == currentGeneration() else { return }
        lock.lock()
        guard let session = sessions[source], session.sawFinal, !session.utteranceEnded else {
            lock.unlock()
            return
        }
        session.utteranceEnded = true
        lock.unlock()
        emit(source: source, text: "", isFinal: true, boundary: "utterance-end", generation: generation)
    }

    private func fail(source: String, generation: UInt64, message: String) {
        guard generation == currentGeneration() else { return }
        lock.lock()
        sessions[source]?.failed = true
        lock.unlock()
        emitFailure(source: source, message: message, generation: generation)
    }

    private func emit(source: String, text: String, isFinal: Bool, boundary: String, generation: UInt64) {
        lock.lock()
        guard generation == self.generation else { lock.unlock(); return }
        let owner = ownerGeneration
        let callback = emitTranscript
        lock.unlock()
        source.withCString { sourcePtr in
            text.withCString { textPtr in
                boundary.withCString { boundaryPtr in
                    callback?(sourcePtr, textPtr, isFinal, boundaryPtr, owner)
                }
            }
        }
    }

    private func emitFailure(source: String, message: String, generation: UInt64) {
        lock.lock()
        guard generation == self.generation else { lock.unlock(); return }
        let owner = ownerGeneration
        let callback = emitError
        lock.unlock()
        source.withCString { sourcePtr in
            message.withCString { messagePtr in
                callback?(sourcePtr, messagePtr, owner)
            }
        }
    }

    private func currentGeneration() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return generation
    }

    @available(macOS 26.0, *)
    private func resolveLocale(_ language: String) async throws -> Locale {
        let preferred: Locale
        switch language {
        case "zh-CN":
            preferred = Locale(identifier: "zh_CN")
        case "zh-TW":
            preferred = Locale(identifier: "zh_TW")
        case "en-US":
            preferred = Locale(identifier: "en_US")
        default:
            throw appleError("Apple on-device STT does not support multilingual auto-detect")
        }
        if let locale = await SpeechTranscriber.supportedLocale(equivalentTo: preferred) {
            return locale
        }
        if let locale = await DictationTranscriber.supportedLocale(equivalentTo: preferred) {
            return locale
        }
        throw appleError("Apple on-device STT does not support \(language)")
    }

    @available(macOS 26.0, *)
    private func makeTranscriber(locale: Locale) async throws -> any SpeechModule {
        if await SpeechTranscriber.supportedLocales.contains(where: { $0.identifier == locale.identifier }) {
            return SpeechTranscriber(
                locale: locale,
                transcriptionOptions: [],
                reportingOptions: [.volatileResults, .fastResults],
                attributeOptions: [.audioTimeRange]
            )
        }
        if await DictationTranscriber.supportedLocales.contains(where: { $0.identifier == locale.identifier }) {
            return DictationTranscriber(locale: locale, preset: .progressiveLongDictation)
        }
        throw appleError("No Apple transcriber is installed for \(locale.identifier)")
    }

    private func requestSpeechAuthorization() async throws {
        let status = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        switch status {
        case .authorized:
            return
        case .denied:
            throw appleError("Speech recognition permission was denied")
        case .restricted:
            throw appleError("Speech recognition is restricted on this Mac")
        case .notDetermined:
            throw appleError("Speech recognition permission is not determined")
        @unknown default:
            throw appleError("Speech recognition permission is unavailable")
        }
    }

    private func makeCaptureBuffer(samples: [Float]) throws -> AVAudioPCMBuffer {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: appleSttSampleRate,
            channels: 1,
            interleaved: false
        ) else {
            throw appleError("Unable to create Apple STT audio format")
        }
        return try makePCMBuffer(samples: samples, format: format)
    }
}

@available(macOS 26.0, *)
private func makeInputConverter(format: AVAudioFormat) -> (AVAudioPCMBuffer) throws -> [AnalyzerInput] {
    if #available(macOS 27.0, *) {
        let converter = AnalyzerInputConverter(analyzerFormat: format)
        return { buffer in
            try converter.convert(buffer, at: nil)
        }
    }
    return { buffer in
        [AnalyzerInput(buffer: try convertPCMBuffer(buffer, to: format))]
    }
}

@available(macOS 26.0, *)
private func makePCMBuffer(samples: [Float], format: AVAudioFormat) throws -> AVAudioPCMBuffer {
    let count = samples.count
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)) else {
        throw appleError("Unable to allocate Apple STT audio buffer")
    }
    buffer.frameLength = AVAudioFrameCount(count)
    guard let dst = buffer.floatChannelData?[0] else {
        throw appleError("Apple STT capture buffer is not float32")
    }
    samples.withUnsafeBufferPointer { src in
        guard let base = src.baseAddress else { return }
        dst.update(from: base, count: count)
    }
    return buffer
}

@available(macOS 26.0, *)
private func convertPCMBuffer(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
    if buffer.format.commonFormat == format.commonFormat,
       buffer.format.sampleRate == format.sampleRate,
       buffer.format.channelCount == format.channelCount,
       buffer.format.isInterleaved == format.isInterleaved
    {
        return buffer
    }
    guard let converter = AVAudioConverter(from: buffer.format, to: format) else {
        throw appleError("Unable to convert audio for Apple STT")
    }
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up) + 32)
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: max(capacity, 1)) else {
        throw appleError("Unable to allocate converted Apple STT audio buffer")
    }
    var consumed = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
        if consumed {
            status.pointee = .noDataNow
            return nil
        }
        consumed = true
        status.pointee = .haveData
        return buffer
    }
    if let error {
        throw error
    }
    return output
}

private let microphoneRequestLock = NSLock()

private final class StringBox: @unchecked Sendable {
    var value: String
    init(_ value: String) { self.value = value }
}

private func microphoneAuthStatus() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        return "granted"
    case .denied, .restricted:
        return "denied"
    case .notDetermined:
        return "undetermined"
    @unknown default:
        return "denied"
    }
}

private func requestMicrophoneAccess() -> String {
    let status = microphoneAuthStatus()
    if status != "undetermined" {
        return status
    }
    let result = StringBox("denied")
    let finished = DispatchSemaphore(value: 0)
    let startRequest = {
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            result.value = granted ? "granted" : "denied"
            finished.signal()
        }
    }
    if Thread.isMainThread {
        startRequest()
        let deadline = Date().addingTimeInterval(180)
        while finished.wait(timeout: .now() + 0.05) == .timedOut, Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
    } else {
        DispatchQueue.main.async(execute: startRequest)
        _ = finished.wait(timeout: .now() + 180)
    }
    return result.value
}

@_cdecl("rabbit_microphone_status")
public func rabbit_microphone_status() -> UnsafeMutablePointer<CChar> {
    return strdup(microphoneAuthStatus())!
}

@_cdecl("rabbit_request_microphone")
public func rabbit_request_microphone() -> UnsafeMutablePointer<CChar> {
    microphoneRequestLock.lock()
    defer { microphoneRequestLock.unlock() }
    return strdup(requestMicrophoneAccess())!
}

private func tccIdentityError() -> String? {
    let bundle = Bundle.main
    let identifier = bundle.bundleIdentifier ?? ""
    let hasUsage = bundle.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") != nil
    if identifier == "com.rabbitinterview.desktop" && hasUsage {
        return nil
    }
    return "Apple on-device STT needs a packaged macOS app so Speech Recognition permission can be requested. Restart from a bundled .app instead of a bare tauri dev binary."
}


private func appleError(_ message: String) -> NSError {
    NSError(domain: "RabbitInterview.AppleSTT", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

private func jsonString(_ object: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let text = String(data: data, encoding: .utf8)
    else {
        return "{\"available\":false}"
    }
    return text
}

@_cdecl("rabbit_apple_stt_set_callbacks")
public func rabbit_apple_stt_set_callbacks(
    transcript: @escaping @convention(c) (UnsafePointer<CChar>, UnsafePointer<CChar>, Bool, UnsafePointer<CChar>, UInt64) -> Void,
    error: @escaping @convention(c) (UnsafePointer<CChar>, UnsafePointer<CChar>, UInt64) -> Void
) {
    if #available(macOS 26.0, *) { AppleSttRuntime.shared.setCallbacks(transcript: transcript, error: error) }
}

@_cdecl("rabbit_apple_stt_status_json")
public func rabbit_apple_stt_status_json() -> UnsafeMutablePointer<CChar> {
    if #available(macOS 26.0, *) {
        return strdup(AppleSttRuntime.shared.statusJSON())!
    }
    return strdup("{\"available\":false,\"os_supported\":false,\"apple_silicon\":false,\"speech_supported\":false,\"reason\":\"Apple on-device STT requires macOS 26 or later\"}")!
}

@_cdecl("rabbit_apple_stt_start")
public func rabbit_apple_stt_start(
    sources: UnsafePointer<CChar>,
    language: UnsafePointer<CChar>,
    owner: UInt64
) -> UnsafeMutablePointer<CChar>? {
    if #available(macOS 26.0, *) {
        let error = AppleSttRuntime.shared.start(
            sourcesCSV: String(cString: sources),
            language: String(cString: language),
            owner: owner
        )
        return error.isEmpty ? nil : strdup(error)
    }
    return strdup("Apple on-device STT requires macOS 26 or later")
}

@_cdecl("rabbit_apple_stt_push")
public func rabbit_apple_stt_push(
    source: UnsafePointer<CChar>,
    samples: UnsafePointer<Float>,
    count: Int32
) {
    if #available(macOS 26.0, *) {
        AppleSttRuntime.shared.push(
            source: String(cString: source),
            samples: samples,
            count: Int(count)
        )
    }
}

@_cdecl("rabbit_apple_stt_stop")
public func rabbit_apple_stt_stop() {
    if #available(macOS 26.0, *) { AppleSttRuntime.shared.stop() }
}

@_cdecl("rabbit_apple_stt_free_string")
public func rabbit_apple_stt_free_string(ptr: UnsafeMutablePointer<CChar>?) {
    if let ptr {
        free(ptr)
    }
}
