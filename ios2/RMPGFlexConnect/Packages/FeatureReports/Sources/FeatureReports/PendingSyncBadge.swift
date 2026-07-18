import SwiftUI

/// Small inline indicator surfacing how many reports are queued in the offline
/// outbox, waiting to sync. Hidden entirely when there's nothing pending.
struct PendingSyncBadge: View {
    var pendingCount: Int
    var isOnline: Bool

    var body: some View {
        if pendingCount > 0 {
            Label {
                Text(isOnline ? "Syncing \(pendingCount)…" : "\(pendingCount) queued offline")
            } icon: {
                Image(systemName: isOnline ? "arrow.triangle.2.circlepath" : "wifi.slash")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}
