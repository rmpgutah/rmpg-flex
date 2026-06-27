import WidgetKit
import SwiftUI
import FeatureWidgets

struct ShiftStatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> ShiftStatusEntry {
        ShiftStatusEntry.placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (ShiftStatusEntry) -> Void) {
        completion(ShiftStatusEntry.placeholder)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ShiftStatusEntry>) -> Void) {
        let entry = ShiftStatusEntry(date: Date(), isOnDuty: true, activeCFSCount: 3, shiftDuration: "6h 42m", boloCount: 2)
        let timeline = Timeline(entries: [entry], policy: .atEnd)
        completion(timeline)
    }
}

struct ShiftStatusWidget: Widget {
    let kind: String = "com.rmpg.flexconnect.shiftstatus"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ShiftStatusProvider()) { entry in
            ShiftStatusSmallWidgetView(entry: entry)
        }
        .configurationDisplayName("Shift Status")
        .description("View your on-duty status at a glance")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct WelfareCountdownProvider: TimelineProvider {
    func placeholder(in context: Context) -> WelfareCountdownEntry {
        WelfareCountdownEntry(date: Date(), remainingMinutes: 15, unitCallSign: "C-342")
    }

    func getSnapshot(in context: Context, completion: @escaping (WelfareCountdownEntry) -> Void) {
        completion(WelfareCountdownEntry(date: Date(), remainingMinutes: 15, unitCallSign: "C-342"))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WelfareCountdownEntry>) -> Void) {
        let entry = WelfareCountdownEntry(date: Date(), remainingMinutes: 12, unitCallSign: "C-342")
        let timeline = Timeline(entries: [entry], policy: .atEnd)
        completion(timeline)
    }
}

struct WelfareCountdownWidget: Widget {
    let kind: String = "com.rmpg.flexconnect.welfare"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WelfareCountdownProvider()) { entry in
            WelfareCountdownLockScreenView(entry: entry)
        }
        .configurationDisplayName("Welfare Check")
        .description("Welfare check countdown timer")
        .supportedFamilies([.accessoryCircular])
    }
}

@main
struct RMPGFlexConnectWidgets: WidgetBundle {
    var body: some Widget {
        ShiftStatusWidget()
        WelfareCountdownWidget()
    }
}
