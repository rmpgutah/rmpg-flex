import Foundation

@Observable @MainActor
public final class DutyState {
    public var isOnDuty = false
    public var shiftStartedAt: Date?
    public var unitID = ""
    public var odometerStart: Int?
    public var inspectionPassed = false

    public init() {}

    public func clockOn(unitID: String, at date: Date = Date()) {
        self.isOnDuty = true
        self.shiftStartedAt = date
        self.unitID = unitID
    }

    public func clockOff() {
        self.isOnDuty = false
        self.shiftStartedAt = nil
        self.unitID = ""
        self.odometerStart = nil
    }

    public func elapsedSinceShiftStart(now: Date) -> TimeInterval {
        guard let start = shiftStartedAt else { return 0 }
        return now.timeIntervalSince(start)
    }
}
