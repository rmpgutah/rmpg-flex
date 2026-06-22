import Foundation
import Observation

@Observable
@MainActor
public final class DutyState {
    public private(set) var isOnDuty: Bool = false
    public private(set) var shiftStartedAt: Date? = nil
    public private(set) var unitID: String = ""

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
    }

    public func elapsedSinceShiftStart(now: Date = Date()) -> TimeInterval {
        guard let start = shiftStartedAt else { return 0 }
        return now.timeIntervalSince(start)
    }
}
