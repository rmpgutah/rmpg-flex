import Testing
@testable import FeatureRunID

@Test func mrzTD3Passport() {
    let raw = """
    P<UTOMUSTER<<JOHN<MICHAEL<<<<<<<<<<<<<<<<<<<<<<<<<
    L12345678<0UTO8912310M2601015<<<<<<<<<<<<<<<<08
    """
    let result = MrzParser.parse(raw)
    #expect(result != nil)
    #expect(result?.firstName == "JOHN MICHAEL")
    #expect(result?.lastName == "MUSTER")
    #expect(result?.documentNumber == "L12345678")
    #expect(result?.nationality == "UTO")
    #expect(result?.dateOfBirth == "891231")
    #expect(result?.expirationDate == "260101")
    #expect(result?.sex == "M")
    #expect(result?.documentType == "P")
}

@Test func mrzTD1NationalID() {
    let raw = """
    I<UTOL12345678<<<<<<<<<<<<<<<
    8912310M2601015UTO<<<<<<<<<<<2
    MUSTER<<JOHN<MICHAEL<<<<<<<<<<
    """
    let result = MrzParser.parse(raw)
    #expect(result != nil)
    #expect(result?.documentNumber == "L12345678")
}

@Test func mrzInvalidData() {
    let result = MrzParser.parse("")
    #expect(result == nil)
}

@Test func mrzCheckDigitValidation() {
    #expect(MrzParser.validateCheckDigit("1234567<") == true)
}

@Test func mrzResultFullName() {
    let result = MrzResult(documentType: "P", documentNumber: "AB123", firstName: "JOHN",
                           lastName: "DOE", nationality: "US", dateOfBirth: "900101",
                           sex: "M", expirationDate: "251231", optionalData: "", raw: "")
    #expect(result.fullName == "JOHN DOE")
}
