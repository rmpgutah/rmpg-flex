import SwiftUI

// Compact link indicator — shows whether the officer's in-vehicle MDT terminal
// is online + paired. Tapping opens the MDT inbox.
struct MDTStatusPill: View {
    @ObservedObject private var link = MDTLink.shared
    var body: some View {
        NavigationLink { MDTInboxView() } label: {
            HStack(spacing: 5) {
                Circle().fill(link.online ? Theme.green : Theme.neutral).frame(width: 7, height: 7)
                Image(systemName: "car.fill")
                    .font(.system(size: 10)).foregroundStyle(link.online ? Theme.gold : Theme.neutral)
                Text(link.online ? "MDT LINKED" : "MDT OFFLINE")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(link.online ? Theme.gold : Theme.neutral)
                if link.unreadCount > 0 {
                    Text("\(link.unreadCount)")
                        .font(.system(size: 9, weight: .heavy)).foregroundStyle(.black)
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Theme.red).clipShape(Capsule())
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(Theme.raised)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}
