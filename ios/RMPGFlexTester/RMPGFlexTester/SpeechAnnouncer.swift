import AVFoundation

/// Speaks a phrase aloud, ducking other audio (music / nav) briefly so it's
/// heard, then un-ducks when done. Not unit-tested (AV side effects); the
/// decision logic + phrasing live in the pure `SpokenAlert`.
final class SpeechAnnouncer: NSObject, AVSpeechSynthesizerDelegate {
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
