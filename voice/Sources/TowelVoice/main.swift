import Foundation
import Swabble
import TowelVoiceCore

struct VoiceEvent: Codable, Sendable {
    let type: String
    var mode: String?
    var text: String?
    var latestNumber: Int?
    var context: String?
    var message: String?
}

struct ControlCommand: Decodable {
    var command: String
    var mode: String?
    var context: String?
    var value: Bool?
    var wakeWord: String?
    var aliases: [String]?
}

actor EventWriter {
    private let encoder = JSONEncoder()

    func send(_ event: VoiceEvent) {
        guard let data = try? encoder.encode(event) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

actor VoiceController {
    enum Mode: String {
        case wake
        case rep
        case expected
    }

    private var mode: Mode = .wake
    private var context = ""
    private var wakeWord: String
    private var wakeAliases: [String] = []
    private var awaitingWakeContinuation = false
    private var latestRep: Int?
    private var suppressed = false
    private var ignoreUntil = Date.distantPast
    private var lastFinalFingerprint = ""
    private var lastFinalAt = Date.distantPast

    init(wakeWord: String) {
        self.wakeWord = wakeWord.lowercased()
    }

    func handle(command: ControlCommand) -> [VoiceEvent] {
        switch command.command {
        case "configure":
            if let word = command.wakeWord?.trimmingCharacters(in: .whitespacesAndNewlines),
               !word.isEmpty
            {
                wakeWord = word.lowercased()
            }
            wakeAliases = (command.aliases ?? [])
                .map { $0.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            return [modeEvent()]

        case "set_mode":
            guard let rawMode = command.mode,
                  let nextMode = Mode(rawValue: rawMode)
            else {
                return [VoiceEvent(type: "error", message: "Unknown voice mode")]
            }
            mode = nextMode
            context = command.context ?? ""
            awaitingWakeContinuation = false
            latestRep = nil
            return [modeEvent()]

        case "set_suppressed":
            suppressed = command.value ?? false
            if !suppressed {
                ignoreUntil = Date().addingTimeInterval(0.7)
            }
            return []

        default:
            return [
                VoiceEvent(
                    type: "error",
                    message: "Unknown control command: \(command.command)"
                ),
            ]
        }
    }

    func consume(text rawText: String, isFinal: Bool) -> [VoiceEvent] {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !suppressed, Date() >= ignoreUntil else { return [] }

        if isFinal, isDuplicateFinal(text) {
            return []
        }

        switch mode {
        case .rep:
            return consumeRep(text: text)

        case .expected:
            guard isFinal else { return [] }
            let capturedContext = context
            mode = .wake
            context = ""
            return [
                VoiceEvent(type: "mode", mode: mode.rawValue),
                VoiceEvent(
                    type: "utterance",
                    mode: mode.rawValue,
                    text: text,
                    context: capturedContext
                ),
            ]

        case .wake:
            guard isFinal else { return [] }

            if awaitingWakeContinuation {
                if containsWake(in: text), stripWake(from: text).isEmpty {
                    return []
                }
                awaitingWakeContinuation = false
                return [
                    VoiceEvent(
                        type: "utterance",
                        mode: mode.rawValue,
                        text: stripWake(from: text)
                    ),
                ]
            }

            guard containsWake(in: text) else { return [] }
            let stripped = stripWake(from: text)
            if stripped.isEmpty {
                awaitingWakeContinuation = true
                return [VoiceEvent(type: "wake_detected", mode: mode.rawValue)]
            }

            return [
                VoiceEvent(
                    type: "utterance",
                    mode: mode.rawValue,
                    text: stripped
                ),
            ]
        }
    }

    private func consumeRep(text: String) -> [VoiceEvent] {
        var events: [VoiceEvent] = []

        if let number = RepNumberParser.lastNumber(in: text),
           number != latestRep
        {
            latestRep = number
            events.append(
                VoiceEvent(
                    type: "rep_update",
                    mode: mode.rawValue,
                    text: text,
                    latestNumber: number,
                    context: context
                )
            )
        }

        if RepNumberParser.containsDone(in: text) {
            let completedContext = context
            let completedRep = latestRep
            mode = .wake
            context = ""
            awaitingWakeContinuation = false
            events.append(VoiceEvent(type: "mode", mode: mode.rawValue))
            events.append(
                VoiceEvent(
                    type: "rep_complete",
                    mode: mode.rawValue,
                    text: text,
                    latestNumber: completedRep,
                    context: completedContext
                )
            )
            latestRep = nil
        }

        return events
    }

    private func modeEvent() -> VoiceEvent {
        VoiceEvent(type: "mode", mode: mode.rawValue, context: context)
    }

    private func containsWake(in text: String) -> Bool {
        let tokens = RepNumberParser.tokens(in: text)
        let accepted = Set([wakeWord] + wakeAliases)
        return tokens.contains { accepted.contains($0) }
    }

    private func stripWake(from text: String) -> String {
        let accepted = Set([wakeWord] + wakeAliases)
        return RepNumberParser.tokens(in: text)
            .filter { !accepted.contains($0) }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func isDuplicateFinal(_ text: String) -> Bool {
        let fingerprint = text.lowercased()
        let now = Date()
        defer {
            lastFinalFingerprint = fingerprint
            lastFinalAt = now
        }
        return fingerprint == lastFinalFingerprint
            && now.timeIntervalSince(lastFinalAt) < 1.0
    }
}

@main
struct TowelVoiceMain {
    static func main() async {
        let environment = ProcessInfo.processInfo.environment
        let wakeWord = environment["TOWEL_WAKE_WORD"] ?? "towel"
        let locale = environment["TOWEL_LOCALE"] ?? "en_US"

        let writer = EventWriter()
        let controller = VoiceController(wakeWord: wakeWord)
        let pipeline = SpeechPipeline()

        let commandTask = Task.detached {
            let decoder = JSONDecoder()
            while let line = readLine() {
                guard let data = line.data(using: .utf8) else { continue }
                do {
                    let command = try decoder.decode(ControlCommand.self, from: data)
                    let events = await controller.handle(command: command)
                    for event in events {
                        await writer.send(event)
                    }
                } catch {
                    await writer.send(
                        VoiceEvent(
                            type: "error",
                            message: "Invalid control command: \(error.localizedDescription)"
                        )
                    )
                }
            }
        }

        do {
            let stream = try await pipeline.start(
                localeIdentifier: locale,
                etiquette: false
            )
            await writer.send(VoiceEvent(type: "ready", mode: "wake"))

            for try await segment in stream {
                let events = await controller.consume(
                    text: segment.text,
                    isFinal: segment.isFinal
                )
                for event in events {
                    await writer.send(event)
                }
            }
        } catch {
            await writer.send(
                VoiceEvent(
                    type: "error",
                    message: "Speech pipeline failed: \(error.localizedDescription)"
                )
            )
            FileHandle.standardError.write(
                Data("Speech pipeline failed: \(error)\n".utf8)
            )
        }

        commandTask.cancel()
        await pipeline.stop()
    }
}
