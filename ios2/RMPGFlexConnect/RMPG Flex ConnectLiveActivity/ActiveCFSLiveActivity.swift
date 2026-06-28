import ActivityKit
import WidgetKit
import SwiftUI
import FeatureLiveActivity

struct ActiveCFSLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ActiveCFSActivityAttributes.self) { context in
            lockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.cfsNumber, systemImage: "phone.badge.waveform")
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.status)
                        .font(.caption).bold()
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.elapsed.formatted(.time(pattern: .minuteSecond)))
                        .font(.system(.body, design: .monospaced))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.attributes.address)
                        .font(.caption)
                }
            } compactLeading: {
                Label(context.attributes.cfsNumber, systemImage: "phone.badge.waveform")
                    .font(.caption2)
            } compactTrailing: {
                Text(context.state.status.prefix(2))
                    .font(.caption2.bold())
            } minimal: {
                Image(systemName: "phone.badge.waveform")
            }
        }
    }

    func lockScreenView(context: ActivityViewContext<ActiveCFSActivityAttributes>) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.cfsNumber)
                    .font(.headline).bold()
                Text(context.attributes.incidentType)
                    .font(.subheadline)
                Text(context.attributes.address)
                    .font(.caption).foregroundColor(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(context.state.status.uppercased())
                    .font(.caption).bold()
                Text(context.state.elapsed.formatted(.time(pattern: .minuteSecond)))
                    .font(.system(.title3, design: .monospaced))
                Text("\(context.state.unitsResponding) units")
                    .font(.caption2)
            }
        }
        .padding()
        .activityBackgroundTint(Color.black.opacity(0.8))
        .activitySystemActionForegroundColor(.white)
    }
}
