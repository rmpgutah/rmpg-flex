import Testing
import Foundation
@testable import FeatureWidgets

@Test func shiftStatusEntryPlaceholder() {
    let entry = ShiftStatusEntry.placeholder
    #expect(entry.isOnDuty == true)
    #expect(entry.activeCFSCount == 3)
    #expect(entry.shiftDuration == "6h 42m")
    #expect(entry.boloCount == 2)
}

@Test func welfareCountdownEntry() {
    let entry = WelfareCountdownEntry(date: Date(), remainingMinutes: 12, unitCallSign: "C-342")
    #expect(entry.remainingMinutes == 12)
    #expect(entry.unitCallSign == "C-342")
}

@Test func shiftStatusEntryCustom() {
    let date = Date()
    let entry = ShiftStatusEntry(date: date, isOnDuty: false, activeCFSCount: 0, shiftDuration: "0m", boloCount: 0)
    #expect(entry.isOnDuty == false)
    #expect(entry.date == date)
}
