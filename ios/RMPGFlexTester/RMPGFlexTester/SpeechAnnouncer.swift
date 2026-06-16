import AVFoundation

/// Speaks a phrase aloud, ducking other audio (music / nav) briefly so it's
/// heard, then un-ducks when done. Not unit-tested (AV side effects); the
/// decision logic + phrasing live in the pure `SpokenAlert`.
///
/// `@unchecked Sendable`: the synth + audio session are only driven from the
/// main actor (`speak()` is called from `@MainActor` refresh; AVSpeech delegate
/// callbacks arrive on the main queue), so the non-Sendable AVSpeechSynthesizer
/// stored property is safe here.
final class SpeechAnnouncer: NSObject, @unchecked Sendable, AVSpeechSynthesizerDelegate {
    static let shared = SpeechAnnouncer()
    private let synth = AVSpeechSynthesizer()

    private override init() {
        super.init()
        synth.delegate = self
    }

    func speak(_ text: String) {
        guard !text.isEmpty else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? session.setActive(true)
        let u = AVSpeechUtterance(string: text)
        u.rate = AVSpeechUtteranceDefaultSpeechRate
        u.voice = AVSpeechSynthesisVoice(language: "en-US")
        synth.speak(u)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
