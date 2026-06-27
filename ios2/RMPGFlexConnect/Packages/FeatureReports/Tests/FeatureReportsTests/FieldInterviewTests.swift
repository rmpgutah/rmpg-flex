import Testing
@testable import FeatureReports

@Test func fiViewModelInitialState() {
    let vm = FieldInterviewViewModel()
    #expect(vm.firstName.isEmpty)
    #expect(vm.lastName.isEmpty)
    #expect(vm.canSubmit == false)
}

@Test func fiViewModelCanSubmit() {
    let vm = FieldInterviewViewModel()
    vm.firstName = "John"
    vm.lastName = "Doe"
    vm.location = "123 Main St"
    #expect(vm.canSubmit == true)
}

@Test func fiViewModelNeedsAllFields() {
    let vm = FieldInterviewViewModel()
    vm.firstName = "John"
    #expect(vm.canSubmit == false)
}

@Test func dailyActivityReportFormat() {
    let vm = DailyActivityReportViewModel()
    #expect(vm.calls.count == 3)
    #expect(vm.activities.count == 3)
    #expect(vm.mileage == "142 mi")
}

@Test func citationViewModelCanSubmit() {
    let vm = CitationViewModel()
    vm.firstName = "John"
    vm.lastName = "Doe"
    vm.location = "I-15 MM 287"
    vm.plate = "ABC123"
    #expect(vm.canSubmit == true)
}

@Test func citationViewModelCannotSubmitWithoutPlate() {
    let vm = CitationViewModel()
    vm.firstName = "John"
    vm.lastName = "Doe"
    vm.location = "Main St"
    #expect(vm.canSubmit == false)
}

@Test func mileageTrackerEmpty() async {
    let tracker = MileageTracker()
    #expect(tracker.totalMileage == 0)
}
