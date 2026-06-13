import SwiftUI
import UIKit

// Inbound side of the MDT link — messages the in-vehicle terminal (or dispatch)
// pushed to the officer's phone: calls to respond to, locations to navigate to,
// text. Location/nav rows open Apple Maps.
struct MDTInboxView: View {
    @ObservedObject private var link = MDTLink.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Circle().fill(link.online ? Theme.green : Theme.neutral).frame(width: 8, height: 8)
                    Text(link.online ? "Vehicle MDT online" : "Vehicle MDT offline")
                        .font(.system(size: 11)).foregroundStyle(Theme.neutral)
                    Spacer()
                    Button { Task { await link.pollOnce() } } label: {
                        Image(systemName: "arrow.clockwise").font(.system(size: 12)).foregroundStyle(Theme.gold)
                    }
                }
                if link.inbox.isEmpty {
                    Text("No messages from your vehicle MDT yet.")
                        .font(.system(size: 12)).foregroundStyle(Theme.neutral).padding(.top, 20)
                } else {
                    ForEach(link.inbox) { row($0) }
                }
            }.padding(12)
        }
        .background(Theme.base)
        .navigationTitle("MDT INBOX")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await link.pollOnce() }
        .onAppear { link.markRead() }
    }

    private func row(_ msg: MDTMessage) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(MDTInbox.label(for: msg.type).uppercased())
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.gold)
            Text(summary(msg)).font(.system(size: 12)).foregroundStyle(.white)
            if let lat = coord(msg, "lat") ?? coord(msg, "latitude"),
               let lng = coord(msg, "lng") ?? coord(msg, "longitude") {
                Button { openMaps(lat, lng) } label: {
                    Label("Navigate — Open in Maps", systemImage: "location.north.line.fill")
                        .font(.system(size: 11, weight: .semibold)).frame(maxWidth: .infinity)
                }.buttonStyle(RaisedButtonStyle())
            }
        }.frame(maxWidth: .infinity, alignment: .leading).themeCard()
    }

    private func summary(_ msg: MDTMessage) -> String {
        if let t = msg.payload["text"] as? String { return t }
        if let n = msg.payload["call_number"] as? String { return "Call \(n)" }
        if let a = (msg.payload["address"] as? String) ?? (msg.payload["location"] as? String) { return a }
        if let name = msg.payload["name"] as? String { return name }
        return msg.payload.isEmpty ? "—" : msg.payload.map { "\($0.key): \($0.value)" }.joined(separator: " · ")
    }
    private func coord(_ msg: MDTMessage, _ k: String) -> Double? {
        (msg.payload[k] as? Double) ?? (msg.payload[k] as? Int).map(Double.init) ?? Double((msg.payload[k] as? String) ?? "")
    }
    private func openMaps(_ lat: Double, _ lng: Double) {
        if let url = URL(string: "maps://?ll=\(lat),\(lng)&q=MDT") { UIApplication.shared.open(url) }
    }
}
