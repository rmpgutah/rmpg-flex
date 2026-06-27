import Testing
import Foundation
@testable import FeatureLiveActivity

@Test func activeCFSAttributes() {
    let attrs = ActiveCFSActivityAttributes(
        cfsNumber: "CFS-2026-0441",
        incidentType: "10-91 (Disturbance)",
        address: "123 Main St, SLC",
        dispatchedAt: Date()
    )
    #expect(attrs.cfsNumber == "CFS-2026-0441")
    #expect(attrs.incidentType == "10-91 (Disturbance)")
    #expect(attrs.address == "123 Main St, SLC")
}

@Test func cfsContentState() {
    let state = CFSContentState(elapsed: 3600, status: "enroute", unitsResponding: 2)
    #expect(state.elapsed == 3600)
    #expect(state.status == "enroute")
    #expect(state.unitsResponding == 2)
    #expect(state.notes == nil)
}

@Test func cfsContentStateWithNotes() {
    let state = CFSContentState(elapsed: 1800, status: "onscene", unitsResponding: 3, notes: "Backup arriving")
    #expect(state.notes == "Backup arriving")
}

@Test func activeCFSAttributesEquatable() {
    let date = Date()
    let a = ActiveCFSActivityAttributes(cfsNumber: "1", incidentType: "A", address: "Addr", dispatchedAt: date)
    let b = ActiveCFSActivityAttributes(cfsNumber: "1", incidentType: "A", address: "Addr", dispatchedAt: date)
    #expect(Equatable(a, b))
}

private func Equatable(_ a: ActiveCFSActivityAttributes, _ b: ActiveCFSActivityAttributes) -> Bool {
    a.cfsNumber == b.cfsNumber && a.incidentType == b.incidentType && a.address == b.address
}
