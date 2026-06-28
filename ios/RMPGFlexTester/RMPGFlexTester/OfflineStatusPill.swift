import SwiftUI

// Shows only when it matters: an amber OFFLINE pill (with the queued count) when
// signal is lost, or a gold SYNCING pill while the queue drains after reconnect.
struct OfflineStatusPill: View {
    @ObservedObject private var conn = Connectivity.shared
    @ObservedObject private var sync = OfflineSync.shared

    var body: some View {
        if !conn.isOnline || sync.queueCount > 0 {
            HStack(spacing: 5) {
                Image(systemName: conn.isOnline ? "arrow.triangle.2.circlepath" : "wifi.slash")
                    .font(.system(size: 10))
                Text(label).font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(conn.isOnline ? Theme.gold : .black)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(conn.isOnline ? Theme.raised : Theme.orange)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }

    private var label: String {
        if !conn.isOnline {
            return sync.queueCount > 0 ? "OFFLINE · \(sync.queueCount) QUEUED" : "OFFLINE"
        }
        return sync.queueCount > 0 ? "SYNCING \(sync.queueCount)…" : ""
    }
}
