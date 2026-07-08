import Foundation

/// Canned status updates an officer can send to the vehicle MDT without
/// typing while driving — the CarPlay Grid template's four buttons.
public enum CannedMessage: String, CaseIterable, Sendable {
    case enRoute
    case onScene
    case clear
    case needBackup

    public var text: String {
        switch self {
        case .enRoute: return "En Route"
        case .onScene: return "On Scene"
        case .clear: return "Clear"
        case .needBackup: return "Need Backup"
        }
    }
}

/// Builds the exact `/api/mdt/send` body MDTLinkView (Quick Actions) already
/// posts — `{to: 'mdt', type: 'text', payload: {text: "..."}}` — so the
/// vehicle MDT displays a CarPlay quick reply exactly like any other
/// phone-to-MDT text message.
public enum CarPlayQuickReplyPayload {
    public static func mdtSendPayload(text: String) -> [String: Any] {
        ["to": "mdt", "type": "text", "payload": ["text": text]]
    }
}
