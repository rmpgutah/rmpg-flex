import Foundation
import AVFoundation

public final class AudioService: NSObject, @unchecked Sendable {
    private var audioPlayer: AVAudioPlayer?
    private let session = AVAudioSession.sharedInstance()

    public override init() {
        super.init()
    }

    public func configureForDispatch() {
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? session.setActive(true)
    }

    public func playAlertTone(_ name: String = "alarm") {
        guard let url = Bundle.module.url(forResource: name, withExtension: "wav") else { return }
        audioPlayer = try? AVAudioPlayer(contentsOf: url)
        audioPlayer?.prepareToPlay()
        audioPlayer?.play()
    }

    public func playPriorityTone(priority: String) {
        switch priority {
        case "P1": playAlertTone("p1_critical")
        case "P2": playAlertTone("p2_high")
        default: playAlertTone("dispatch_default")
        }
    }
}
