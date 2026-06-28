import Foundation

/// Two discrete theme modes. Picked by `ThemeSchedule.resolve(for:)`.
public enum ThemeMode: String, Sendable, CaseIterable, Equatable {
    case day      // light-grey Spillman
    case night    // dark steel-blue Spillman (default)
}

/// Schedule + manual-override resolver. Mirrors the web behavior in
/// `client/src/utils/themeSchedule.ts`.
public enum ThemeSchedule {
    /// Day hours: 06:00 (inclusive) to 18:00 (exclusive), local time.
    static let dayStartHour = 6
    static let dayEndHour = 18

    public static func resolveScheduled(for date: Date, calendar: Calendar = .current) -> ThemeMode {
        let hour = calendar.component(.hour, from: date)
        return (hour >= dayStartHour && hour < dayEndHour) ? .day : .night
    }

    /// Final resolver: manual override (if `active`) wins; else schedule.
    public static func resolveEffective(
        override: (mode: ThemeMode, active: Bool)?,
        for date: Date = Date(),
        calendar: Calendar = .current
    ) -> ThemeMode {
        if let o = override, o.active { return o.mode }
        return resolveScheduled(for: date, calendar: calendar)
    }
}
